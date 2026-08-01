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
//
// Two mounting modes, and the difference is a caching constraint, not a visual
// one — see the `initial` prop's doc comment before changing either:
//   /ferry  — dynamic page, passes a server-rendered `initial`.
//   /line   — statically prerendered, passes NOTHING and lets the map fetch its
//             own first payload on reveal, so a 10s-revalidate fetch never
//             enters that page's ISR window.
// Both defer polling until the map is actually in view.

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { VesselPosition } from "@/lib/wsf";
import { mapStyle } from "@/lib/map/basemap";
import { basemapArchiveUrl, loadMapLibre } from "@/lib/map/maplibre";
import { fixMarkerA11y } from "@/lib/map/marker-a11y";
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

// Original top-down ferry icon evoking Washington State Ferries livery — the
// classic double-ended Salish look: elongated white-trimmed hull, long green
// cabin band with a roof walkway, open car deck at the stern. A thin dark
// outline plus a soft white halo keep it readable over water and land alike.
// Drawn bow-up so `rotation: v.heading` (compass degrees) points it the right
// way; because the real boats are double-ended, the dark wheelhouse block at
// the bow (vs the lighter open stern deck) is what makes the heading legible.
// All sizing is inline (explicit width/height/display) so global CSS cannot
// resize it. This is the owner-approved "candidate B" from the 2026-08-01
// mockup review.
function vesselIconSvg(): string {
  const hull =
    "M15 3 C20.6 7 24 11.4 24 16.4 L24 37.6 C24 42.6 20.6 47 15 51 C9.4 47 6 42.6 6 37.6 L6 16.4 C6 11.4 9.4 7 15 3 Z";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 56" width="21" height="40" style="display:block" aria-hidden="true">` +
    `<path d="${hull}" fill="none" stroke="#ffffff" stroke-width="5" stroke-opacity="0.9"/>` +
    `<path d="${hull}" fill="#fdfffe" stroke="#16333d" stroke-width="1.5"/>` +
    `<path d="M15 5.6 C19.2 8.8 21.6 12.4 21.6 16.8 L21.6 37.2 C21.6 41.6 19.2 45.2 15 48.4 C10.8 45.2 8.4 41.6 8.4 37.2 L8.4 16.8 C8.4 12.4 10.8 8.8 15 5.6 Z" fill="none" stroke="#0a7d5c" stroke-width="1.3" stroke-opacity="0.95"/>` +
    `<rect x="11.6" y="40.5" width="6.8" height="5" rx="1.5" fill="#c3cfd4"/>` +
    `<rect x="10.2" y="15.5" width="9.6" height="24" rx="4.8" fill="#0a7d5c"/>` +
    `<rect x="14.1" y="18" width="1.8" height="19" rx="0.9" fill="#ffffff" fill-opacity="0.9"/>` +
    `<rect x="11.6" y="11.6" width="6.8" height="3.8" rx="1.5" fill="#12333f"/>` +
    `</svg>`
  );
}

function vesselEl(v: VesselPosition): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "line-height:0;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));cursor:pointer;";
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", `Ferry ${v.name}`);
  el.innerHTML = vesselIconSvg();
  return el;
}

const NO_VESSELS: VesselData = { vessels: [], live: false };

export function FerryVesselMap({
  initial,
  height = "380px",
}: {
  /**
   * Server-rendered first payload. OMIT IT on a statically prerendered page:
   * getVesselLocations() fetches with revalidate 10, and Next collapses a
   * prerendered route's ISR window to the shortest revalidate reachable from
   * it (incremental-static-regeneration.md — "the lowest time will be used").
   * /line declares 60, already sits at 30 via getRouteDelays, and would drop
   * to 10 just by rendering this map. With `initial` omitted the map fetches
   * its own first payload when it scrolls into view, so the page's cache
   * window is untouched and nothing is fetched at all for a visitor who never
   * scrolls this far. /ferry still passes it: that page reads cookies, so it
   * is dynamic anyway and its revalidate is already inert.
   */
  initial?: VesselData;
  height?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<typeof import("maplibre-gl") | null>(null);
  const vesselMarkersRef = useRef<MapLibreMarker[]>([]);
  const resizeObsRef = useRef<ResizeObserver | null>(null);
  const [data, setData] = useState<VesselData>(initial ?? NO_VESSELS);
  // Only true in the no-`initial` mode, and only until the first fetch settles.
  // Without it the caption would claim the WSDOT feed is down during the normal
  // second-or-so before the first payload lands.
  const [awaitingFirst, setAwaitingFirst] = useState(initial === undefined);
  // Polling is gated on the same reveal that loads the map: refreshing vessel
  // positions onto a map the visitor cannot see is pure cellular spend.
  const [inView, setInView] = useState(false);

  // ---- redraw vessels whenever data changes (no-op until the map exists) ----
  function renderVessels() {
    const maplibregl = maplibreRef.current;
    const map = mapRef.current;
    if (!maplibregl || !map) return;
    for (const m of vesselMarkersRef.current) m.remove();
    vesselMarkersRef.current = data.vessels.map((v) => {
      const m = new maplibregl.Marker({ element: vesselEl(v), anchor: "center", rotation: v.heading })
        .setLngLat([v.lng, v.lat])
        .setPopup(new maplibregl.Popup({ offset: 14, maxWidth: "220px" }).setHTML(vesselPopup(v)))
        .addTo(map);
      // Restores vesselEl()'s name — addTo() clobbers it (see fixMarkerA11y).
      fixMarkerA11y(m, `Ferry ${v.name}`);
      return m;
    });
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
        style: mapStyle(basemapArchiveUrl()),
        center: [-122.44, 47.804],
        zoom: 10.5,
        scrollZoom: false,
      });
      mapRef.current = map;
      // Unique canvas name — MapLibre's default "Map" collides with the
      // SR-104 map's canvas on /ferry and /line (axe landmark-unique).
      map.getCanvas().setAttribute("aria-label", "Edmonds–Kingston vessel positions");
      // Leaflet showed +/- buttons by default; with scrollZoom off they are the
      // only mouse way to zoom, so MapLibre needs them added explicitly.
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

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
          const m = new maplibregl.Marker({ element: terminalEl(t.name), anchor: "left" }).setLngLat([t.lng, t.lat]).addTo(map);
          fixMarkerA11y(m, `${t.name} ferry terminal`);
        }
        renderVessels();
        fit();
      });

      requestAnimationFrame(() => mapRef.current?.resize());
      const ro = new ResizeObserver(() => mapRef.current?.resize());
      ro.observe(containerRef.current);
      resizeObsRef.current = ro;
    };

    // Revealing does two things: builds the map, and releases the poller.
    const reveal = () => {
      setInView(true);
      void init();
    };

    if (typeof IntersectionObserver === "undefined") {
      // No IntersectionObserver (jsdom, very old browsers): show it immediately,
      // but on a microtask — setState straight from an effect body cascades a
      // render, and react-hooks/set-state-in-effect rightly rejects it.
      queueMicrotask(() => {
        if (!cancelled) reveal();
      });
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io.disconnect();
            reveal();
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

  // ---- poll every 20s once revealed, paused while hidden ----
  useEffect(() => {
    if (!inView) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      // Returning before the try is deliberate: a skipped poll must not settle
      // `awaitingFirst`, or a map revealed in a background tab would flip to
      // "feed is down" without ever having asked.
      if (document.hidden) return;
      try {
        const res = await fetch("/api/ferry/vessels");
        if (res.ok) setData((await res.json()) as VesselData);
      } catch {
        // keep the last-known positions on a transient failure
      } finally {
        setAwaitingFirst(false);
      }
    };
    // No server payload means the map has nothing to draw yet, so fetch on
    // reveal rather than leaving it empty for a full interval.
    if (initial === undefined) void poll();
    timer = setInterval(poll, 20_000);
    const onVisible = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView]);

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
        {awaitingFirst
          ? "Finding the boats… "
          : data.live
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
