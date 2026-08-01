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
// E33: the holding-lane polyline + step locations moved to the pure geometry
// lib so server pages (/line) can measure distances against the line without
// importing this MapLibre client component. Same coordinates, one owner.
import {
  HOLDING_ROUTE,
  LINE_DISPENSER,
  LINE_FLASHING_SIGN,
  LINE_TERMINAL,
} from "@/lib/ferry-line-geometry";
import { mapStyle } from "@/lib/map/basemap";
import { basemapArchiveUrl, loadMapLibre } from "@/lib/map/maplibre";
import { fixMarkerA11y } from "@/lib/map/marker-a11y";
import { MapTouchLockOverlay, useMapTouchLock } from "@/components/map-touch-lock";

const WSDOT_POST =
  "https://wsdotblog.blogspot.com/2026/04/smoother-sailing-in-kingston-new-sr-104.html";

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
    lat: LINE_FLASHING_SIGN[0],
    lng: LINE_FLASHING_SIGN[1],
    title: "Watch for the flashing sign",
    detail:
      "SR 104 & Barber Cutoff Rd. When the overhead lights are flashing, the boarding-pass system is active.",
    color: "#d96b4f",
  },
  {
    num: 2,
    lat: LINE_DISPENSER[0],
    lng: LINE_DISPENSER[1],
    title: "Take a boarding pass",
    detail:
      "Follow the signal into the designated ferry lane and stop at the automated dispenser near Lindvog Rd.",
    color: "#d96b4f",
  },
  {
    num: 3,
    lat: LINE_TERMINAL[0],
    lng: LINE_TERMINAL[1],
    title: "Wait for green, then board",
    detail:
      "When the terminal has space your light turns green — pull forward to the tollbooths and pay there.",
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

function glyphEl(glyph: string): HTMLElement {
  const el = document.createElement("div");
  // Smaller than the numbered step markers on purpose: the boarding-pass steps
  // are what this map is FOR, and food/restrooms are context around them.
  el.style.cssText =
    "font-size:17px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));cursor:pointer;";
  el.textContent = glyph;
  return el;
}

/** A place to draw alongside the boarding-pass steps. Plain serialisable data
 *  so a server component can hand it straight to this client component. */
export interface Sr104MapPin {
  id: string;
  title: string;
  lat: number;
  lng: number;
  /** One line of context in the popup — walk time, hours, a provenance caveat. */
  note?: string;
}

export function Sr104TrafficMap({
  height = "420px",
  food = [],
  restrooms = [],
}: {
  height?: string;
  /** Places to eat, drawn as 🍴. /line passes the same open-now, distance-ranked
   *  rows the food list above it renders, so the map and the list can never
   *  disagree about what is open. Empty on /ferry and /parking, where the map
   *  is explaining the pass system rather than serving someone already parked. */
  food?: Sr104MapPin[];
  /** Restrooms, drawn as 🚻. Same reasoning as `food`. */
  restrooms?: Sr104MapPin[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const resizeObsRef = useRef<ResizeObserver | null>(null);
  const touchLock = useMapTouchLock();

  useEffect(() => {
    let cancelled = false;
    let cleanupIo: (() => void) | undefined;
    const container = containerRef.current;
    if (!container) return;

    const init = async () => {
      const maplibregl = await loadMapLibre();
      if (cancelled || !containerRef.current || mapRef.current) return;

      const coords = HOLDING_ROUTE.map(([lat, lng]) => [lng, lat] as [number, number]);
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: mapStyle(basemapArchiveUrl()),
        center: [-122.505, 47.803],
        zoom: 12.5,
        scrollZoom: false,
      });
      mapRef.current = map;
      // Unique canvas name — MapLibre's default "Map" collides with the
      // vessel map's canvas on /ferry and /line (axe landmark-unique).
      map.getCanvas().setAttribute("aria-label", "SR 104 boarding-pass line map");
      // Leaflet showed +/- buttons by default; with scrollZoom off they are the
      // only mouse way to zoom, so MapLibre needs them added explicitly.
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      // scrollZoom:false only governs the mouse wheel. On touch, dragPan is what
      // eats the page's vertical swipes, so this map has to be tapped before it
      // takes over panning — /line puts it mid-page, where scrolling past it has
      // to keep working.
      touchLock.applyTo(map);

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
          const stepMarker = new maplibregl.Marker({ element: stepEl(s.num, s.color), anchor: "center" })
            .setLngLat([s.lng, s.lat])
            .setPopup(
              new maplibregl.Popup({ offset: 16, maxWidth: "240px" }).setHTML(
                `<div style="font-size:0.8rem;line-height:1.35;"><p style="margin:0;font-weight:600;">${s.num}. ${esc(s.title)}</p><p style="margin:4px 0 0;">${esc(s.detail)}</p></div>`,
              ),
            )
            .addTo(map);
          fixMarkerA11y(stepMarker, `${s.num}. ${s.title}`);
        }

        // Staging point — where the "Get in the ferry line" button sends drivers
        // when the pass is on (the west end of the SR-104 line).
        const stagingMarker = new maplibregl.Marker({ element: pinEl(), anchor: "bottom" })
          .setLngLat([FERRY_LINE_STAGING.lng, FERRY_LINE_STAGING.lat])
          .setPopup(
            new maplibregl.Popup({ offset: 20, maxWidth: "240px" }).setHTML(
              `<div style="font-size:0.8rem;line-height:1.35;"><p style="margin:0;font-weight:600;">Join the line here</p><p style="margin:4px 0 0;">When a boarding pass is required, the "Get in the ferry line" button routes you to this spot — approach from the west via Barber Cutoff Rd, and don't U-turn into the line early.</p></div>`,
            ),
          )
          .addTo(map);
        fixMarkerA11y(stagingMarker, "Join the ferry line here");

        // Context pins: what is near the line, not part of the pass system.
        // Drawn AFTER the numbered steps so a coincident step marker keeps the
        // upper hand — the steps are what this map is for.
        for (const [glyph, pins] of [
          ["🍴", food],
          ["🚻", restrooms],
        ] as const) {
          for (const p of pins) {
            const glyphMarker = new maplibregl.Marker({ element: glyphEl(glyph), anchor: "center" })
              .setLngLat([p.lng, p.lat])
              .setPopup(
                new maplibregl.Popup({ offset: 14, maxWidth: "240px" }).setHTML(
                  `<div style="font-size:0.8rem;line-height:1.35;"><p style="margin:0;font-weight:600;">${glyph} ${esc(p.title)}</p>${
                    p.note ? `<p style="margin:4px 0 0;">${esc(p.note)}</p>` : ""
                  }</div>`,
                ),
              )
              .addTo(map);
            fixMarkerA11y(glyphMarker, p.title);
          }
        }

        // Bounds stay on the ROUTE, deliberately: the pins cluster at the dock
        // end, and one distant restaurant extending the box would zoom the
        // boarding-pass system — the thing this map exists to show — down to
        // nothing. Off-frame pins are still there when you pan.
        fit();
      });

      requestAnimationFrame(() => {
        if (mapRef.current) mapRef.current.resize();
      });
      const ro = new ResizeObserver(() => mapRef.current?.resize());
      ro.observe(containerRef.current);
      resizeObsRef.current = ro;
    };

    // Defer the ~200 KB MapLibre engine until the map scrolls into view, so it
    // stays off the initial-load critical path (the E15 Lighthouse perf budget).
    // Loads ~200px early for a seamless scroll; a viewer who never reaches the
    // map — including Lighthouse, which does not scroll — never pays for it.
    if (typeof IntersectionObserver === "undefined") {
      void init();
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io.disconnect();
            void init();
          }
        },
        { rootMargin: "200px" },
      );
      io.observe(container);
      cleanupIo = () => io.disconnect();
    }

    return () => {
      cancelled = true;
      cleanupIo?.();
      resizeObsRef.current?.disconnect();
      resizeObsRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Build the map exactly once. `food` and `restrooms` are server-rendered
    // props on a page with no client-side data fetching, so they never change
    // after hydration; listing them would tear down and rebuild the whole map
    // on every parent render for no gain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="relative">
        <div
          ref={containerRef}
          style={{ height }}
          className="relative z-0 w-full overflow-hidden rounded-2xl border border-sand"
          role="region"
          aria-label="Map of the SR 104 ferry boarding-pass system in Kingston"
        />
        {touchLock.locked && <MapTouchLockOverlay onUnlock={touchLock.unlock} />}
      </div>
      {/* Only when there is something to explain — /ferry and /parking pass no
          pins and get no legend. Each entry names its count so an empty
          category reads as "none mapped" rather than a glyph you hunt for. */}
      {(food.length > 0 || restrooms.length > 0) && (
        <p className="mt-2 text-xs text-ink">
          Also on the map:{" "}
          {[
            food.length > 0 && `🍴 ${food.length} open now`,
            restrooms.length > 0 && `🚻 ${restrooms.length} restrooms`,
          ]
            .filter(Boolean)
            .join(" · ")}
          . Tap a pin for details.
        </p>
      )}
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
