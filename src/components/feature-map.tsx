"use client";

// Public, reusable MapLibre map that renders any named MapView anywhere in the
// app. It fetches the resolved view from /api/map/<view> (view config + custom
// features + built-in-source payloads) and draws every layer client-side on our
// self-hosted Protomaps vector tiles (E31, ADR-0006).
//
// MapLibre + the pmtiles:// protocol touch `window`, so they load dynamically
// inside the effect, and only once the map scrolls into view (the engine is
// ~200 KB — the E15 perf budget). Pins are HTML markers; lines/areas are batched
// GeoJSON layers with layer-level click→popup handlers (MapLibre renders
// geometry in layers, not per-object like Leaflet). On-map name labels keep the
// bespoke greedy declutter, rewired to MapLibre's project()/getBounds().
//
// Colors on the map canvas are intentionally hex — they live on the tiles, not
// in the page's token system, and are kept consistent with town-map.tsx.

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  markerCategory,
  featureColor,
  featureImages,
  parkingTypeInfo,
  resolveLabel,
  type MapFeature,
  type ResolvedMapView,
  type LabelShow,
  type LabelDir,
} from "@/lib/map/types";
import { TILES_PMTILES_PATH, mapStyle } from "@/lib/map/basemap";
import { loadMapLibre, pmtilesUrl } from "@/lib/map/maplibre";

// ---- shared color conventions (kept in sync with town-map.tsx) ----

const PARKING_RULE_COLORS: Record<string, string> = {
  "free-2hr": "#2e9e4f",
  "free-unrestricted": "#1E96C0",
  paid: "#7c4dbe",
  "park-and-ride-24h": "#e8891d",
  prohibited: "#d43d3d",
  "load-zone": "#f0b429",
  permit: "#6b7280",
};
const FALLBACK_PARKING_COLOR = "#6b7280";

function parkingColor(rule: string): string {
  return PARKING_RULE_COLORS[rule] ?? FALLBACK_PARKING_COLOR;
}

const PARKING_RULE_LABELS: Record<string, string> = {
  "free-2hr": "Free · 2-hour limit",
  "free-unrestricted": "Free · no time limit",
  paid: "Paid lot",
  "park-and-ride-24h": "Park & ride · 24 hr",
  prohibited: "No parking",
  "load-zone": "Load zone",
  permit: "Permit parking",
};

type StreetRule =
  | "free-2hr"
  | "free-unrestricted"
  | "prohibited"
  | "ferry-holding"
  | "default";

const STREET_COLORS: Record<StreetRule, string> = {
  "free-2hr": "#2e9e4f",
  "free-unrestricted": "#1E96C0",
  prohibited: "#d43d3d",
  "ferry-holding": "#64748b",
  default: "#8b9aa8",
};

const STREET_RULE_LABELS: Record<StreetRule, string> = {
  "free-2hr": "Free street parking · 2-hour limit",
  "free-unrestricted": "Free street parking · no time limit",
  prohibited: "No street parking",
  "ferry-holding":
    "Ferry holding corridor — this is the line for the boat, not street parking",
  default: "No known restriction — free where unsigned",
};

function normalizeStreetRule(rule: string): StreetRule {
  return rule in STREET_COLORS ? (rule as StreetRule) : "default";
}

/** Per-rule street line style: [width, opacity, dashed]. Dashed streets go in a
 *  separate MapLibre layer because line-dasharray can't be data-driven. */
function streetLineStyle(rule: StreetRule): { width: number; opacity: number; dashed: boolean } {
  switch (rule) {
    case "ferry-holding":
      return { width: 3, opacity: 0.45, dashed: true };
    case "prohibited":
      return { width: 4, opacity: 0.6, dashed: false };
    case "free-2hr":
    case "free-unrestricted":
      return { width: 6, opacity: 0.85, dashed: false };
    default:
      return { width: 3, opacity: 0.5, dashed: true };
  }
}

const BOUNDARY_COLOR = "#324A6D";
const LINE_COLOR = "#2a7f8a";
const TRAIL_COLOR = "#4a7c59";
const AREA_COLOR = "#2a7f8a";

interface StreetSegment {
  name: string;
  rule: string;
  coords: [number, number][];
  note?: string;
}
interface StreetData {
  boundary: [number, number][];
  segments: StreetSegment[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function googleSearchUrl(name: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${name} Kingston WA`,
  )}`;
}

// ---- on-map name labels (P1) ----

interface LabelRec {
  el: HTMLElement | null;
  lat: number;
  lng: number;
  text: string;
  show: LabelShow;
  dir: LabelDir;
  priority: number;
  w: number;
  h: number;
  /** Direction currently applied to the DOM — declutter may re-place an `auto` label. */
  curDir: LabelDir;
}

/** Top-left of the label box relative to the pin's container point, per direction.
    Kept in lock-step with the `.fm-label--*` CSS transforms. */
function labelBoxOffset(dir: LabelDir, w: number, h: number): [number, number] {
  switch (dir === "auto" ? "top" : dir) {
    case "bottom":
      return [-w / 2, 6];
    case "right":
      return [18, -h / 2];
    case "left":
      return [-w - 18, -h / 2];
    default: // "top"
      return [-w / 2, -h - 34];
  }
}

/** Priority (0..100) → min zoom at which an `auto` label may appear (the clutter dial). */
function labelZoomThreshold(priority: number): number {
  if (priority >= 80) return 13; // stars/viewpoints survive town-wide
  if (priority >= 45) return 15; // restaurants/mid appear near the downtown fit zoom
  return 16; // restroom/parking only when fully zoomed in
}

interface LabelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Directions an `auto` label tries, in preference order, before giving up. */
const LABEL_AUTO_DIRS: LabelDir[] = ["top", "right", "bottom", "left"];

/** AABB overlap test with a 2px gutter. */
function labelBoxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return !(a.x1 + 2 < b.x0 || a.x0 - 2 > b.x1 || a.y1 + 2 < b.y0 || a.y0 - 2 > b.y1);
}

/** Rounded teardrop pin element: an emoji chip on a white pin with a colored
 *  ring. MapLibre positions it with anchor "bottom" (the rotate puts the sharp
 *  tip at bottom-center), so there is no translate here (unlike the Leaflet
 *  divIcon version). */
function pinEl(emoji: string, ring: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "feature-pin";
  el.style.cursor = "pointer";
  el.innerHTML = `<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;background:#fff;border:2px solid ${ring};box-shadow:0 2px 4px rgba(0,0,0,0.3);transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;">
    <span style="transform:rotate(45deg);font-size:15px;line-height:1;">${emoji}</span>
  </div>`;
  return el;
}

/** Parking-meta block for a feature popup. Escapes all user text. */
function parkingBlockHtml(p: NonNullable<MapFeature["parking"]>): string {
  const info = parkingTypeInfo(p.type);
  const rows: string[] = [];

  if (info) {
    rows.push(
      `<p style="margin:6px 0 0;"><span style="display:inline-block;padding:1px 8px;border-radius:9999px;font-size:0.72rem;font-weight:600;color:#fff;background:${
        info.color
      };">${esc(info.label)}</span></p>`,
    );
  }
  if (p.owner) {
    rows.push(
      `<p style="margin:4px 0 0;"><span style="font-weight:600;">Owner:</span> ${esc(
        p.owner,
      )}</p>`,
    );
  }
  if (p.phone) {
    rows.push(
      `<p style="margin:4px 0 0;"><span style="font-weight:600;">Phone:</span> <a href="tel:${esc(
        p.phone,
      )}">${esc(p.phone)}</a></p>`,
    );
  }
  if (p.paymentMethod || p.paymentLink) {
    const bits: string[] = [`<span style="font-weight:600;">Payment:</span>`];
    if (p.paymentMethod) bits.push(` ${esc(p.paymentMethod)}`);
    if (p.paymentLink) {
      bits.push(
        `${p.paymentMethod ? " · " : " "}<a href="${esc(
          p.paymentLink,
        )}" target="_blank" rel="noopener noreferrer">Pay ↗</a>`,
      );
    }
    rows.push(`<p style="margin:4px 0 0;">${bits.join("")}</p>`);
  }
  if (p.paymentNotes) {
    rows.push(
      `<p style="margin:4px 0 0;"><span style="font-weight:600;">Payment notes:</span> ${esc(
        p.paymentNotes,
      )}</p>`,
    );
  }
  if (p.timeLimit) {
    rows.push(
      `<p style="margin:4px 0 0;"><span style="font-weight:600;">Time limit:</span> ${esc(
        p.timeLimit,
      )}</p>`,
    );
  }
  return rows.join("");
}

/** Shared popup body for a custom feature. Escapes all user text. */
function featurePopupHtml(f: MapFeature): string {
  const parts: string[] = [
    `<p style="margin:0;font-weight:600;font-size:0.95rem;">${esc(f.title)}</p>`,
  ];
  if (f.parking) parts.push(parkingBlockHtml(f.parking));
  if (f.notes) parts.push(`<p style="margin:4px 0 0;">${esc(f.notes)}</p>`);
  for (const img of featureImages(f)) {
    parts.push(
      `<img src="/api/map/image?p=${encodeURIComponent(img)}" alt="${esc(
        f.title,
      )}" style="display:block;max-width:210px;border-radius:6px;margin-top:6px;" />`,
    );
  }
  if (f.link) {
    parts.push(
      `<p style="margin:6px 0 0;"><a href="${esc(
        f.link,
      )}" target="_blank" rel="noopener noreferrer">Directions / Open →</a></p>`,
    );
  }
  return `<div style="font-size:0.8rem;line-height:1.35;max-width:230px;">${parts.join(
    "",
  )}</div>`;
}

function restaurantPopupHtml(r: {
  name: string;
  walkMinutesFromFerry: number;
  category?: string;
}): string {
  return `<div style="font-size:0.8rem;line-height:1.35;max-width:230px;">
    <p style="margin:0;font-weight:600;font-size:0.95rem;">${markerCategory(r.category).emoji} ${esc(r.name)}</p>
    <p style="margin:4px 0 0;">${r.walkMinutesFromFerry} min walk from the ferry</p>
    <p style="margin:6px 0 0;"><a href="${esc(
      googleSearchUrl(r.name),
    )}" target="_blank" rel="noopener noreferrer">Open in Google Maps →</a></p>
  </div>`;
}

// ---- legend entry model ----

interface LegendEntry {
  key: string;
  label: string;
  color: string;
  shape: "pin" | "line" | "dash" | "swatch" | "dot";
  emoji?: string;
}

// ---- GeoJSON helpers: [lat,lng] paths -> [lng,lat] coordinates ----

type LngLat = [number, number];
const toLngLat = (p: [number, number]): LngLat => [p[1], p[0]];
const lineFeature = (path: [number, number][], props: Record<string, unknown>) => ({
  type: "Feature" as const,
  properties: props,
  geometry: { type: "LineString" as const, coordinates: path.map(toLngLat) },
});
const polyFeature = (ring: [number, number][], props: Record<string, unknown>) => ({
  type: "Feature" as const,
  properties: props,
  geometry: { type: "Polygon" as const, coordinates: [ring.map(toLngLat)] },
});

export function FeatureMap({
  view,
  resolved,
  height = "460px",
  className = "",
}: {
  /** View slug to fetch client-side from /api/map/<view>. */
  view?: string;
  /**
   * Pre-resolved view payload, supplied by a server component. When set, the
   * map renders it directly and skips the client fetch — this is how a draft
   * (unpublished) view can be embedded on a page: resolveMapView() does not
   * gate on `published`, whereas the public /api/map route 404s drafts.
   */
  resolved?: ResolvedMapView | null;
  height?: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const labelsRef = useRef<LabelRec[]>([]);
  const labelMarkersRef = useRef<MapLibreMarker[]>([]);
  const rafRef = useRef<number | null>(null);
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [data, setData] = useState<ResolvedMapView | null>(resolved ?? null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    resolved ? "ready" : "loading",
  );
  const [legend, setLegend] = useState<LegendEntry[]>([]);
  // On touch devices the map starts non-draggable so the page can scroll past
  // it; a tap unlocks panning. Always false on desktop (fine pointer).
  const [locked, setLocked] = useState(false);

  function unlock() {
    mapRef.current?.dragPan.enable();
    setLocked(false);
  }

  // When a server-resolved payload is supplied, render it directly (no fetch).
  useEffect(() => {
    if (!resolved) return;
    setData(resolved);
    setStatus("ready");
  }, [resolved]);

  // Otherwise fetch the resolved view whenever `view` changes.
  useEffect(() => {
    if (resolved || !view) return;
    let cancelled = false;
    setStatus("loading");
    setData(null);
    (async () => {
      try {
        const res = await fetch(`/api/map/${encodeURIComponent(view)}`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json = (await res.json()) as ResolvedMapView;
        if (cancelled) return;
        setData(json);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, resolved]);

  // Build the map once data is ready. Tearing down + rebuilding on data change
  // keeps this component fully reusable across view switches. The heavy MapLibre
  // load is deferred until the map scrolls into view (perf budget).
  useEffect(() => {
    if (status !== "ready" || !data) return;
    const view = data; // non-null capture
    let cancelled = false;
    let cleanupIo: (() => void) | undefined;
    const container = containerRef.current;
    if (!container) return;

    const legendEntries = new Map<string, LegendEntry>();
    const addLegend = (e: LegendEntry) => {
      if (!legendEntries.has(e.key)) legendEntries.set(e.key, e);
    };

    const init = async () => {
      const maplibregl = await loadMapLibre();
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: mapStyle(pmtilesUrl(TILES_PMTILES_PATH)),
        center: [view.view.center[1], view.view.center[0]],
        zoom: view.view.zoom,
        scrollZoom: false, // don't hijack page scroll; pinch/± still zoom
      });
      mapRef.current = map;

      // On touch devices a full-width map otherwise eats the page's vertical
      // swipes: disable panning until the visitor taps to activate.
      const coarse =
        typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
      if (coarse) {
        map.dragPan.disable();
        setLocked(true);
      } else {
        setLocked(false);
      }

      // ---- on-map labels: 0-size markers + hand-rolled declutter (P1) ----
      labelsRef.current = [];
      labelMarkersRef.current = [];
      const addLabel = (lngLat: LngLat, lab: ReturnType<typeof resolveLabel>) => {
        if (lab.show === "off" || !lab.text) return; // never build an empty chip
        const wrap = document.createElement("div");
        wrap.style.cssText = "width:0;height:0;pointer-events:none;";
        const chip = document.createElement("span");
        chip.className = `fm-label fm-label--${lab.dir === "auto" ? "top" : lab.dir}`;
        chip.setAttribute("dir", "auto");
        chip.setAttribute("aria-hidden", "true");
        chip.textContent = lab.text;
        wrap.appendChild(chip);
        const marker = new maplibregl.Marker({ element: wrap, anchor: "center" })
          .setLngLat(lngLat)
          .addTo(map);
        labelMarkersRef.current.push(marker);
        labelsRef.current.push({
          el: chip,
          lng: lngLat[0],
          lat: lngLat[1],
          text: lab.text,
          show: lab.show,
          dir: lab.dir,
          priority: lab.priority,
          w: 0,
          h: 18,
          curDir: lab.dir === "auto" ? "top" : lab.dir,
        });
      };

      // Measure every chip's box ONCE (reads only) — emoji/CJK/RTL make an
      // arithmetic estimate wrong, so read the real offsetWidth.
      const measureLabels = () => {
        for (const r of labelsRef.current) {
          if (!r.el) continue;
          r.w = r.el.offsetWidth || Math.round(8 + r.text.length * 6.4);
          r.h = r.el.offsetHeight || 18;
        }
      };

      // Greedy priority declutter: viewport-cull → zoom-gate → sort by priority →
      // place highest first, hide any chip whose box overlaps an already-placed one.
      const declutter = () => {
        const m = mapRef.current;
        if (!m) return;
        const z = m.getZoom();
        const b = m.getBounds();
        const contains = (lng: number, lat: number) =>
          lng >= b.getWest() && lng <= b.getEast() && lat >= b.getSouth() && lat <= b.getNorth();
        const cands: { r: LabelRec; px: number; py: number }[] = [];
        const hide: LabelRec[] = [];
        for (const r of labelsRef.current) {
          if (!r.el) continue;
          if (r.show === "off" || !contains(r.lng, r.lat)) {
            hide.push(r);
            continue;
          }
          if (r.show !== "on" && z < labelZoomThreshold(r.priority)) {
            hide.push(r);
            continue;
          }
          const p = m.project([r.lng, r.lat]);
          cands.push({ r, px: p.x, py: p.y });
        }
        // priority desc, tie-break by lat for deterministic frames (no flicker).
        cands.sort((a, b2) => b2.r.priority - a.r.priority || a.r.lat - b2.r.lat);
        const canvas = m.getCanvas();
        const sx = canvas.clientWidth;
        const sy = canvas.clientHeight;
        const onScreen = (bx: LabelBox) => bx.x0 >= 2 && bx.y0 >= 2 && bx.x1 <= sx - 2 && bx.y1 <= sy - 2;
        const placed: LabelBox[] = [];
        const free = (bx: LabelBox) => !placed.some((q) => labelBoxesOverlap(bx, q));
        const show: { r: LabelRec; dir: LabelDir }[] = [];
        for (const { r, px, py } of cands) {
          const boxFor = (d: LabelDir): LabelBox => {
            const [dx, dy] = labelBoxOffset(d, r.w, r.h);
            return { x0: px + dx, y0: py + dy, x1: px + dx + r.w, y1: py + dy + r.h };
          };
          const dirs = r.dir === "auto" ? LABEL_AUTO_DIRS : [r.dir];
          let pick: { dir: LabelDir; box: LabelBox } | null = null;
          for (const d of dirs) {
            const box = boxFor(d);
            if (onScreen(box) && free(box)) {
              pick = { dir: d, box };
              break;
            }
          }
          if (!pick) {
            for (const d of dirs) {
              const box = boxFor(d);
              if (free(box)) {
                pick = { dir: d, box };
                break;
              }
            }
          }
          if (!pick && r.show === "on") pick = { dir: dirs[0], box: boxFor(dirs[0]) };
          if (pick) {
            placed.push(pick.box);
            show.push({ r, dir: pick.dir });
          } else {
            hide.push(r);
          }
        }
        for (const r of hide) if (r.el) r.el.style.display = "none";
        for (const { r, dir } of show) {
          if (!r.el) continue;
          r.el.style.display = "";
          if (r.curDir !== dir) {
            r.el.className = `fm-label fm-label--${dir}`;
            r.curDir = dir;
          }
        }
      };

      const scheduleDeclutter = () => {
        if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
        moveTimerRef.current = setTimeout(() => {
          if (rafRef.current != null) return;
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            declutter();
          });
        }, 120);
      };

      // Collect content coordinates ([lng,lat]) to auto-frame what we draw.
      const pts: LngLat[] = [];

      // Batched GeoJSON geometry, grouped by render style. Each feature carries
      // {popup,color} in its properties; one click handler per layer opens the
      // popup. Dashed lines are their own layers (dasharray can't be data-driven).
      const solidLines: ReturnType<typeof lineFeature>[] = [];
      const dashedLines: ReturnType<typeof lineFeature>[] = [];
      const fills: ReturnType<typeof polyFeature>[] = [];
      const circles: { lngLat: LngLat; color: string; popup: string }[] = [];

      const parkingLegend = (
        f: MapFeature,
        color: string,
        shape: "pin" | "swatch",
      ): LegendEntry | null => {
        const info = f.parking ? parkingTypeInfo(f.parking.type) : undefined;
        if (!info) return null;
        return { key: `parking-type-${info.key}`, label: info.label, color, shape };
      };

      const markerPopup = (html: string) =>
        new maplibregl.Popup({ offset: [0, -34], maxWidth: "240px" }).setHTML(html);

      // ---- custom features ----
      for (const f of view.features) {
        if (f.kind === "marker" && f.point) {
          const cat = markerCategory(f.category);
          const ring = featureColor(f, cat.color);
          new maplibregl.Marker({ element: pinEl(cat.emoji, ring), anchor: "bottom" })
            .setLngLat(toLngLat(f.point))
            .setPopup(markerPopup(featurePopupHtml(f)))
            .addTo(map);
          pts.push(toLngLat(f.point));
          addLabel(
            toLngLat(f.point),
            resolveLabel({ title: f.title, category: f.category, kind: f.kind, label: f.label }),
          );
          const pl = parkingLegend(f, ring, "pin");
          addLegend(pl ?? { key: `cat-${cat.key}`, label: cat.label, color: ring, shape: "pin", emoji: cat.emoji });
        } else if (f.kind === "line" && f.path) {
          const color = featureColor(f, LINE_COLOR);
          solidLines.push(lineFeature(f.path, { color, popup: featurePopupHtml(f), width: 4, opacity: 0.85 }));
          f.path.forEach((p) => pts.push(toLngLat(p)));
          const pl = parkingLegend(f, color, "swatch");
          addLegend(pl ?? { key: "kind-line", label: "Route", color, shape: "line" });
        } else if (f.kind === "trail" && f.path) {
          const color = featureColor(f, TRAIL_COLOR);
          dashedLines.push(lineFeature(f.path, { color, popup: featurePopupHtml(f), width: 4, opacity: 0.9 }));
          f.path.forEach((p) => pts.push(toLngLat(p)));
          const pl = parkingLegend(f, color, "swatch");
          addLegend(pl ?? { key: "kind-trail", label: "Trail", color, shape: "dash" });
        } else if (f.kind === "area" && f.polygon) {
          const color = featureColor(f, AREA_COLOR);
          fills.push(polyFeature(f.polygon, { color, popup: featurePopupHtml(f) }));
          f.polygon.forEach((p) => pts.push(toLngLat(p)));
          const pl = parkingLegend(f, color, "swatch");
          addLegend(pl ?? { key: "kind-area", label: "Area", color, shape: "swatch" });
        }
      }

      // ---- built-ins: restaurants (category-aware pins) ----
      for (const r of view.builtins.restaurants ?? []) {
        const cat = markerCategory(r.category);
        new maplibregl.Marker({ element: pinEl(cat.emoji, cat.color), anchor: "bottom" })
          .setLngLat([r.lng, r.lat])
          .setPopup(markerPopup(restaurantPopupHtml(r)))
          .addTo(map);
        pts.push([r.lng, r.lat]);
        addLabel([r.lng, r.lat], resolveLabel({ title: r.label?.text ?? r.name, category: r.category }));
        addLegend({ key: `builtin-restaurant-${cat.key}`, label: cat.label, color: cat.color, shape: "pin", emoji: cat.emoji });
      }

      // ---- built-ins: parking zones ----
      for (const z of view.builtins.parkingZones ?? []) {
        const color = parkingColor(z.rule);
        const popup = `<div style="font-size:0.8rem;line-height:1.35;max-width:230px;">
          <p style="margin:0;font-weight:600;font-size:0.95rem;">${esc(z.name)}</p>
          <p style="margin:4px 0 0;">${esc(z.summary)}</p>
        </div>`;
        if (z.polygon && z.polygon.length >= 3) {
          fills.push(polyFeature(z.polygon, { color, popup, opacity: 0.35 }));
        } else {
          circles.push({ lngLat: toLngLat(z.center), color, popup });
        }
        pts.push(toLngLat(z.center));
        addLegend({ key: `parking-${z.rule}`, label: PARKING_RULE_LABELS[z.rule] ?? z.rule, color, shape: "swatch" });
      }

      // Draw everything once the style is loaded, then auto-fit + declutter.
      const draw = async () => {
        if (cancelled || mapRef.current !== map) return;

        // ---- built-ins: streets (fetched) ----
        if (view.builtins.streets) {
          try {
            const res = await fetch("/geo/street-parking.json");
            if (res.ok && !cancelled && mapRef.current === map) {
              const street = (await res.json()) as StreetData;
              dashedLines.push(lineFeature(street.boundary, { color: BOUNDARY_COLOR, width: 2, opacity: 1, interactive: false }));
              addLegend({ key: "street-boundary", label: "Kingston UGA", color: BOUNDARY_COLOR, shape: "dash" });
              const rank = (r: StreetRule) => (r === "default" ? 0 : r === "ferry-holding" ? 1 : 2);
              const ordered = [...street.segments].sort(
                (a, b2) => rank(normalizeStreetRule(a.rule)) - rank(normalizeStreetRule(b2.rule)),
              );
              for (const seg of ordered) {
                const rule = normalizeStreetRule(seg.rule);
                const st = streetLineStyle(rule);
                const [title, subtitle] =
                  rule === "ferry-holding" ? [STREET_RULE_LABELS[rule], seg.name] : [seg.name, STREET_RULE_LABELS[rule]];
                const popup = `<div style="font-size:0.8rem;line-height:1.35;max-width:230px;">
                  <p style="margin:0;font-weight:600;font-size:0.95rem;">${esc(title)}</p>
                  <p style="margin:4px 0 0;font-weight:600;color:${STREET_COLORS[rule]};">${esc(subtitle)}</p>
                  ${seg.note ? `<p style="margin:4px 0 0;">${esc(seg.note)}</p>` : ""}
                </div>`;
                (st.dashed ? dashedLines : solidLines).push(
                  lineFeature(seg.coords, { color: STREET_COLORS[rule], popup, width: st.width, opacity: st.opacity }),
                );
                addLegend({
                  key: `street-${rule}`,
                  label:
                    rule === "ferry-holding" ? "Ferry holding line"
                    : rule === "default" ? "Street: no known limit"
                    : rule === "prohibited" ? "Street: no parking"
                    : rule === "free-2hr" ? "Street: free, 2-hr"
                    : "Street: free, no limit",
                  color: STREET_COLORS[rule],
                  shape: rule === "ferry-holding" ? "dash" : "line",
                });
              }
            }
          } catch {
            // Overlay is progressive enhancement — the base map still works.
          }
        }

        // Add geometry sources + layers (fills under lines under circles).
        const addGeo = (id: string, features: GeoJSON.Feature[]) => {
          map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features } });
        };
        const wirePopup = (layerId: string) => {
          map.on("click", layerId, (e) => {
            const f = e.features?.[0] as { properties?: { popup?: string } } | undefined;
            const html = f?.properties?.popup;
            if (html) new maplibregl.Popup({ maxWidth: "240px" }).setLngLat(e.lngLat).setHTML(html).addTo(map);
          });
          map.on("mouseenter", layerId, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", layerId, () => (map.getCanvas().style.cursor = ""));
        };

        if (fills.length) {
          addGeo("fm-fills", fills);
          map.addLayer({ id: "fm-fills", type: "fill", source: "fm-fills", paint: { "fill-color": ["get", "color"], "fill-opacity": ["coalesce", ["get", "opacity"], 0.22] } });
          map.addLayer({ id: "fm-fills-outline", type: "line", source: "fm-fills", paint: { "line-color": ["get", "color"], "line-width": 2 } });
          wirePopup("fm-fills");
        }
        if (solidLines.length) {
          addGeo("fm-lines", solidLines);
          map.addLayer({ id: "fm-lines", type: "line", source: "fm-lines", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["coalesce", ["get", "width"], 4], "line-opacity": ["coalesce", ["get", "opacity"], 0.85] } });
          wirePopup("fm-lines");
        }
        if (dashedLines.length) {
          addGeo("fm-dashed", dashedLines);
          map.addLayer({ id: "fm-dashed", type: "line", source: "fm-dashed", layout: { "line-cap": "butt", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["coalesce", ["get", "width"], 3], "line-opacity": ["coalesce", ["get", "opacity"], 0.7], "line-dasharray": [2, 3] } });
          wirePopup("fm-dashed");
        }
        if (circles.length) {
          addGeo("fm-circles", circles.map((c) => ({ type: "Feature" as const, properties: { color: c.color, popup: c.popup }, geometry: { type: "Point" as const, coordinates: c.lngLat } })));
          map.addLayer({ id: "fm-circles", type: "circle", source: "fm-circles", paint: { "circle-radius": 7, "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2, "circle-opacity": 0.9 } });
          wirePopup("fm-circles");
        }

        // Auto-frame to the content, trimming far outliers (a lone far pin must
        // not zoom downtown into oblivion). Skipped for the wide street overlay.
        if (!view.builtins.streets && pts.length > 0) {
          const OUTLIER_M = 1200;
          const midOf = (xs: number[]) => {
            const s = [...xs].sort((a, b) => a - b);
            const h = s.length >> 1;
            return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
          };
          const cLng = midOf(pts.map((p) => p[0]));
          const cLat = midOf(pts.map((p) => p[1]));
          const distM = (aLng: number, aLat: number, bLng: number, bLat: number) => {
            const R = 6371000, rad = Math.PI / 180;
            const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
            const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(s));
          };
          const core = pts.filter((p) => distM(cLng, cLat, p[0], p[1]) <= OUTLIER_M);
          const frame = core.length >= 3 ? core : pts;
          const bounds = new maplibregl.LngLatBounds(frame[0], frame[0]);
          for (const p of frame) bounds.extend(p);
          const spanKm = distM(bounds.getWest(), bounds.getNorth(), bounds.getEast(), bounds.getSouth()) / 1000;
          if (spanKm <= 4) map.fitBounds(bounds, { padding: 32, maxZoom: 16, duration: 0 });
        }

        // Labels: measure once, place at the fitted zoom, re-declutter on move.
        measureLabels();
        declutter();
        map.on("zoomend", scheduleDeclutter);
        map.on("moveend", scheduleDeclutter);

        if (!cancelled) setLegend([...legendEntries.values()]);
      };

      if (map.isStyleLoaded()) void draw();
      else map.once("load", () => void draw());

      requestAnimationFrame(() => mapRef.current?.resize());
      roRef.current?.disconnect();
      const ro = new ResizeObserver(() => {
        if (mapRef.current !== map) return;
        map.resize();
        scheduleDeclutter();
      });
      ro.observe(containerRef.current);
      roRef.current = ro;
    };

    // Defer the ~200 KB MapLibre engine (heavy: ~950 ms init on a throttled CPU)
    // until the map is genuinely in view. A NEGATIVE rootMargin means it must be
    // ~200 px inside the viewport before loading, so a map that sits below a
    // page's fold (e.g. the "food map" section on /eat) never loads during the
    // initial paint — keeping it out of the Lighthouse perf budget — while a map
    // that fills the viewport from the top (the dedicated /map, /parking pages)
    // still loads immediately.
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
        { rootMargin: "-200px" },
      );
      io.observe(container);
      cleanupIo = () => io.disconnect();
    }

    return () => {
      cancelled = true;
      cleanupIo?.();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
      moveTimerRef.current = null;
      roRef.current?.disconnect();
      roRef.current = null;
      for (const m of labelMarkersRef.current) m.remove();
      labelMarkersRef.current = [];
      labelsRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      setLegend([]);
    };
  }, [status, data]);

  return (
    <div className={className}>
      <style>{PIN_CSS}</style>
      <div className="relative">
        <div
          ref={containerRef}
          style={{ height }}
          className="relative z-0 w-full overflow-hidden rounded-2xl border border-sand"
          role="region"
          aria-label={`Map: ${view ?? data?.view.id ?? "Kingston"}`}
        />
        {status === "loading" && (
          <div className="pointer-events-none absolute inset-0 z-[400] flex items-center justify-center rounded-2xl bg-shell/60 text-sm text-ink-soft">
            Loading map…
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 z-[400] flex items-center justify-center rounded-2xl border border-sand bg-shell text-sm text-ink-soft">
            Map unavailable.
          </div>
        )}
        {status === "ready" && locked && (
          <button
            type="button"
            onClick={unlock}
            className="absolute inset-0 z-[450] flex items-end justify-center rounded-2xl bg-transparent pb-4"
            aria-label="Tap to interact with the map"
          >
            <span className="rounded-full bg-sound-deep/85 px-4 py-2 text-sm font-semibold text-white shadow">
              Tap to explore the map
            </span>
          </button>
        )}
      </div>
      {status === "ready" && legend.length > 0 && <MapLegend entries={legend} />}
    </div>
  );
}

const PIN_CSS = `
.feature-pin { background: transparent; border: none; }
.fm-label-wrap { background: transparent; border: none; }
.fm-label {
  position: absolute;
  left: 0;
  top: 0;
  display: inline-block;
  font: 600 11px/1.15 system-ui, -apple-system, sans-serif;
  color: #fff;
  background: #16405e;            /* opaque — legible over dark water/forest tiles */
  border-radius: 2px;
  padding: 1px 6px;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0,0,0,.55);
  box-shadow: 0 0 0 1px rgba(255,255,255,.5);
}
.fm-label--top    { transform: translate(-50%, calc(-100% - 34px)); }
.fm-label--bottom { transform: translate(-50%, 6px); }
.fm-label--right  { transform: translate(18px, -50%); }
.fm-label--left   { transform: translate(calc(-100% - 18px), -50%); }
`;

function LegendSwatch({ entry }: { entry: LegendEntry }) {
  switch (entry.shape) {
    case "pin":
      return (
        <span
          aria-hidden
          className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] leading-none"
          style={{ boxShadow: `0 0 0 2px ${entry.color}` }}
        >
          {entry.emoji}
        </span>
      );
    case "line":
      return (
        <span
          aria-hidden
          className="inline-block h-1 w-5 rounded-full"
          style={{ backgroundColor: entry.color }}
        />
      );
    case "dash":
      return (
        <span
          aria-hidden
          className="inline-block h-0 w-5 border-t-2 border-dashed"
          style={{ borderColor: entry.color }}
        />
      );
    case "dot":
      return (
        <span
          aria-hidden
          className="inline-block h-3 w-3 rounded-full ring-2 ring-white"
          style={{ backgroundColor: entry.color }}
        />
      );
    default:
      return (
        <span
          aria-hidden
          className="inline-block h-3 w-3 rounded-[3px]"
          style={{ backgroundColor: entry.color }}
        />
      );
  }
}

function MapLegend({ entries }: { entries: LegendEntry[] }) {
  return (
    <ul className="mt-3 flex max-h-28 flex-wrap gap-x-4 gap-y-2 overflow-y-auto text-sm text-ink-soft">
      {entries.map((e) => (
        <li key={e.key} className="flex items-center gap-1.5">
          <LegendSwatch entry={e} />
          {e.label}
        </li>
      ))}
    </ul>
  );
}
