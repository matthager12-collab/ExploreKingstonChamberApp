"use client";

// Our replica of WSDOT's "SR 104 Traffic Management System in Kingston" map
// (the ferry boarding-pass / holding-lane system). Route + step locations are
// georeferenced from OpenStreetMap SR 104 geometry and the Barber Cutoff /
// Lindvog Rd junctions; the operational steps come from WSDOT's April 2026
// announcement. Leaflet is imported dynamically (window at module scope); its
// CSS is global. Map init is hardened with invalidateSize so a below-the-fold
// mount never paints half-blank.

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import { FERRY_LINE_STAGING } from "@/lib/ferry-line";
import { leafletBasemap } from "@/lib/map/basemap";

const WSDOT_POST =
  "https://wsdotblog.blogspot.com/2026/04/smoother-sailing-in-kingston-new-sr-104.html";

// The ferry holding-lane path along SR 104, ordered terminal → Barber Cutoff
// (traffic flows the other way: in from the west, down to the dock).
const HOLDING_ROUTE: [number, number][] = [
  [47.7959, -122.4961], // terminal / tollbooths
  [47.7967, -122.4966],
  [47.797, -122.4969],
  [47.7976, -122.4974],
  [47.7985, -122.498],
  [47.799, -122.4983],
  [47.7996, -122.4984],
  [47.8003, -122.4986],
  [47.8012, -122.4998],
  [47.8014, -122.5004],
  [47.802, -122.5017],
  [47.8027, -122.5034],
  [47.8029, -122.504],
  [47.8033, -122.5045], // pass dispenser (Lindvog Rd)
  [47.8039, -122.5064],
  [47.8049, -122.5091],
  [47.8079, -122.5166],
  [47.8085, -122.518], // flashing sign (Barber Cutoff Rd)
  [47.809, -122.5192],
];

interface Step {
  num: number;
  lat: number;
  lng: number;
  title: string;
  detail: string;
  color: string;
}

const STEPS: Step[] = [
  {
    num: 1,
    lat: 47.8085,
    lng: -122.518,
    title: "Watch for the flashing sign",
    detail:
      "SR 104 & Barber Cutoff Rd. When the overhead lights are flashing, the boarding-pass system is active.",
    color: "#d96b4f",
  },
  {
    num: 2,
    lat: 47.8033,
    lng: -122.5045,
    title: "Take a boarding pass",
    detail:
      "Follow the signal into the designated ferry lane and stop at the automated dispenser near Lindvog Rd.",
    color: "#d96b4f",
  },
  {
    num: 3,
    lat: 47.7959,
    lng: -122.4961,
    title: "Wait for green, then board",
    detail:
      "When the terminal has space your light turns green — pull forward to the tollbooths. Leave the line and your pass is void.",
    color: "#16405e",
  },
];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function Sr104TrafficMap({ height = "420px" }: { height?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const resizeObsRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, { scrollWheelZoom: false });
      mapRef.current = map;
      leafletBasemap(L).addTo(map);

      // The holding-lane route: a casing + a bright coral line with arrowheads
      // implied by the numbered stops.
      L.polyline(HOLDING_ROUTE, { color: "#ffffff", weight: 9, opacity: 0.9 }).addTo(map);
      L.polyline(HOLDING_ROUTE, { color: "#d96b4f", weight: 5, opacity: 0.95 }).addTo(map);

      for (const s of STEPS) {
        const icon = L.divIcon({
          className: "",
          html: `<div style="transform:translate(-50%,-50%);width:26px;height:26px;border-radius:50%;background:${s.color};color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font:700 14px/1 system-ui,sans-serif;">${s.num}</div>`,
          iconSize: [0, 0],
        });
        L.marker([s.lat, s.lng], { icon })
          .addTo(map)
          .bindPopup(
            `<div style="font-size:0.8rem;line-height:1.35;max-width:220px;">
              <p style="margin:0;font-weight:600;">${s.num}. ${esc(s.title)}</p>
              <p style="margin:4px 0 0;">${esc(s.detail)}</p>
            </div>`,
            { maxWidth: 240 },
          );
      }

      // Staging point — exactly where the "Get in the ferry line" button sends
      // drivers when the pass is on (the end of the SR-104 line).
      L.marker([FERRY_LINE_STAGING.lat, FERRY_LINE_STAGING.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="transform:translate(-50%,-100%);font-size:22px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));">📍</div>`,
          iconSize: [0, 0],
        }),
      })
        .addTo(map)
        .bindPopup(
          `<div style="font-size:0.8rem;line-height:1.35;max-width:220px;">
            <p style="margin:0;font-weight:600;">Join the line here</p>
            <p style="margin:4px 0 0;">When a boarding pass is required, the "Get in the ferry line" button routes you to this spot — approach from the west via Barber Cutoff Rd, and don't U-turn into the line early.</p>
          </div>`,
          { maxWidth: 240 },
        );

      const bounds = L.latLngBounds(HOLDING_ROUTE);
      const fit = () => map.fitBounds(bounds, { padding: [40, 40] });
      fit();

      requestAnimationFrame(() => {
        if (mapRef.current) {
          map.invalidateSize();
          fit();
        }
      });
      const ro = new ResizeObserver(() => {
        if (mapRef.current) map.invalidateSize();
      });
      ro.observe(containerRef.current);
      resizeObsRef.current = ro;
    })();

    return () => {
      cancelled = true;
      resizeObsRef.current?.disconnect();
      resizeObsRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div>
      <div
        ref={containerRef}
        style={{ height }}
        className="relative z-0 w-full overflow-hidden rounded-2xl border border-sand"
        role="region"
        aria-label="Map of the SR 104 ferry boarding-pass system in Kingston"
      />
      <ol className="mt-3 grid gap-2 sm:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.num} className="flex gap-2 rounded-xl bg-shell/70 p-3">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{ backgroundColor: s.color }}
            >
              {s.num}
            </span>
            <span className="text-sm">
              <span className="font-semibold text-sound-deep">{s.title}.</span>{" "}
              <span className="text-ink">{s.detail}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-ink">
        When the pass is on, join the line from the <span className="font-medium text-ink">west,
        coming down SR 104 via Barber Cutoff Rd</span> — don&apos;t U-turn into the line early. Only
        when the wait tops <span className="font-medium text-ink">2 hours</span> and the line backs
        up past Barber Cutoff do you go further out to <span className="font-medium text-ink">Miller
        Bay Rd</span> to turn around. Active daily 8 a.m.–8 p.m. through the peak season, plus
        weekends and holidays. Walk-ons, cyclists, and motorcycles skip it entirely;
        medical-preference vehicles go straight to the tollbooths. Adapted from{" "}
        <a
          href={WSDOT_POST}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
        >
          WSDOT&apos;s announcement
        </a>
        .
      </p>
    </div>
  );
}
