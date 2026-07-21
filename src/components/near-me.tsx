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

import Link from "next/link";
import { useRef, useState } from "react";
import type { WeeklyHours } from "@/lib/types";
import { getOpenStatus } from "@/lib/hours";
import { EditableText, useCopy } from "@/lib/copy-context";
import {
  browserConsentStorage,
  readGeoConsent,
  shouldPromptGeoConsent,
  writeGeoConsent,
} from "@/lib/privacy/consent";
import { PRIVACY_NOTICE_VERSION } from "@/lib/privacy/policy";
import { trackConsent } from "@/components/tracker";

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

// "consent" = the affirmative-consent card is showing, BEFORE the browser's
// own permission prompt (FR-A21: we ask in plain language first, and
// declining must lose nothing).
type Status = "idle" | "consent" | "locating" | "ready" | "denied" | "error";

interface Result {
  place: NearMePlace;
  meters: number;
}

export function NearMe({ places }: { places: NearMePlace[] }) {
  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<Result[]>([]);
  const idleLabel = useCopy("nearme.button.idle");
  const locatingLabel = useCopy("nearme.button.locating");
  const consentAllowLabel = useCopy("nearme.consent.allow");
  const consentDeclineLabel = useCopy("nearme.consent.decline");
  // ONE ping per page visit, even across re-taps.
  const pingSent = useRef(false);
  // Consent held for this pageload (covers a storage-refusing browser).
  const consentGranted = useRef(false);

  /** Tap handler: ask for consent FIRST (unless we already hold consent for
   *  the current notice version), then run the real location flow. */
  function onLocateTap() {
    if (consentGranted.current) return startLocate();
    const stored = readGeoConsent(browserConsentStorage());
    if (shouldPromptGeoConsent(stored, PRIVACY_NOTICE_VERSION, "analytics")) {
      setStatus("consent");
      return;
    }
    consentGranted.current = true;
    startLocate();
  }

  function acceptConsent() {
    consentGranted.current = true; // honored for this pageload even if storage refuses
    writeGeoConsent(browserConsentStorage(), PRIVACY_NOTICE_VERSION, new Date(), "analytics");
    trackConsent("analytics", PRIVACY_NOTICE_VERSION);
    startLocate();
  }

  function declineConsent() {
    // Nothing is lost: the cards below stay sorted by walk time from the dock.
    setStatus("denied");
  }

  function startLocate() {
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
          onClick={onLocateTap}
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

      {/* Affirmative consent (FR-A21) — shown BEFORE the browser prompt, in
          plain language, with a real "no" that costs the visitor nothing. */}
      {status === "consent" && (
        <div
          role="group"
          aria-labelledby="nearme-consent-title"
          className="mt-3 rounded-xl border border-tide bg-seaglass/20 p-4"
        >
          <EditableText
            as="p"
            id="nearme-consent-title"
            className="text-sm font-semibold text-sound-deep"
            copyKey="nearme.consent.title"
          />
          <EditableText
            as="p"
            className="mt-1 text-sm text-ink-soft"
            copyKey="nearme.consent.body"
          />
          <p className="mt-1 text-xs text-ink-soft">
            <Link href="/privacy" className="underline">
              How we handle location
            </Link>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={acceptConsent}
              className="rounded-full bg-sound px-4 py-2 text-sm font-semibold text-white hover:bg-sound-deep"
            >
              {consentAllowLabel}
            </button>
            <button
              type="button"
              onClick={declineConsent}
              className="rounded-full border border-sand px-4 py-2 text-sm font-semibold text-ink hover:border-tide"
            >
              {consentDeclineLabel}
            </button>
          </div>
        </div>
      )}

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
