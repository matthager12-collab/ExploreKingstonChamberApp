"use client";

// Live Edmonds–Kingston vessel map — our own take on WSDOT's VesselWatch.
// Shows both terminals, the crossing line, and the boats' real-time positions
// (heading-rotated ferry markers) from /api/ferry/vessels, polled every ~20s
// and paused while the tab is hidden.
//
// E31 Phase 3 (ADR-0006): migrated from Leaflet+OSM raster to MapLibre GL on our
// self-hosted Protomaps vector tiles. MapLibre is loaded lazily on scroll-into-
// view (it is ~200 KB — the E15 perf budget), and map.resize() on a
// ResizeObserver keeps a below-the-fold mount from painting half-blank. The tile
// bbox was widened to cover the whole crossing east to Edmonds.

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { VesselPosition } from "@/lib/wsf";
import { TILES_PMTILES_PATH, mapStyle } from "@/lib/map/basemap";
import { loadMapLibre, pmtilesUrl } from "@/lib/map/maplibre";
import { formatPacificTime } from "@/lib/time";

const EDMONDS = { lat: 47.8125, lng: -122.3829, name: "Edmonds" };
const KINGSTON = { lat: 47.7963, lng: -122.4965, name: "Kingston" };
const WSDOT_VESSELWATCH = "https://www.wsdot.com/ferries/vesselwatch/";

interface VesselData {
  vessels: VesselPosition[];
  live: boolean;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function vesselPopup(v: VesselPosition): string {
  const status = v.atDock
    ? "At the dock"
    : `Underway${v.speed ? ` · ${Math.round(v.speed)} kn` : ""}`;
  const lines = [
    `<p style="margin:0;font-weight:600;font-size:0.95rem;">⛴️ ${esc(v.name)}</p>`,
    `<p style="margin:4px 0 0;">${esc(status)}</p>`,
  ];
  if (!v.atDock && v.headedTo) lines.push(`<p style="margin:2px 0 0;">Headed to ${esc(v.headedTo)}</p>`);
  if (v.eta && !v.atDock) lines.push(`<p style="margin:2px 0 0;">ETA ${esc(formatPacificTime(v.eta))}</p>`);
  return `<div style="font-size:0.8rem;line-height:1.35;">${lines.join("")}</div>`;
}

function terminalEl(name: string): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "display:flex;align-items:center;gap:4px;white-space:nowrap;pointer-events:none;";
  el.innerHTML =
    `<span style="width:11px;height:11px;border-radius:50%;background:#16405e;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);"></span>` +
    `<span style="font:600 11px/1.2 system-ui,sans-serif;color:#16405e;background:rgba(255,255,255,.85);border-radius:4px;padding:1px 5px;">${name}</span>`;
  return el;
}

function vesselEl(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "font-size:22px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));cursor:pointer;";
  el.textContent = "⛴️";
  return el;
}

export function FerryVesselMap({
  initial,
  height = "380px",
}: {
  initial: VesselData;
  height?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<typeof import("maplibre-gl") | null>(null);
  const vesselMarkersRef = useRef<MapLibreMarker[]>([]);
  const resizeObsRef = useRef<ResizeObserver | null>(null);
  const [data, setData] = useState<VesselData>(initial);

  // ---- redraw vessels whenever data changes (no-op until the map exists) ----
  function renderVessels() {
    const maplibregl = maplibreRef.current;
    const map = mapRef.current;
    if (!maplibregl || !map) return;
    for (const m of vesselMarkersRef.current) m.remove();
    vesselMarkersRef.current = data.vessels.map((v) =>
      new maplibregl.Marker({ element: vesselEl(), anchor: "center", rotation: v.heading })
        .setLngLat([v.lng, v.lat])
        .setPopup(new maplibregl.Popup({ offset: 14, maxWidth: "220px" }).setHTML(vesselPopup(v)))
        .addTo(map),
    );
  }

  // ---- init map once, deferred until it scrolls into view (perf budget) ----
  useEffect(() => {
    let cancelled = false;
    let cleanupIo: (() => void) | undefined;
    const container = containerRef.current;
    if (!container) return;

    const init = async () => {
      const maplibregl = await loadMapLibre();
      if (cancelled || !containerRef.current || mapRef.current) return;
      maplibreRef.current = maplibregl;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: mapStyle(pmtilesUrl(TILES_PMTILES_PATH)),
        center: [-122.44, 47.804],
        zoom: 10.5,
        scrollZoom: false,
      });
      mapRef.current = map;

      // Build via extend so corner order does not matter (the two-arg
      // constructor needs sw/ne and silently inverts if they are swapped).
      const bounds = new maplibregl.LngLatBounds([EDMONDS.lng, EDMONDS.lat], [EDMONDS.lng, EDMONDS.lat]);
      bounds.extend([KINGSTON.lng, KINGSTON.lat]);
      const fit = () => map.fitBounds(bounds, { padding: 50, duration: 0 });

      map.on("load", () => {
        if (cancelled) return;
        // Crossing line (dashed).
        map.addSource("crossing", {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[EDMONDS.lng, EDMONDS.lat], [KINGSTON.lng, KINGSTON.lat]] } },
        });
        map.addLayer({ id: "crossing", type: "line", source: "crossing", paint: { "line-color": "#16405e", "line-width": 2, "line-opacity": 0.4, "line-dasharray": [2, 3] } });
        // Terminal markers (static, non-interactive).
        for (const t of [EDMONDS, KINGSTON]) {
          new maplibregl.Marker({ element: terminalEl(t.name), anchor: "left" }).setLngLat([t.lng, t.lat]).addTo(map);
        }
        renderVessels();
        fit();
      });

      requestAnimationFrame(() => mapRef.current?.resize());
      const ro = new ResizeObserver(() => mapRef.current?.resize());
      ro.observe(containerRef.current);
      resizeObsRef.current = ro;
    };

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
      for (const m of vesselMarkersRef.current) m.remove();
      vesselMarkersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      maplibreRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    renderVessels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // ---- poll every 20s, paused while hidden ----
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/ferry/vessels");
        if (res.ok) setData((await res.json()) as VesselData);
      } catch {
        // keep the last-known positions on a transient failure
      }
    };
    timer = setInterval(poll, 20_000);
    const onVisible = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const noBoats = data.vessels.length === 0;

  return (
    <div>
      <div
        ref={containerRef}
        style={{ height }}
        className="relative z-0 w-full overflow-hidden rounded-2xl border border-sand"
        role="region"
        aria-label="Live map of the Edmonds–Kingston ferries"
      />
      <p className="mt-2 text-xs text-ink">
        {data.live
          ? `Live vessel positions from WSDOT, refreshed every 20 seconds${
              noBoats ? " — no Edmonds–Kingston boats are reporting a position right now." : "."
            }`
          : "Live positions need the WSDOT feed. "}
        Full map with every route on{" "}
        <a
          href={WSDOT_VESSELWATCH}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
        >
          WSDOT VesselWatch
        </a>
        .
      </p>
    </div>
  );
}
