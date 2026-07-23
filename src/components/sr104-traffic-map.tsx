"use client";

// Our replica of WSDOT's "SR 104 Traffic Management System in Kingston" map
// (the ferry boarding-pass / holding-lane system). Route + step locations are
// georeferenced from OpenStreetMap SR 104 geometry and the Barber Cutoff /
// Lindvog Rd junctions; the operational steps come from WSDOT's April 2026
// announcement.
//
// E31 Phase 3 (ADR-0006): migrated from Leaflet+OSM raster to MapLibre GL on our
// self-hosted Protomaps vector tiles. MapLibre + the pmtiles:// protocol are
// loaded dynamically (they touch window at module scope); map.resize() on a
// ResizeObserver keeps a below-the-fold mount from painting half-blank.

import { useEffect, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { FERRY_LINE_STAGING } from "@/lib/ferry-line";
import { TILES_PMTILES_PATH, mapStyle } from "@/lib/map/basemap";
import { loadMapLibre, pmtilesUrl } from "@/lib/map/maplibre";

const WSDOT_POST =
  "https://wsdotblog.blogspot.com/2026/04/smoother-sailing-in-kingston-new-sr-104.html";

// The ferry holding-lane path along SR 104, ordered terminal → Barber Cutoff
// (traffic flows the other way: in from the west, down to the dock). [lat, lng].
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

function stepEl(num: number, color: string): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `width:26px;height:26px;border-radius:50%;background:${color};color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font:700 14px/1 system-ui,sans-serif;cursor:pointer;`;
  el.textContent = String(num);
  return el;
}

function pinEl(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "font-size:22px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));cursor:pointer;";
  el.textContent = "📍";
  return el;
}

export function Sr104TrafficMap({ height = "420px" }: { height?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const resizeObsRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const maplibregl = await loadMapLibre();
      if (cancelled || !containerRef.current || mapRef.current) return;

      const coords = HOLDING_ROUTE.map(([lat, lng]) => [lng, lat] as [number, number]);
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: mapStyle(pmtilesUrl(TILES_PMTILES_PATH)),
        center: [-122.505, 47.803],
        zoom: 12.5,
        scrollZoom: false,
      });
      mapRef.current = map;

      const fit = () =>
        map.fitBounds(
          coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0])),
          { padding: 40, duration: 0 },
        );

      map.on("load", () => {
        if (cancelled) return;

        // The holding-lane route: a white casing under a bright coral line.
        map.addSource("route", {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } },
        });
        map.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.9 } });
        map.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#d96b4f", "line-width": 5 } });

        for (const s of STEPS) {
          new maplibregl.Marker({ element: stepEl(s.num, s.color), anchor: "center" })
            .setLngLat([s.lng, s.lat])
            .setPopup(
              new maplibregl.Popup({ offset: 16, maxWidth: "240px" }).setHTML(
                `<div style="font-size:0.8rem;line-height:1.35;"><p style="margin:0;font-weight:600;">${s.num}. ${esc(s.title)}</p><p style="margin:4px 0 0;">${esc(s.detail)}</p></div>`,
              ),
            )
            .addTo(map);
        }

        // Staging point — where the "Get in the ferry line" button sends drivers
        // when the pass is on (the west end of the SR-104 line).
        new maplibregl.Marker({ element: pinEl(), anchor: "bottom" })
          .setLngLat([FERRY_LINE_STAGING.lng, FERRY_LINE_STAGING.lat])
          .setPopup(
            new maplibregl.Popup({ offset: 20, maxWidth: "240px" }).setHTML(
              `<div style="font-size:0.8rem;line-height:1.35;"><p style="margin:0;font-weight:600;">Join the line here</p><p style="margin:4px 0 0;">When a boarding pass is required, the "Get in the ferry line" button routes you to this spot — approach from the west via Barber Cutoff Rd, and don't U-turn into the line early.</p></div>`,
            ),
          )
          .addTo(map);

        fit();
      });

      requestAnimationFrame(() => {
        if (mapRef.current) mapRef.current.resize();
      });
      const ro = new ResizeObserver(() => mapRef.current?.resize());
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
