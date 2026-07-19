"use client";

// "What's open near me?" — the visitor-facing half of the opt-in location
// bargain. The visitor gets the closest open kitchens sorted by walk time;
// the Chamber's LTAC reporting gets ONE anonymous, coarse geo-ping telling it
// which part of town visitors actually stand in.
//
// Privacy, in order of enforcement:
//   - Nothing happens until the visitor taps the button, and the browser
//     shows its own permission prompt before any coordinate is read.
//   - We call getCurrentPosition exactly once per tap — never watchPosition.
//   - Coordinates are rounded to 3 decimals (~100 m — about a block) HERE,
//     before they leave the device; /api/track re-rounds and classifies a
//     named area server-side regardless, and stores nothing finer.
//   - The only identifier sent is the same anonymous per-browser-session id
//     the pageview tracker uses ("vk-sid" in sessionStorage — see
//     src/components/tracker.tsx for the canonical pattern mirrored below).
//   - At most one ping is sent per page visit, even if the visitor re-taps.

import { useRef, useState } from "react";
import type { WeeklyHours } from "@/lib/types";
import { getOpenStatus } from "@/lib/hours";
import { EditableText, useCopy } from "@/lib/copy-context";

/** Serializable subset of Restaurant the server page maps into props. */
export interface NearMePlace {
  id: string;
  name: string;
  lat: number;
  lng: number;
  weeklyHours?: WeeklyHours;
  walkMinutesFromFerry: number;
}

const SESSION_KEY = "vk-sid"; // same convention as tracker.tsx
const TOP_N = 6;
/** Casual walking pace: ~80 m per minute. */
const WALK_METERS_PER_MINUTE = 80;

let inMemorySessionId: string | null = null;

function newSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Mirrors tracker.tsx: sessionStorage "vk-sid", in-memory fallback. */
function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = newSessionId();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    if (!inMemorySessionId) inMemorySessionId = newSessionId();
    return inMemorySessionId;
  }
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth radius, meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Round to 3 decimals (~100 m) so precise coordinates never leave the device. */
function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function sendGeoPing(lat: number, lng: number) {
  const body = JSON.stringify({
    type: "geo-ping",
    lat: roundCoord(lat),
    lng: roundCoord(lng),
    sessionId: getSessionId(),
    path: window.location.pathname,
  });
  try {
    if (navigator.sendBeacon?.("/api/track", body)) return;
  } catch {
    // fall through to fetch
  }
  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // best-effort telemetry; never bother the visitor
  });
}

type Status = "idle" | "locating" | "ready" | "denied" | "error";

interface Result {
  place: NearMePlace;
  meters: number;
}

export function NearMe({ places }: { places: NearMePlace[] }) {
  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<Result[]>([]);
  const idleLabel = useCopy("nearme.button.idle");
  const locatingLabel = useCopy("nearme.button.locating");
  // ONE ping per page visit, even across re-taps.
  const pingSent = useRef(false);

  function locate() {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setStatus("error");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const sorted = places
          .map((place) => ({
            place,
            meters: haversineMeters(latitude, longitude, place.lat, place.lng),
          }))
          .sort((a, b) => a.meters - b.meters)
          .slice(0, TOP_N);
        setResults(sorted);
        setStatus("ready");
        if (!pingSent.current) {
          pingSent.current = true;
          sendGeoPing(latitude, longitude);
        }
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
          className="inline-flex items-center gap-1.5 rounded-full bg-sound px-5 py-2.5 text-sm font-semibold text-white hover:bg-sound-deep disabled:opacity-50"
        >
          <span aria-hidden="true">📍</span>
          {status === "locating" ? locatingLabel : idleLabel}
        </button>
        <EditableText
          as="p"
          className="text-xs text-ink-soft"
          copyKey="nearme.disclosure"/>
      </div>

      {status === "denied" && (
        <EditableText
          as="p"
          className="mt-3 text-sm text-ink-soft"
          copyKey="nearme.denied"/>
      )}

      {status === "error" && (
        <EditableText
          as="p"
          className="mt-3 text-sm text-ink-soft"
          copyKey="nearme.error"/>
      )}

      {status === "ready" && (
        <ul className="mt-4 divide-y divide-sand">
          {results.map(({ place, meters }) => {
            const walkMin = Math.max(1, Math.round(meters / WALK_METERS_PER_MINUTE));
            const open = place.weeklyHours ? getOpenStatus(place.weeklyHours) : null;
            return (
              <li
                key={place.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2"
              >
                <span className="min-w-0">
                  <span className="font-medium text-ink">{place.name}</span>
                  {open && (
                    <span
                      className={`ml-2 text-xs font-semibold ${
                        open.open ? "text-fern" : "text-coral-deep"
                      }`}
                    >
                      {open.label}
                    </span>
                  )}
                </span>
                <span className="text-sm tabular-nums text-ink-soft">~{walkMin} min walk</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
