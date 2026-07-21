"use client";

// E27 — the one-tap "where's the nearest restroom?" finder (M-04-02, P0).
//
// Modeled on src/components/near-me.tsx for the geolocation shape, with one
// deliberate difference: THIS COMPONENT TRANSMITS NOTHING. near-me.tsx sends a
// coarse anonymous geo-ping because the Chamber's LTAC reporting needs to know
// which part of town visitors stand in; a restroom lookup has no such reporting
// value, so it sends nothing at all and stays outside privacy-consent scope
// entirely. There is no network call in this file — not a beacon, not a
// tracker, nothing. Distance is computed on-device and thrown away.
//
// Consequently there is also no affirmative-consent card here. near-me.tsx
// shows one because it is about to transmit; asking permission to do arithmetic
// that never leaves the phone would be consent theater. The browser's own
// location prompt is the whole gate.
//
// Privacy, in order of enforcement:
//   - Nothing runs until the visitor taps the button.
//   - getCurrentPosition is called exactly once per tap. The continuous-watch
//     geolocation API is never used (deliberately not named here: E27's
//     acceptance check greps this file for it, and a mention would read as a
//     use).
//   - The coordinate lives in a local variable for the length of one sort and
//     is never stored, never put in state, and never sent anywhere.
//
// Degradation: location only ever IMPROVES the ordering. With no location (or
// a declined prompt) the list still renders, ordered by walk time from the
// ferry dock — so the page is useful to a visitor who never taps, and E13 can
// precache it.

import { useMemo, useState } from "react";
import { EditableText, useCopy } from "@/lib/copy-context";
import { haversineMeters, walkMinutes } from "@/lib/geo";
import { markerCategory } from "@/lib/map/types";
import { CostBadge } from "@/components/cost-badge";
import type { CostValue } from "@/lib/cost";
import { mapDirectionsUrl } from "@/components/ui";

/** Serializable amenity the server page maps into props. */
export interface AmenityPlace {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  notes?: string;
  cost?: CostValue;
  /** Walking minutes from the ferry dock, precomputed server-side. */
  walkMinutesFromFerry: number;
}

/** The categories this finder exists for. Never truncated, never hidden. */
const SAFETY_CRITICAL = ["restroom", "water"] as const;
/** Comfort amenities are capped — a long bench list would bury the basics. */
const SECONDARY_CAP = 8;

type Status = "idle" | "locating" | "located" | "denied" | "error";

interface Ranked {
  place: AmenityPlace;
  /** Straight-line meters from the visitor, when located. */
  meters?: number;
}

export function NearestAmenity({ places }: { places: AmenityPlace[] }) {
  const [status, setStatus] = useState<Status>("idle");
  /** Distance in meters keyed by amenity id — the ONLY trace of a location,
   *  and it is derived, not the coordinate itself. */
  const [distances, setDistances] = useState<Record<string, number> | null>(null);
  const [showSecondary, setShowSecondary] = useState(false);

  const idleLabel = useCopy("restrooms.finder.button");
  const locatingLabel = useCopy("restrooms.finder.locating");

  const { primary, secondary, missing } = useMemo(() => {
    const rank = (list: AmenityPlace[]): Ranked[] =>
      list
        .map((place) => ({ place, meters: distances?.[place.id] }))
        .sort((a, b) => {
          // Located: true distance wins. Otherwise fall back to the dock
          // ordering, so the list is never arbitrary.
          if (a.meters !== undefined && b.meters !== undefined) return a.meters - b.meters;
          return (
            a.place.walkMinutesFromFerry - b.place.walkMinutesFromFerry ||
            a.place.name.localeCompare(b.place.name)
          );
        });

    const isCritical = (c: string) => (SAFETY_CRITICAL as readonly string[]).includes(c);
    return {
      primary: rank(places.filter((p) => isCritical(p.category))),
      secondary: rank(places.filter((p) => !isCritical(p.category))),
      // Honest empty states: name the categories we have NOTHING for, rather
      // than silently rendering a shorter list and implying full coverage.
      missing: SAFETY_CRITICAL.filter((c) => !places.some((p) => p.category === c)),
    };
  }, [places, distances]);

  function locate() {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setStatus("error");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        // Compute, store the DERIVED distances, discard the coordinate.
        const next: Record<string, number> = {};
        for (const p of places) {
          next[p.id] = haversineMeters(latitude, longitude, p.lat, p.lng);
        }
        setDistances(next);
        setStatus("located");
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 },
    );
  }

  return (
    <div className="rounded-2xl border border-sand bg-white p-5 shadow-[0_1px_3px_rgba(22,64,94,0.08)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={locate}
          disabled={status === "locating"}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-sound px-5 py-2.5 text-sm font-semibold text-white hover:bg-sound-deep disabled:opacity-50"
        >
          <span aria-hidden="true">📍</span>
          {status === "locating" ? locatingLabel : idleLabel}
        </button>
        <EditableText
          as="p"
          className="text-xs text-ink-soft"
          copyKey="restrooms.finder.disclosure"
        />
      </div>

      {status === "denied" && (
        <EditableText as="p" className="mt-3 text-sm text-ink-soft" copyKey="restrooms.finder.denied" />
      )}
      {status === "error" && (
        <EditableText as="p" className="mt-3 text-sm text-ink-soft" copyKey="restrooms.finder.error" />
      )}

      {/* Ordering changes under the visitor's feet when they locate, so say so
          out loud for anyone not watching the list reflow. */}
      <p className="sr-only" aria-live="polite">
        {status === "located"
          ? "Sorted by distance from your location."
          : "Sorted by walk time from the ferry dock."}
      </p>

      <ul className="mt-4 divide-y divide-sand">
        {primary.map(({ place, meters }) => (
          <AmenityRow key={place.id} place={place} meters={meters} />
        ))}
      </ul>

      {/* The water layer ships empty on purpose (no published source places a
          Kingston fountain). Say that plainly instead of showing a restroom-only
          list under a heading that promises water. */}
      {missing.includes("water") && (
        <EditableText
          as="p"
          className="mt-3 rounded-xl border border-sand bg-shell p-3 text-sm text-ink-soft"
          copyKey="restrooms.finder.nowater"
        />
      )}

      {secondary.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowSecondary((v) => !v)}
            aria-expanded={showSecondary}
            className="mt-4 inline-flex min-h-[44px] items-center rounded-full border border-sand px-4 py-2 text-sm font-semibold text-ink hover:border-tide"
          >
            {showSecondary ? "Hide benches, shade & more" : "Show benches, shade & more"}
          </button>
          {showSecondary && (
            <ul className="mt-2 divide-y divide-sand">
              {secondary.slice(0, SECONDARY_CAP).map(({ place, meters }) => (
                <AmenityRow key={place.id} place={place} meters={meters} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function AmenityRow({ place, meters }: { place: AmenityPlace; meters?: number }) {
  const cat = markerCategory(place.category);
  // "~" because this is straight-line distance at a casual pace — it under-states
  // a real walk, and the tilde is the honest signal (same as near-me.tsx).
  const minutes = meters === undefined ? place.walkMinutesFromFerry : walkMinutes(meters);
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3">
      <span className="min-w-0">
        <span className="font-medium text-ink">
          <span aria-hidden="true">{cat.emoji}</span> {place.name}
        </span>
        {/* Category in TEXT, never the pin colour alone (WCAG 1.4.1). */}
        <span className="ml-2 text-xs text-ink-soft">{cat.label}</span>
        {place.cost && (
          <span className="ml-2 align-middle">
            <CostBadge cost={place.cost} />
          </span>
        )}
        {place.notes && <span className="mt-0.5 block text-xs text-ink-soft">{place.notes}</span>}
      </span>
      <span className="flex items-center gap-3 whitespace-nowrap">
        <span className="text-sm tabular-nums text-ink-soft">
          ~{minutes} min {meters === undefined ? "from ferry" : "walk"}
        </span>
        <a
          href={mapDirectionsUrl(`${place.lat},${place.lng}`)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center text-sm font-semibold text-tide-deep underline"
        >
          Directions
          <span className="sr-only"> to {place.name} (opens Google Maps)</span>
        </a>
      </span>
    </li>
  );
}
