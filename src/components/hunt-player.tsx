"use client";

// Scavenger hunt engine, v2: photo check-off.
//
// Each stop shows the admin's reference photo ("what you're looking for") when
// one exists. The player's photo now UPLOADS to /api/hunts/submit along with
// GPS coords grabbed at submit time (reusing the GPS check-in fix when it
// succeeded). The server compares the coords to the stop and answers
// verified / unverified:
//   - verified   → "Photo posted from the spot — checked off!"
//   - unverified → accepted on the honor system (GPS missing or out of range)
//   - upload fails (offline) → the player can still complete locally with a
//     "couldn't upload" note, so nobody gets stranded on the beach.
// Progress still lives in localStorage so a hunt survives reloads. Player copy
// is honest: photos are sent to the hunt organizers, not kept on-device.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Hunt, HuntStop } from "@/lib/types";
import { Badge, Card } from "@/components/ui";
import { EditableText, useCopy } from "@/lib/copy-context";
import {
  browserConsentStorage,
  readGeoConsent,
  shouldPromptGeoConsent,
  writeGeoConsent,
} from "@/lib/privacy/consent";
import { PRIVACY_NOTICE_VERSION } from "@/lib/privacy/policy";
import { trackConsent } from "@/components/tracker";

// Per-pageload fallback so a storage-blocked browser doesn't re-ask at every
// stop. Module-scoped because each stop renders its own StopCard.
let huntConsentThisPageload = false;

/** True when we hold consent for the CURRENT notice version FOR THE HUNT.
 *  An analytics (near-me) grant does NOT authorize this: the hunt sends
 *  precise coordinates to the organizers and keeps them 12 months, which is
 *  a materially different ask. */
function hasGeoConsent(): boolean {
  if (huntConsentThisPageload) return true;
  return !shouldPromptGeoConsent(
    readGeoConsent(browserConsentStorage()),
    PRIVACY_NOTICE_VERSION,
    "hunt",
  );
}

function grantGeoConsent(): void {
  huntConsentThisPageload = true; // honored even if storage refuses
  writeGeoConsent(browserConsentStorage(), PRIVACY_NOTICE_VERSION, new Date(), "hunt");
  // Without this, a hunt-first visitor produced geo-tagged submissions with
  // no matching grant anywhere in the aggregate record.
  trackConsent("hunt", PRIVACY_NOTICE_VERSION);
}

/** Hunt shape the player receives: server pages attach reference photo URLs. */
export type PlayerHuntStop = HuntStop & { referencePhotoUrl?: string };
export type PlayerHunt = Omit<Hunt, "stops"> & { stops: PlayerHuntStop[] };

/** How a completed stop got checked off. */
type StopStatus = "verified" | "unverified" | "offline" | "honor";

const STATUS_BADGE: Record<StopStatus, { tone: "green" | "teal" | "sand"; label: string }> = {
  verified: { tone: "green", label: "Photo posted from the spot — checked off!" },
  unverified: { tone: "teal", label: "Photo posted — honor system" },
  offline: { tone: "sand", label: "Done — photo couldn't upload" },
  honor: { tone: "sand", label: "Done — honor system" },
};

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function getPositionOnce(timeoutMs: number): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    );
  });
}

// "needs-consent" = the affirmative-consent card is showing, BEFORE the
// browser's own permission prompt (FR-A21). Declining still lets the visitor
// finish the stop — the honor/"mark done" paths are untouched.
type CheckState =
  | "idle"
  | "needs-consent"
  // "declined" is DISTINCT from "gps-unavailable": telling a visitor who
  // deliberately said no that their GPS failed misreports their own choice.
  | "declined"
  | "locating"
  | "too-far"
  | "confirmed"
  | "gps-unavailable";
type UploadState = "idle" | "uploading" | "failed";

function StopCard({
  huntId,
  stop,
  index,
  status,
  active,
  onComplete,
}: {
  huntId: string;
  stop: PlayerHuntStop;
  index: number;
  /** undefined = not completed yet */
  status: StopStatus | undefined;
  active: boolean;
  onComplete: (status: StopStatus) => void;
}) {
  const [check, setCheck] = useState<CheckState>("idle");
  const [distance, setDistance] = useState<number>();
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [upload, setUpload] = useState<UploadState>("idle");
  const consentAllowLabel = useCopy("nearme.consent.allow");
  const consentDeclineLabel = useCopy("nearme.consent.decline");
  const done = status !== undefined;

  function locate() {
    if (!navigator.geolocation) {
      setCheck("gps-unavailable");
      return;
    }
    // Ask in plain language before the browser prompt, version-gated.
    if (!hasGeoConsent()) {
      setCheck("needs-consent");
      return;
    }
    runLocate();
  }

  function acceptGeoConsent() {
    grantGeoConsent();
    runLocate();
  }

  function runLocate() {
    setCheck("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(here);
        const d = distanceMeters(here.lat, here.lng, stop.lat, stop.lng);
        setDistance(Math.round(d));
        setCheck(d <= stop.radiusMeters ? "confirmed" : "too-far");
      },
      () => setCheck("gps-unavailable"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function submitPhoto(file: File) {
    setUpload("uploading");
    // Reuse the GPS check-in fix if we have one; otherwise grab a position now.
    // Location rides along ONLY with consent. Without it the photo still
    // posts — the hunt works, minus the location the visitor didn't agree to.
    let position = coords;
    if (!position && hasGeoConsent()) {
      const pos = await getPositionOnce(8000);
      if (pos) position = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    }
    const body = new FormData();
    body.append("photo", file);
    body.append("huntId", huntId);
    body.append("stopId", stop.id);
    if (position) {
      body.append("lat", String(position.lat));
      body.append("lng", String(position.lng));
    }
    try {
      const res = await fetch("/api/hunts/submit", { method: "POST", body });
      if (!res.ok) throw new Error(`upload failed (${res.status})`);
      const data = (await res.json()) as { ok: boolean; verified: boolean };
      if (!data.ok) throw new Error("upload rejected");
      setUpload("idle");
      onComplete(data.verified ? "verified" : "unverified");
    } catch {
      setUpload("failed");
    }
  }

  if (!active && !done) {
    return (
      <Card className="opacity-50">
        <p className="text-sm font-semibold text-ink-soft">
          Stop {index + 1} · locked — finish the previous stop first
        </p>
      </Card>
    );
  }

  return (
    <Card className={done ? "border-fern/40 bg-fern/5" : ""}>
      <div className="flex items-center justify-between gap-3">
        <p className="font-display text-lg font-semibold text-sound-deep">
          Stop {index + 1}: {stop.title}
        </p>
        {done && <Badge tone="green">Found ✓</Badge>}
      </div>

      {done ? (
        <div className="mt-2 space-y-2">
          <Badge tone={STATUS_BADGE[status].tone}>{STATUS_BADGE[status].label}</Badge>
          <p className="text-sm text-ink-soft">{stop.funFact}</p>
        </div>
      ) : (
        <>
          <p className="mt-2 text-ink">{stop.clue}</p>
          {showHint ? (
            // text-ink, not text-ink-soft: on a sand/50 tint ink-soft lands at
            // 4.12:1, under AA. This is a scavenger-hunt HINT read outdoors on
            // a phone in daylight — the worst possible place for low contrast.
            <p className="mt-2 rounded-lg bg-sand/50 p-3 text-sm text-ink">💡 {stop.hint}</p>
          ) : (
            <button
              onClick={() => setShowHint(true)}
              className="mt-2 text-sm font-medium text-tide-deep underline underline-offset-2"
            >
              Need a hint?
            </button>
          )}

          {stop.referencePhotoUrl && (
            <div className="mt-4">
              <p className="text-sm font-medium text-ink">👀 What you&apos;re looking for:</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- local API route serves these; next/image can't optimize them */}
              <img
                src={stop.referencePhotoUrl}
                alt={`Reference photo of ${stop.title}`}
                className="mt-2 max-h-56 w-full rounded-xl border border-sand object-cover"
              />
            </div>
          )}

          <div className="mt-4 space-y-3">
            {/* 1. GPS check-in — an assist, not a gate */}
            <div>
              {check === "confirmed" ? (
                <p className="text-sm font-medium text-fern">📍 You&apos;re here! ({distance} m away)</p>
              ) : (
                <button
                  onClick={locate}
                  disabled={check === "locating"}
                  className="rounded-full bg-sound px-4 py-2 text-sm font-semibold text-white hover:bg-sound-deep disabled:opacity-60"
                >
                  {check === "locating" ? "Checking GPS…" : "📍 I'm here — check my location"}
                </button>
              )}
              {/* Affirmative consent before the browser prompt (FR-A21).
                  Declining keeps every other way to finish the stop. */}
              {check === "needs-consent" && (
                <div className="mt-2 rounded-xl border border-tide bg-seaglass/20 p-3">
                  <EditableText
                    as="p"
                    className="text-sm text-ink-soft"
                    copyKey="hunt.consent.body"
                  />
                  <p className="mt-1 text-xs text-ink-soft">
                    <Link href="/privacy" className="underline">
                      How we handle location
                    </Link>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={acceptGeoConsent}
                      className="rounded-full bg-sound px-3 py-1.5 text-sm font-semibold text-white hover:bg-sound-deep"
                    >
                      {consentAllowLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCheck("declined")}
                      className="rounded-full border border-sand px-3 py-1.5 text-sm font-semibold text-ink hover:border-tide"
                    >
                      {consentDeclineLabel}
                    </button>
                  </div>
                </div>
              )}
              {check === "too-far" && (
                <p className="mt-1 text-sm text-coral-deep">
                  You&apos;re about {distance} m away — keep looking! (need to be within{" "}
                  {stop.radiusMeters} m)
                </p>
              )}
              {check === "declined" && (
                <EditableText
                  as="p"
                  className="mt-1 text-sm text-ink-soft"
                  copyKey="hunt.consent.declined"
                />
              )}
              {check === "gps-unavailable" && (
                <p className="mt-1 text-sm text-ink-soft">
                  GPS unavailable — you can still post the photo; it&apos;ll count on the honor
                  system.
                </p>
              )}
            </div>

            {/* 2. Photo → upload → check-off */}
            <div>
              <p className="text-sm font-medium text-ink">📸 {stop.photoPrompt}</p>
              <label
                className={`mt-1 inline-block cursor-pointer rounded-full border border-tide bg-white px-4 py-2 text-sm font-semibold text-tide-deep hover:bg-tide hover:text-white ${
                  upload === "uploading" ? "pointer-events-none opacity-60" : ""
                }`}
              >
                {upload === "uploading"
                  ? "Posting your photo…"
                  : upload === "failed"
                    ? "Try posting again"
                    : "Open camera & post photo"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  disabled={upload === "uploading"}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = ""; // allow re-selecting the same file
                    if (file) void submitPhoto(file);
                  }}
                />
              </label>
              <p className="mt-1 text-xs text-ink-soft">
                <EditableText as="span" copyKey="hunt.disclosure" />{" "}
                <Link href="/privacy" className="underline">
                  How we handle this
                </Link>
              </p>
              {upload === "failed" && (
                <p className="mt-1 text-sm text-coral-deep">
                  Couldn&apos;t upload — bad signal? Try again, or mark the stop done below and keep
                  moving.
                </p>
              )}
            </div>

            {/* 3. Fallbacks so nobody gets stranded */}
            {upload === "failed" && (
              <button
                onClick={() => onComplete("offline")}
                className="rounded-full bg-coral px-5 py-2 text-sm font-semibold text-white hover:bg-coral-deep"
              >
                Mark complete anyway (photo couldn&apos;t upload) →
              </button>
            )}
            {upload !== "uploading" && (
              <p className="text-xs text-ink-soft">
                Can&apos;t post a photo?{" "}
                <button
                  onClick={() => onComplete("honor")}
                  className="font-medium text-tide-deep underline underline-offset-2"
                >
                  Mark it found on the honor system
                </button>
              </p>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

export function HuntPlayer({ hunt }: { hunt: PlayerHunt }) {
  const storageKey = `vk-hunt-${hunt.id}`;
  const statusKey = `vk-hunt-${hunt.id}-status`;
  const [completed, setCompleted] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<Record<string, StopStatus>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      setCompleted(JSON.parse(localStorage.getItem(storageKey) ?? "[]"));
      setStatuses(JSON.parse(localStorage.getItem(statusKey) ?? "{}"));
    } catch {
      // corrupted state — start fresh
    }
    setLoaded(true);
  }, [storageKey, statusKey]);

  const activeIndex = useMemo(
    () => hunt.stops.findIndex((s) => !completed.includes(s.id)),
    [hunt.stops, completed],
  );
  const finished = loaded && activeIndex === -1;

  function completeStop(id: string, status: StopStatus) {
    const nextCompleted = completed.includes(id) ? completed : [...completed, id];
    const nextStatuses = { ...statuses, [id]: status };
    setCompleted(nextCompleted);
    setStatuses(nextStatuses);
    localStorage.setItem(storageKey, JSON.stringify(nextCompleted));
    localStorage.setItem(statusKey, JSON.stringify(nextStatuses));
  }

  function reset() {
    setCompleted([]);
    setStatuses({});
    localStorage.removeItem(storageKey);
    localStorage.removeItem(statusKey);
  }

  if (!loaded) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink-soft">
          {completed.length} of {hunt.stops.length} stops found
        </p>
        {completed.length > 0 && (
          <button onClick={reset} className="text-sm text-ink-soft underline underline-offset-2">
            Start over
          </button>
        )}
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-sand">
        <div
          className="h-full rounded-full bg-fern transition-all"
          style={{ width: `${(completed.length / hunt.stops.length) * 100}%` }}
        />
      </div>

      {finished && (
        <Card className="border-coral/40 bg-coral/5 text-center">
          <p className="font-display text-2xl font-semibold text-sound-deep">🎉 Hunt complete!</p>
          <p className="mt-2 text-ink-soft">
            You found all {hunt.stops.length} stops. Show this screen at a participating downtown
            business and tell them the Chamber sent you.
          </p>
        </Card>
      )}

      {hunt.stops.map((stop, i) => (
        <StopCard
          key={stop.id}
          huntId={hunt.id}
          stop={stop}
          index={i}
          status={completed.includes(stop.id) ? (statuses[stop.id] ?? "honor") : undefined}
          active={i === activeIndex}
          onComplete={(status) => completeStop(stop.id, status)}
        />
      ))}
    </div>
  );
}
