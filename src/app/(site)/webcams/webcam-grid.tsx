"use client";

// Renders WSDOT still cameras as a card grid. Each card polls its image on
// the camera's own cadence by swapping a cache-busting ?t= query param —
// required because images.wsdot.wa.gov sends no Cache-Control header, so
// without it browsers can show a stale frame indefinitely. Images are plain
// <img> hotlinks: the host sends no CORS headers, so fetch()/canvas would
// fail, and remote domains aren't configured for next/image.

import { useEffect, useState } from "react";
import type { Webcam } from "@/lib/types";
import { EditableText, useCopy } from "@/lib/copy-context";

function formatAgo(seconds: number): string {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s ago` : `${m}m ago`;
}

function WebcamCard({ cam }: { cam: Webcam }) {
  // stamp doubles as the cache-buster and the "refreshed X ago" anchor.
  // It starts null so the server render and first client render match
  // (no Date.now() hydration mismatch); the real image mounts client-side.
  const [stamp, setStamp] = useState<number | null>(null);
  const [now, setNow] = useState<number>(0);
  const [offline, setOffline] = useState(false);
  const connectingLabel = useCopy("webcams.card.connecting");
  const noImageLabel = useCopy("webcams.card.noImage");

  useEffect(() => {
    const start = Date.now();
    setStamp(start);
    setNow(start);
    const refresh = setInterval(() => {
      setOffline(false); // retry a failed cam on its next cycle
      setStamp(Date.now());
    }, cam.refreshSeconds * 1000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [cam.refreshSeconds]);

  const agoSeconds =
    stamp === null ? 0 : Math.max(0, Math.round((now - stamp) / 1000));

  return (
    <div className="overflow-hidden rounded-2xl border border-sand bg-white shadow-[0_1px_3px_rgba(22,64,94,0.08)]">
      <div className="relative aspect-[4/3] w-full bg-sound/5">
        {stamp === null ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-soft">
            <EditableText copyKey="webcams.card.loading"/>
          </div>
        ) : offline ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
            <EditableText
              className="text-sm font-semibold text-ink"
              copyKey="webcams.card.offlineTitle"/>
            <EditableText
              className="text-xs text-ink-soft"
              copyKey="webcams.card.offlineBody"/>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${cam.imageUrl}?t=${stamp}`}
            alt={`${cam.name} — ${cam.location}`}
            // contain (not cover) so non-4:3 WSDOT feeds aren't cropped — the
            // holding-lane cams are near-square and cover would hide far rows;
            // the bg-sound/5 frame letterboxes the difference.
            className="h-full w-full object-contain"
            loading="lazy"
            onError={() => setOffline(true)}
          />
        )}
      </div>
      <div className="p-4">
        <h3 className="text-lg font-semibold text-sound-deep">{cam.name}</h3>
        <p className="mt-0.5 text-sm text-ink-soft">{cam.location}</p>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-sand px-4 py-2 text-xs text-ink-soft">
        <span>
          {stamp === null
            ? connectingLabel
            : offline
              ? noImageLabel
              : `Refreshed ${formatAgo(agoSeconds)}`}
        </span>
        <a
          href={cam.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
        >
          Courtesy {cam.source}
        </a>
      </div>
    </div>
  );
}

export function WebcamGrid({ cams }: { cams: Webcam[] }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {cams.map((cam) => (
        <WebcamCard key={cam.id} cam={cam} />
      ))}
    </div>
  );
}
