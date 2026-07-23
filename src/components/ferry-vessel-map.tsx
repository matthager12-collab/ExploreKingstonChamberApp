"use client";

// Live Edmonds–Kingston vessel map — our own take on WSDOT's VesselWatch.
// Shows both terminals, the crossing line, and the boats' real-time positions
// (heading-rotated ferry markers) from /api/ferry/vessels, polled every ~20s
// and paused while the tab is hidden. Leaflet is imported dynamically inside
// the effect (it touches window at module scope); its CSS is global.

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import type { VesselPosition } from "@/lib/wsf";
import { leafletBasemap } from "@/lib/map/basemap";
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

export function FerryVesselMap({
  initial,
  height = "380px",
}: {
  initial: VesselData;
  height?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const vesselLayerRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const resizeObsRef = useRef<ResizeObserver | null>(null);
  const [data, setData] = useState<VesselData>(initial);

  // ---- init map once ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      leafletRef.current = L;

      const map = L.map(containerRef.current, { scrollWheelZoom: false });
      mapRef.current = map;
      leafletBasemap(L).addTo(map);

      // Crossing line + terminal markers.
      L.polyline(
        [
          [EDMONDS.lat, EDMONDS.lng],
          [KINGSTON.lat, KINGSTON.lng],
        ],
        { color: "#16405e", weight: 2, opacity: 0.4, dashArray: "6 8" },
      ).addTo(map);

      for (const t of [EDMONDS, KINGSTON]) {
        L.marker([t.lat, t.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div style="display:flex;align-items:center;gap:4px;transform:translate(-6px,-50%);white-space:nowrap;">
              <span style="width:11px;height:11px;border-radius:50%;background:#16405e;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);"></span>
              <span style="font:600 11px/1.2 system-ui,sans-serif;color:#16405e;background:rgba(255,255,255,.85);border-radius:4px;padding:1px 5px;">${t.name}</span>
            </div>`,
            iconSize: [0, 0],
          }),
          interactive: false,
        }).addTo(map);
      }

      const bounds: [[number, number], [number, number]] = [
        [EDMONDS.lat, EDMONDS.lng],
        [KINGSTON.lat, KINGSTON.lng],
      ];
      const fit = () => map.fitBounds(bounds, { padding: [40, 40] });
      fit();

      vesselLayerRef.current = L.layerGroup().addTo(map);
      renderVessels();

      // The section can mount below the fold, so the container's final size
      // may land a frame after init — recompute tile layout and refit then,
      // and whenever the container resizes, so the map never paints half-blank.
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
      vesselLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- redraw vessels whenever data changes ----
  function renderVessels() {
    const L = leafletRef.current;
    const layer = vesselLayerRef.current;
    if (!L || !layer) return;
    layer.clearLayers();
    for (const v of data.vessels) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="transform:translate(-50%,-50%) rotate(${v.heading}deg);font-size:22px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));">⛴️</div>`,
        iconSize: [0, 0],
      });
      L.marker([v.lat, v.lng], { icon }).addTo(layer).bindPopup(vesselPopup(v), { maxWidth: 220 });
    }
  }

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
