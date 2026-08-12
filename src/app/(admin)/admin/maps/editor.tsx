"use client";

// The Map Builder (laptop-first) — the Chamber's map CMS.
//
// Layout: a compact VIEWS strip (pills + "New view" + features dropdown) sits
// above a dominant MapLibre + terra-draw CANVAS. The view edit form opens as a
// dismissible overlay on the map's left edge; the selected-FEATURE form is a
// floating drawer on the map's right edge (≥lg) or a plain block under the
// map (<lg). The active view's built-in source layers (restaurants,
// parking zones, street overlay) render as muted, non-interactive CONTEXT so
// the admin can draw against them.
//
// E32b (ADR-0006): the Leaflet + geoman stack is retired. Lines, trails, and
// areas live in the terra-draw store (feature id = app feature id; color/kind
// in properties drive data-driven styling); markers are MapLibre HTML markers.
// Geometry read-back on save queries the draw snapshot (shapes) or the marker
// (points) — vertex drags, whole-shape drags, and pin moves are all captured
// at Save time, exactly as the live-layer read-back did before.
//
// Terra-draw runs vertex editing AND whole-shape drag simultaneously, so the
// old Reshape ⟷ Move toggle (a geoman-limitation workaround) is gone: drag a
// corner to reshape, drag the shape body to move it.
//
// Wire-format invariant (FR-EDIT-06): the API speaks stored [lat,lng] open
// rings/paths, r6-rounded; terra-draw speaks GeoJSON [lng,lat] closed rings.
// Every crossing goes through @/lib/map/draw-coords.

import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BasemapSwitch } from "@/components/admin/basemap-switch";
import { useRouter } from "next/navigation";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import type { GeoJSONStoreFeatures, TerraDraw } from "terra-draw";
import {
  MARKER_CATEGORIES,
  markerCategory,
  PARKING_TYPES,
  parkingTypeInfo,
  featureImages,
  resolveLabel,
  shortenTitle,
  type FeatureKind,
  type MapFeature,
  type MapView,
  type ParkingType,
  type ResolvedMapView,
  type LabelShow,
  type LabelDir,
} from "@/lib/map/types";
import { COST_LABELS, COST_VALUES, isCostValue } from "@/lib/cost";
import { mapStyle, TILES_PMTILES_PATH } from "@/lib/map/basemap";
import { loadMapLibre, pmtilesUrl } from "@/lib/map/maplibre";
import { editorIdStrategy, loadTerraDraw } from "@/lib/map/terradraw";
import {
  r6,
  toGeoJsonPath,
  toGeoJsonRing,
  toStoredPath,
  toStoredPoint,
  toStoredRing,
} from "@/lib/map/draw-coords";
import { Badge } from "@/components/ui";

/* ------------------------------------------------------------------ */
/* Constants & small helpers                                           */
/* ------------------------------------------------------------------ */

const KINGSTON_CENTER: [number, number] = [47.7985, -122.4975];

// The canvas is the dominant element of the builder.
const MAP_HEIGHT = "clamp(560px, 72vh, 900px)";

const INPUT =
  "w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm text-ink focus:border-tide focus:outline-none";

const KIND_LABELS: Record<FeatureKind, string> = {
  marker: "Marker (pin)",
  line: "Line",
  trail: "Trail",
  area: "Area",
};

const KIND_EMOJI: Record<FeatureKind, string> = {
  marker: "📍",
  line: "➖",
  trail: "🥾",
  area: "⬠",
};

// Default stroke color for line/trail/area when the admin hasn't picked one.
const DEFAULT_LINE_COLOR = "#1E96C0";
const DEFAULT_TRAIL_COLOR = "#4a7c59";
const DEFAULT_AREA_COLOR = "#7c4dbe";

function defaultColor(kind: FeatureKind): string {
  if (kind === "trail") return DEFAULT_TRAIL_COLOR;
  if (kind === "area") return DEFAULT_AREA_COLOR;
  return DEFAULT_LINE_COLOR;
}

/** Parking-type color if this feature carries one, else undefined. */
function parkingDrawColor(f: {
  parking?: { type?: string } | null;
  parkingType?: string;
}): string | undefined {
  const key = f.parkingType ?? f.parking?.type;
  return key ? parkingTypeInfo(key)?.color : undefined;
}

/** Color a line/trail/area actually renders with (parking type wins, then its
 *  own color, then a kind default). */
function shapeColor(f: { kind: FeatureKind; color?: string; parking?: { type?: string } | null; parkingType?: string }): string {
  return parkingDrawColor(f) || f.color || defaultColor(f.kind);
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

// Stored [lat,lng] view centers → MapLibre [lng,lat]. View ZOOMS pass through
// unchanged: since E31 the public feature-map feeds stored zooms straight to
// MapLibre, and this editor must frame views exactly as the public map does.
// Hardcoded GESTURE zoom caps below are the old raster numbers minus 1
// (256px raster → 512px vector tiles, same on-screen scale).
const toLngLat = (p: readonly [number, number]): [number, number] => [p[1], p[0]];
const MAX_ZOOM = 18;

type Draft = {
  kind: FeatureKind;
  title: string;
  category: string;
  // E27's free-vs-paid signal (issue #80). "" = not stated. MUST round-trip
  // through buildFeature: the API rebuilds each feature from the request body
  // alone, so a draft that omitted `cost` would silently strip it on save.
  cost: string;
  /** Chamber member — added emphasis: markers get the ring+size treatment,
   *  areas (traced building footprints) the member fill/boundary treatment.
   *  Markers and areas only; see MapFeature.member for the E16 seam. */
  member: boolean;
  color: string;
  notes: string;
  link: string;
  images: string[];
  views: string[];
  // Parking. `parkingType === ""` means the feature is not a parking area.
  parkingType: string;
  owner: string;
  phone: string;
  paymentMethod: string;
  paymentLink: string;
  paymentNotes: string;
  timeLimit: string;
  // On-map label (markers). Stored as strings for the form inputs.
  labelText: string;
  labelShow: LabelShow;
  labelDir: LabelDir;
  labelPriority: string;
};

function toDraft(f: MapFeature): Draft {
  const p = f.parking;
  return {
    kind: f.kind,
    title: f.title,
    category: f.category ?? "",
    cost: f.cost ?? "",
    member: f.member === true,
    color: f.color ?? "",
    notes: f.notes ?? "",
    link: f.link ?? "",
    images: featureImages(f),
    views: [...f.views],
    parkingType: p?.type ?? "",
    owner: p?.owner ?? "",
    phone: p?.phone ?? "",
    paymentMethod: p?.paymentMethod ?? "",
    paymentLink: p?.paymentLink ?? "",
    paymentNotes: p?.paymentNotes ?? "",
    timeLimit: p?.timeLimit ?? "",
    labelText: f.label?.text ?? "",
    labelShow: f.label?.show ?? "auto",
    labelDir: f.label?.dir ?? "auto",
    labelPriority: f.label?.priority != null ? String(f.label.priority) : "",
  };
}

type Msg = { kind: "ok" | "error"; text: string };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-ink">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Marker / shape rendering                                            */
/* ------------------------------------------------------------------ */

/** Style an existing marker element in place (used at build and for the live
 *  draft preview). Tooltip is textContent — no HTML, no XSS. */
function styleMarkerEl(
  el: HTMLElement,
  f: { category?: string; color?: string; parking?: { type?: string } | null; parkingType?: string },
  selected: boolean,
  tooltip: string,
) {
  const cat = markerCategory(f.category);
  // classList, never `el.className =` — MapLibre's Marker adds its own
  // positioning classes (maplibregl-marker …) to this element after
  // construction, and wiping them breaks the marker's absolute positioning.
  el.classList.add("me-pin");
  el.classList.toggle("me-pin--selected", selected);
  const dot = el.querySelector(".me-dot") as HTMLElement;
  dot.style.background = parkingDrawColor(f) || f.color || cat.color;
  dot.textContent = cat.emoji;
  (el.querySelector(".me-tip") as HTMLElement).textContent = tooltip;
}

function markerTooltip(f: {
  title: string;
  category?: string;
  label?: MapFeature["label"];
}): string {
  return resolveLabel({ title: f.title, category: f.category, kind: "marker", label: f.label }).text;
}

/** The line/trail/area as a terra-draw store feature (id = feature id). */
function shapeDrawFeature(f: MapFeature): GeoJSONStoreFeatures | null {
  if ((f.kind === "line" || f.kind === "trail") && f.path && f.path.length >= 2) {
    return {
      id: f.id,
      type: "Feature",
      properties: { mode: "linestring", kind: f.kind, color: shapeColor(f) },
      geometry: { type: "LineString", coordinates: toGeoJsonPath(f.path) },
    } as GeoJSONStoreFeatures;
  }
  if (f.kind === "area" && f.polygon && f.polygon.length >= 3) {
    return {
      id: f.id,
      type: "Feature",
      properties: { mode: "polygon", kind: f.kind, color: shapeColor(f) },
      geometry: { type: "Polygon", coordinates: [toGeoJsonRing(f.polygon)] },
    } as GeoJSONStoreFeatures;
  }
  return null;
}

/** Stroke color for a terra-draw feature (shapes carry `color`). */
function featureDrawColor(f: GeoJSONStoreFeatures): `#${string}` {
  const c = f.properties?.color;
  return (typeof c === "string" && /^#/.test(c) ? c : DEFAULT_LINE_COLOR) as `#${string}`;
}

const trailDash = (f: GeoJSONStoreFeatures): [number, number] | undefined =>
  f.properties?.kind === "trail" ? [3, 3] : undefined;

/* ------------------------------------------------------------------ */
/* Built-in context layer styling (kept in sync with feature-map.tsx)  */
/* ------------------------------------------------------------------ */

// Values are ADR-0007 §4 ("Evergreen & Sound" overlay half).
const PARKING_RULE_COLORS: Record<string, string> = {
  "free-2hr": "#2e9e4f",
  "free-unrestricted": "#1E96C0",
  paid: "#7c4dbe",
  "business-customer": "#9c2f6f",
  "park-and-ride-24h": "#8a4c22",
  prohibited: "#d43d3d",
  "load-zone": "#b8860b",
  permit: "#7a7468",
};
const FALLBACK_PARKING_COLOR = "#7a7468";

function parkingColor(rule: string): string {
  return PARKING_RULE_COLORS[rule] ?? FALLBACK_PARKING_COLOR;
}

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
  "ferry-holding": "#3f5473", // ADR-0007: navy — no longer a near-twin of permit
  default: "#8b9aa8",
};

function normalizeStreetRule(rule: string): StreetRule {
  return rule in STREET_COLORS ? (rule as StreetRule) : "default";
}

function streetStyle(rule: StreetRule): {
  color: string;
  weight: number;
  opacity: number;
  dashed?: boolean;
} {
  switch (rule) {
    case "ferry-holding":
      return { color: STREET_COLORS[rule], weight: 3, opacity: 0.45, dashed: true };
    case "prohibited":
      return { color: STREET_COLORS[rule], weight: 4, opacity: 0.6 };
    case "free-2hr":
    case "free-unrestricted":
      return { color: STREET_COLORS[rule], weight: 6, opacity: 0.85 };
    default:
      return { color: STREET_COLORS.default, weight: 3, opacity: 0.5 };
  }
}

const BOUNDARY_COLOR = "#324A6D";

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

/** Rounded teardrop html — same pin as the public feature-map, muted. */
function contextPinHtml(emoji: string, ring: string): string {
  return `<div style="position:relative;transform:translate(-50%,-100%);">
    <div style="width:30px;height:30px;border-radius:50% 50% 50% 0;background:#fff;border:2px solid ${ring};box-shadow:0 2px 4px rgba(0,0,0,0.3);transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;">
      <span style="transform:rotate(45deg);font-size:15px;line-height:1;">${emoji}</span>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

type ViewDraft = {
  name: string;
  description: string;
  center: [number, number];
  zoom: number;
  sources: string[];
  published: boolean;
};

const SOURCE_OPTIONS: { key: string; label: string }[] = [
  { key: "restaurants", label: "Restaurants" },
  { key: "parking-zones", label: "Parking zones" },
  { key: "streets", label: "Street overlay" },
  { key: "port-stalls", label: "Port parking bays" },
];

const SOURCE_SHORT: Record<string, string> = {
  restaurants: "🍽",
  "parking-zones": "🅿️",
  streets: "🛣",
  "port-stalls": "🅿",
};

/** Everything one context render put on the map, so the next one (or unmount)
 *  can clear it wholesale — the layerGroup's replacement. */
type ContextHandles = { markers: MapLibreMarker[]; layerIds: string[]; sourceIds: string[] };

export function MapBuilder({
  initialViews,
  initialFeatures,
}: {
  initialViews: MapView[];
  initialFeatures: MapFeature[];
}) {
  const router = useRouter();

  const [views, setViews] = useState<MapView[]>(initialViews);
  const [features, setFeatures] = useState<MapFeature[]>(initialFeatures);

  // The "active view" is the default target for newly drawn features and the
  // canvas filter (unless showAll). null = no active view yet.
  const [activeViewId, setActiveViewId] = useState<string | null>(initialViews[0]?.id ?? null);
  const [showAll, setShowAll] = useState(false);

  // View editing (overlay panel on the map's left edge). null = not editing.
  const [viewDraft, setViewDraft] = useState<ViewDraft | null>(null);
  const [viewEditId, setViewEditId] = useState<string | null>(null); // null = creating
  const [viewSaving, setViewSaving] = useState(false);
  const [viewMsg, setViewMsg] = useState<Msg | null>(null);

  // Feature editing (floating drawer on the map's right edge / block below lg).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [drawing, setDrawing] = useState<FeatureKind | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  // Drawer visibility (≥lg). Collapsing keeps the selection + map editing.
  const [panelOpen, setPanelOpen] = useState(true);
  // "Features (N)" dropdown in the strip above the map.
  const [featListOpen, setFeatListOpen] = useState(false);
  // Built-in context layers toggle (default ON).
  const [showBuiltins, setShowBuiltins] = useState(true);
  // Bumped when a view is saved so context layers re-render even if the
  // active view id didn't change (its sources may have).
  const [contextEpoch, setContextEpoch] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<typeof import("maplibre-gl") | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  // Marker-kind features on the canvas (shapes live in the terra-draw store).
  const markersRef = useRef(new Map<string, MapLibreMarker>());
  // Every feature id currently on the canvas (markers + draw-store shapes).
  const canvasIdsRef = useRef(new Set<string>());
  const hoverChipRef = useRef<HTMLDivElement | null>(null);
  // True while WE mutate the draw store — terra-draw fires the same change
  // events for API and user edits, and only user edits may mark dirty.
  const suppressRef = useRef(false);
  // Ids drawn this session but never saved — deleting them skips the API.
  const unsavedIdsRef = useRef(new Set<string>());
  // Muted built-in context for the active view, cleared wholesale on redraw.
  const contextRef = useRef<ContextHandles | null>(null);
  // Monotonic token guarding stale context fetches (view switched mid-flight).
  const contextSeqRef = useRef(0);
  // /geo/street-parking.json is static — fetch it once per mount.
  const streetDataRef = useRef<StreetData | null>(null);

  // Mirrors for map-event callbacks (created once, must see current state).
  const featuresRef = useRef(features);
  featuresRef.current = features;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  const activeViewIdRef = useRef(activeViewId);
  activeViewIdRef.current = activeViewId;
  const showAllRef = useRef(showAll);
  showAllRef.current = showAll;
  const showBuiltinsRef = useRef(showBuiltins);
  showBuiltinsRef.current = showBuiltins;
  const selectRef = useRef<(id: string) => void>(() => {});
  const deleteRef = useRef<(id: string, opts?: { confirm?: boolean }) => Promise<void>>(
    async () => {},
  );

  /** Run a programmatic draw-store mutation without tripping dirty tracking. */
  function withStoreOps<T>(fn: () => T): T {
    suppressRef.current = true;
    try {
      return fn();
    } finally {
      suppressRef.current = false;
    }
  }

  /* ---------------- which features belong on the canvas ---------------- */

  function visibleFeatures(): MapFeature[] {
    const list = featuresRef.current;
    if (showAllRef.current || !activeViewIdRef.current) return list;
    return list.filter((f) => f.views.includes(activeViewIdRef.current!));
  }

  /* ---------------- imperative layer management ---------------- */

  function markerEl(f: MapFeature): HTMLDivElement {
    const wrap = document.createElement("div");
    const dot = document.createElement("span");
    dot.className = "me-dot";
    const tip = document.createElement("span");
    tip.className = "me-tip";
    wrap.append(dot, tip);
    styleMarkerEl(wrap, f, false, markerTooltip(f));
    wrap.addEventListener("click", (ev) => {
      ev.stopPropagation(); // don't also run the map's hit-test click
      selectRef.current(f.id);
    });
    return wrap;
  }

  function addFeatureToMap(f: MapFeature) {
    const maplibregl = maplibreRef.current;
    const map = mapRef.current;
    const draw = drawRef.current;
    if (!maplibregl || !map || !draw) return;

    if (f.kind === "marker" && f.point) {
      const marker = new maplibregl.Marker({ element: markerEl(f), anchor: "center" })
        .setLngLat(toLngLat(f.point))
        .addTo(map);
      marker.on("dragend", () => setDirty(true));
      markersRef.current.set(f.id, marker);
      canvasIdsRef.current.add(f.id);
      return;
    }
    const feat = shapeDrawFeature(f);
    if (feat) {
      const results = withStoreOps(() => draw.addFeatures([feat]));
      // A rejected add means the shape silently won't render or edit here —
      // surface it for diagnosis, and don't record it as on-canvas.
      const rejected = results.find((r) => !r.valid);
      if (rejected) {
        console.warn(`map builder: feature "${f.id}" not editable — ${rejected.reason}`);
        return;
      }
      canvasIdsRef.current.add(f.id);
    }
  }

  function removeFeatureFromMap(id: string) {
    const draw = drawRef.current;
    if (draw?.hasFeature(id)) withStoreOps(() => draw.removeFeatures([id]));
    markersRef.current.get(id)?.remove();
    markersRef.current.delete(id);
    canvasIdsRef.current.delete(id);
  }

  function renderCanvas() {
    // Rebuild every layer to reflect the current view filter + feature data.
    for (const id of [...canvasIdsRef.current]) removeFeatureFromMap(id);
    for (const f of visibleFeatures()) addFeatureToMap(f);
    // Re-arm editing on the selected feature if it's still visible.
    const sel = selectedIdRef.current;
    if (sel) {
      const f = featuresRef.current.find((x) => x.id === sel);
      if (f && canvasIdsRef.current.has(sel)) setEditing(sel, f, true);
    }
  }

  function setEditing(id: string, f: MapFeature, on: boolean) {
    if (f.kind === "marker") {
      const marker = markersRef.current.get(id);
      if (!marker) return;
      styleMarkerEl(marker.getElement(), f, on, markerTooltip(f));
      marker.setDraggable(on);
      return;
    }
    const draw = drawRef.current;
    if (draw?.hasFeature(id)) {
      withStoreOps(() => (on ? draw.selectFeature(id) : draw.deselectFeature(id)));
    }
  }

  /* ---------------- built-in context layers ---------------- */

  function clearContext() {
    const map = mapRef.current;
    const ctx = contextRef.current;
    contextRef.current = null;
    if (!ctx) return;
    for (const m of ctx.markers) m.remove();
    if (map) {
      for (const lid of ctx.layerIds) if (map.getLayer(lid)) map.removeLayer(lid);
      for (const sid of ctx.sourceIds) if (map.getSource(sid)) map.removeSource(sid);
    }
  }

  /** First terra-draw layer id, so context canvas layers slot BELOW the drawn
   *  features (the old context pane's z-ordering). */
  function firstDrawLayerId(map: MapLibreMap): string | undefined {
    return map.getStyle().layers?.find((l) => l.id.startsWith("td-"))?.id;
  }

  // Renders the active view's built-in sources as muted, non-interactive
  // context (same colors/shapes as the public feature-map, opacity roughly
  // halved, no popups). Canvas layers sit below the terra-draw layers;
  // context pins are pointer-events-none DOM markers.
  async function renderContextLayers() {
    const seq = ++contextSeqRef.current;
    clearContext();

    const maplibregl = maplibreRef.current;
    const map = mapRef.current;
    const viewId = activeViewIdRef.current;
    if (!maplibregl || !map || !viewId || !showBuiltinsRef.current) return;

    try {
      const res = await fetch(`/api/map/${encodeURIComponent(viewId)}`);
      if (!res.ok) return;
      const data = (await res.json()) as ResolvedMapView;
      if (seq !== contextSeqRef.current || !mapRef.current) return;

      // Street overlay data is fetched separately (static file, cached).
      let street: StreetData | null = null;
      if (data.builtins.streets) {
        if (!streetDataRef.current) {
          try {
            const sres = await fetch("/geo/street-parking.json");
            if (sres.ok) streetDataRef.current = (await sres.json()) as StreetData;
          } catch {
            // Context is best-effort; the canvas still works without it.
          }
        }
        street = streetDataRef.current;
        if (seq !== contextSeqRef.current || !mapRef.current) return;
      }

      const ctx: ContextHandles = { markers: [], layerIds: [], sourceIds: [] };
      const before = firstDrawLayerId(map);
      const addSource = (sid: string, features: GeoJSON.Feature[]) => {
        map.addSource(sid, { type: "geojson", data: { type: "FeatureCollection", features } });
        ctx.sourceIds.push(sid);
      };
      const addLayer = (layer: Parameters<MapLibreMap["addLayer"]>[0]) => {
        map.addLayer(layer, before);
        ctx.layerIds.push((layer as { id: string }).id);
      };
      const lineFeat = (path: [number, number][], props: Record<string, unknown>) =>
        ({
          type: "Feature",
          properties: props,
          geometry: { type: "LineString", coordinates: path.map(toLngLat) },
        }) as GeoJSON.Feature;
      const polyFeat = (ring: [number, number][], props: Record<string, unknown>) =>
        ({
          type: "Feature",
          properties: props,
          geometry: { type: "Polygon", coordinates: [ring.map(toLngLat)] },
        }) as GeoJSON.Feature;

      // Restaurants — same teardrop pins as the public map, dimmed and inert.
      for (const r of data.builtins.restaurants ?? []) {
        const cat = markerCategory(r.category);
        const el = document.createElement("div");
        el.className = "ctx-pin";
        el.innerHTML = contextPinHtml(cat.emoji, cat.color);
        ctx.markers.push(
          new maplibregl.Marker({ element: el, anchor: "center" })
            .setLngLat([r.lng, r.lat])
            .addTo(map),
        );
      }

      // Parking zones — street centre-lines / polygons colored by rule
      // (circle fallback). Street zones use their E31 phase-6 streetPaths so
      // this reference layer matches the public map's shape (centre line, not
      // curb-offset strokes — close enough for a dimmed context layer).
      const zonePolys: GeoJSON.Feature[] = [];
      const zoneLines: GeoJSON.Feature[] = [];
      const zonePts: GeoJSON.Feature[] = [];
      for (const z of data.builtins.parkingZones ?? []) {
        const color = parkingColor(z.rule);
        if (z.streetPaths?.length) {
          for (const p of z.streetPaths) zoneLines.push(lineFeat(p, { color }));
        } else if (z.polygon && z.polygon.length >= 3) {
          zonePolys.push(polyFeat(z.polygon, { color }));
        } else {
          zonePts.push({
            type: "Feature",
            properties: { color },
            geometry: { type: "Point", coordinates: toLngLat(z.center) },
          });
        }
      }
      if (zoneLines.length) {
        addSource("ctx-parking-street", zoneLines);
        addLayer({
          id: "ctx-parking-street",
          type: "line",
          source: "ctx-parking-street",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.45 },
        });
      }
      if (zonePolys.length) {
        addSource("ctx-parking", zonePolys);
        addLayer({
          id: "ctx-parking-fill",
          type: "fill",
          source: "ctx-parking",
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.18 },
        });
        addLayer({
          id: "ctx-parking-line",
          type: "line",
          source: "ctx-parking",
          paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.45 },
        });
      }
      if (zonePts.length) {
        addSource("ctx-parking-pts", zonePts);
        addLayer({
          id: "ctx-parking-pts",
          type: "circle",
          source: "ctx-parking-pts",
          paint: {
            "circle-radius": 7,
            "circle-color": ["get", "color"],
            "circle-opacity": 0.45,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
            "circle-stroke-opacity": 0.5,
          },
        });
      }

      // Streets — UGA boundary (dashed navy) + rule-styled segments. Segments
      // are z-ordered by adding default/ferry-holding first (rule-colored on
      // top), same rank order the layerGroup relied on.
      if (street) {
        addSource("ctx-boundary", [lineFeat(street.boundary, {})]);
        addLayer({
          id: "ctx-boundary",
          type: "line",
          source: "ctx-boundary",
          paint: {
            "line-color": BOUNDARY_COLOR,
            "line-width": 2,
            "line-opacity": 0.5,
            "line-dasharray": [3, 3],
          },
        });
        const rank = (r: StreetRule) => (r === "default" ? 0 : r === "ferry-holding" ? 1 : 2);
        const ordered = [...street.segments].sort(
          (a, b) => rank(normalizeStreetRule(a.rule)) - rank(normalizeStreetRule(b.rule)),
        );
        const solid: GeoJSON.Feature[] = [];
        const dashed: GeoJSON.Feature[] = [];
        for (const seg of ordered) {
          const style = streetStyle(normalizeStreetRule(seg.rule));
          (style.dashed ? dashed : solid).push(
            lineFeat(seg.coords, {
              color: style.color,
              width: style.weight,
              opacity: style.opacity / 2,
              order: rank(normalizeStreetRule(seg.rule)),
            }),
          );
        }
        if (dashed.length) {
          addSource("ctx-streets-dashed", dashed);
          addLayer({
            id: "ctx-streets-dashed",
            type: "line",
            source: "ctx-streets-dashed",
            paint: {
              "line-color": ["get", "color"],
              "line-width": ["get", "width"],
              "line-opacity": ["get", "opacity"],
              "line-dasharray": [2, 3],
            },
          });
        }
        if (solid.length) {
          addSource("ctx-streets", solid);
          addLayer({
            id: "ctx-streets",
            type: "line",
            source: "ctx-streets",
            layout: { "line-sort-key": ["get", "order"] },
            paint: {
              "line-color": ["get", "color"],
              "line-width": ["get", "width"],
              "line-opacity": ["get", "opacity"],
            },
          });
        }
      }

      contextRef.current = ctx;
    } catch {
      // Context is best-effort; drawing still works on the bare tiles.
    }
  }

  // Redraw context whenever the active view, the toggle, or a view's saved
  // sources change. renderContextLayers reads only refs, so the closure is
  // never stale.
  useEffect(() => {
    if (!mapReady) return;
    void renderContextLayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, activeViewId, showBuiltins, contextEpoch]);

  /* ---------------- live draft color on the canvas ---------------- */

  // Reflect the selected feature's draft color / parking type on the canvas as
  // the admin edits (before Save). Parking type wins over manual color; falls
  // back to the stored feature otherwise. For shapes the color rides the draw
  // feature's properties (an API update — never marks dirty).
  useEffect(() => {
    const id = selectedIdRef.current;
    if (!id || !draft) return;
    const f = featuresRef.current.find((x) => x.id === id);
    if (!f) return;
    if (f.kind === "marker") {
      const marker = markersRef.current.get(id);
      if (!marker) return;
      styleMarkerEl(
        marker.getElement(),
        { category: draft.category, color: draft.color, parkingType: draft.parkingType },
        true,
        // Live-preview the effective label text in the hover tooltip.
        resolveLabel({
          title: draft.title,
          category: draft.category,
          kind: "marker",
          label: {
            text: draft.labelText || undefined,
            show: draft.labelShow,
            dir: draft.labelDir,
            priority: draft.labelPriority ? Number(draft.labelPriority) : undefined,
          },
        }).text,
      );
    } else {
      const draw = drawRef.current;
      if (draw?.hasFeature(id)) {
        draw.updateFeatureProperties(id, {
          color: shapeColor({ kind: f.kind, color: draft.color, parkingType: draft.parkingType }),
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.color, draft?.parkingType, draft?.category, draft?.title, draft?.labelText]);

  /* ---------------- selection ---------------- */

  function select(id: string) {
    const prev = selectedIdRef.current;
    if (prev === id) {
      setPanelOpen(true);
      return;
    }
    if (dirtyRef.current && !window.confirm("Discard unsaved changes to the current feature?")) {
      return;
    }
    // A single terra-draw mode runs at a time: selecting disarms an armed draw.
    if (drawingRef.current) {
      drawRef.current?.setMode("select");
      setDrawing(null);
    }
    if (prev) {
      const prevF = featuresRef.current.find((f) => f.id === prev);
      if (prevF) setEditing(prev, prevF, false);
    }

    const f = featuresRef.current.find((x) => x.id === id);
    if (!f) return;
    setSelectedId(id);
    // Eager mirror sync: same-tick callers (renderCanvas's re-arm, map
    // events) must see the new selection before React re-renders.
    selectedIdRef.current = id;
    setDraft(toDraft(f));
    setDirty(false);
    setMsg(null);
    setPanelOpen(true);

    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (map && maplibregl && canvasIdsRef.current.has(id)) {
      if (f.kind === "marker" && f.point) {
        map.easeTo({ center: toLngLat(f.point), zoom: Math.max(map.getZoom(), 15) });
      } else {
        const ring = f.polygon ?? f.path ?? [];
        if (ring.length > 0) {
          const first = toLngLat(ring[0]);
          const bounds = new maplibregl.LngLatBounds(first, first);
          for (const p of ring) bounds.extend(toLngLat(p));
          map.fitBounds(bounds, { padding: 60, maxZoom: 17 });
        }
      }
      setEditing(id, f, true);
    }
  }
  selectRef.current = select;

  function deselect() {
    const prev = selectedIdRef.current;
    if (prev) {
      const prevF = featuresRef.current.find((f) => f.id === prev);
      if (prevF) setEditing(prev, prevF, false);
    }
    setSelectedId(null);
    selectedIdRef.current = null; // eager mirror sync (see select)
    setDraft(null);
    setDirty(false);
  }

  /* ---------------- map bootstrap ---------------- */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [maplibregl, { terraDraw, TerraDrawMapLibreGLAdapter }] = await Promise.all([
        loadMapLibre(),
        loadTerraDraw(),
      ]);
      // Guard: unmounted while loading, or already initialized (StrictMode).
      if (cancelled || !containerRef.current || mapRef.current) return;

      maplibreRef.current = maplibregl;
      const first = initialViews[0];
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: mapStyle(pmtilesUrl(TILES_PMTILES_PATH)),
        center: toLngLat(first ? first.center : KINGSTON_CENTER),
        zoom: first ? first.zoom : 14,
        maxZoom: MAX_ZOOM,
      });
      mapRef.current = map;
      // Leaflet showed +/- buttons by default; MapLibre needs them explicitly.
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", () => {
        if (cancelled || mapRef.current !== map) return;

        const {
          TerraDraw: TerraDrawCtor,
          TerraDrawPointMode,
          TerraDrawLineStringMode,
          TerraDrawPolygonMode,
          TerraDrawSelectMode,
          ValidateNotSelfIntersecting,
        } = terraDraw;

        const draw = new TerraDrawCtor({
          adapter: new TerraDrawMapLibreGLAdapter({
            map,
            // r6 wire precision; also stops sidebar-press/map-release ghosts.
            coordinatePrecision: 6,
            ignoreMismatchedPointerEvents: true,
          }),
          idStrategy: editorIdStrategy(),
          modes: [
            new TerraDrawPointMode(),
            new TerraDrawLineStringMode({
              styles: {
                lineStringColor: featureDrawColor,
                lineStringWidth: 3,
                lineStringDash: trailDash,
                closingPointColor: "#ffffff",
                closingPointOutlineColor: "#16405e",
                closingPointOutlineWidth: 2,
              },
            }),
            new TerraDrawPolygonMode({
              validation: (feature, { updateType }) =>
                updateType === "finish" || updateType === "commit"
                  ? ValidateNotSelfIntersecting(feature)
                  : { valid: true },
              styles: {
                fillColor: featureDrawColor,
                fillOpacity: 0.25,
                outlineColor: featureDrawColor,
                outlineWidth: 2,
                closingPointColor: "#ffffff",
                closingPointOutlineColor: "#16405e",
                closingPointOutlineWidth: 2,
              },
            }),
            new TerraDrawSelectMode({
              // Selection is driven by the app (dropdown + hit-test click), so
              // the dirty-discard confirm stays authoritative.
              allowManualSelection: false,
              allowManualDeselection: false,
              // Handle grab radius. The 40px default swallows entire short
              // lines, making a whole-shape body drag unreachable; 24px keeps
              // handles easy on a laptop while leaving line bodies grabbable.
              pointerDistance: 24,
              keyEvents: { deselect: null, delete: null, rotate: null, scale: null },
              flags: {
                linestring: {
                  feature: {
                    draggable: true,
                    // Lines/trails may self-intersect while reshaping (the old
                    // edit-time rule); areas may not.
                    selfIntersectable: true,
                    coordinates: { midpoints: true, draggable: true, deletable: true },
                  },
                },
                polygon: {
                  feature: {
                    draggable: true,
                    selfIntersectable: false,
                    coordinates: { midpoints: true, draggable: true, deletable: true },
                  },
                },
              },
              styles: {
                selectedLineStringColor: featureDrawColor,
                selectedLineStringWidth: 5,
                selectedLineStringDash: trailDash,
                selectedPolygonColor: featureDrawColor,
                selectedPolygonFillOpacity: 0.4,
                selectedPolygonOutlineColor: featureDrawColor,
                selectedPolygonOutlineWidth: 3,
                selectionPointColor: "#ffffff",
                selectionPointOutlineColor: "#16405e",
                selectionPointOutlineWidth: 2,
                selectionPointWidth: 6,
                midPointColor: "#ffffff",
                midPointOutlineColor: "#16405e",
                midPointWidth: 4,
              },
            }),
          ],
        });
        draw.start();
        draw.setMode("select");
        drawRef.current = draw;
        // Test-only hook: the server-tier spec must be able to prove features
        // actually entered the draw store (its no-touch round-trip would pass
        // vacuously via buildFeature's stored-geometry fallback otherwise).
        // Inert unless the spec set the flag before load.
        if ((window as unknown as { __vkTestHooks?: boolean }).__vkTestHooks) {
          const w = window as unknown as { __vkDraw?: unknown; __vkMap?: unknown };
          w.__vkDraw = draw;
          // The map too: vertex/midpoint gestures need lngLat -> pixel
          // projection to know where to click.
          w.__vkMap = map;
        }

        draw.on("finish", (finishedId, context) => {
          if (
            context.action === "draw" &&
            (context.mode === "point" || context.mode === "linestring" || context.mode === "polygon")
          ) {
            handleDrawnRef.current(context.mode, String(finishedId));
            return;
          }
          // Vertex/midpoint drag or whole-shape drag finished.
          if (context.action === "dragCoordinate" || context.action === "dragFeature") {
            setDirty(true);
          }
        });
        // Geometry edits that don't end in a drag (right-click vertex delete,
        // midpoint insert) — user-driven updates to the selected feature only.
        draw.on("change", (ids, type, context) => {
          if (suppressRef.current || type !== "update") return;
          if (context && "origin" in context && context.origin === "api") return;
          if (context?.target === "properties") return;
          const sel = selectedIdRef.current;
          if (sel && ids.some((i) => String(i) === sel)) setDirty(true);
        });

        // Click-to-select via hit-test (manual selection is disabled above).
        map.on("click", (e) => {
          const d = drawRef.current;
          if (!d || drawingRef.current) return;
          const hit = d
            .getFeaturesAtLngLat(e.lngLat, {
              pointerDistance: 10,
              ignoreSelectFeatures: false,
              ignoreCoordinatePoints: true,
              ignoreClosingPoints: true,
              ignoreSnappingPoints: true,
            })
            .find(
              (x) => x.properties?.mode === "linestring" || x.properties?.mode === "polygon",
            );
          if (hit?.id != null) selectRef.current(String(hit.id));
        });

        // Hover: title chip + pointer cursor over shapes (the Leaflet sticky
        // tooltip's replacement). Markers carry their own CSS tooltip.
        const chip = document.createElement("div");
        chip.className = "me-hover";
        chip.style.display = "none";
        map.getContainer().appendChild(chip);
        hoverChipRef.current = chip;
        map.on("mousemove", (e) => {
          const d = drawRef.current;
          if (!d || drawingRef.current) {
            chip.style.display = "none";
            return;
          }
          const hit = d
            .getFeaturesAtLngLat(e.lngLat, {
              pointerDistance: 10,
              ignoreSelectFeatures: false,
              ignoreCoordinatePoints: true,
              ignoreClosingPoints: true,
              ignoreSnappingPoints: true,
            })
            .find(
              (x) => x.properties?.mode === "linestring" || x.properties?.mode === "polygon",
            );
          const f = hit ? featuresRef.current.find((x) => x.id === String(hit.id)) : undefined;
          if (f) {
            chip.textContent = f.title;
            chip.style.display = "block";
            chip.style.left = `${e.point.x + 12}px`;
            chip.style.top = `${e.point.y + 12}px`;
            map.getCanvas().style.cursor = "pointer";
          } else {
            chip.style.display = "none";
            map.getCanvas().style.cursor = "";
          }
        });

        renderCanvas();
        setMapReady(true);
      });

      requestAnimationFrame(() => mapRef.current?.resize());
    })();

    return () => {
      cancelled = true;
      contextSeqRef.current++; // invalidate in-flight context fetches
      clearContext();
      try {
        drawRef.current?.stop();
      } catch {
        // stop() throws if the adapter never registered — nothing to undo
      }
      drawRef.current = null;
      for (const m of markersRef.current.values()) m.remove();
      markersRef.current.clear();
      canvasIdsRef.current.clear();
      hoverChipRef.current?.remove();
      hoverChipRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Features are managed imperatively after mount; re-running would tear the
    // map down mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- draw a new feature ---------------- */

  const handleDrawnRef = useRef<(mode: string, tdId: string) => void>(() => {});
  handleDrawnRef.current = (mode: string, tdId: string) => {
    setDrawing(null);
    const draw = drawRef.current;
    const map = mapRef.current;
    if (!draw || !map) return;
    draw.setMode("select");

    const feat = draw.getSnapshotFeature(tdId);
    // Re-added under the feature's own id via addFeatureToMap so wiring is
    // uniform.
    withStoreOps(() => draw.removeFeatures([tdId]));
    if (!feat) return;

    // Infer kind + geometry from the drawn mode.
    let kind: FeatureKind;
    const partial: Partial<MapFeature> = {};
    if (mode === "point" && feat.geometry.type === "Point") {
      kind = "marker";
      partial.point = toStoredPoint(feat.geometry.coordinates);
    } else if (mode === "linestring" && feat.geometry.type === "LineString") {
      kind = "line"; // admin can switch to "trail" in the form
      const path = toStoredPath(feat.geometry.coordinates);
      if (path.length < 2) return;
      partial.path = path;
    } else if (mode === "polygon" && feat.geometry.type === "Polygon") {
      kind = "area";
      const poly = toStoredRing(feat.geometry.coordinates[0]);
      if (poly.length < 3) return;
      partial.polygon = poly;
    } else {
      return;
    }

    const targetView = activeViewIdRef.current;
    const id = randomId("feat");
    const f: MapFeature = {
      id,
      kind,
      title: kind === "marker" ? "New marker" : kind === "area" ? "New area" : "New line",
      views: targetView ? [targetView] : [],
      ...partial,
    };
    unsavedIdsRef.current.add(id);
    featuresRef.current = [...featuresRef.current, f];
    setFeatures(featuresRef.current);
    addFeatureToMap(f);
    const before = selectedIdRef.current;
    select(id);
    if (selectedIdRef.current === before) {
      // The dirty-discard confirm was declined: hand the editing handles back
      // to the still-selected feature (arming the draw had dropped them).
      const prev = before ? featuresRef.current.find((x) => x.id === before) : undefined;
      if (before && prev) setEditing(before, prev, true);
      return;
    }
    setDirty(true);
    setMsg({
      kind: "ok",
      text: targetView
        ? "Shape drawn — fill in the details, then Save to publish."
        : "Shape drawn — pick at least one view under “Show on views”, then Save.",
    });
  };

  function toggleDraw(kind: FeatureKind) {
    const draw = drawRef.current;
    if (!draw) return;
    if (drawing === kind) {
      draw.setMode("select");
      setDrawing(null);
      // Arming the draw dropped the selection's handles — hand them back.
      const sel = selectedIdRef.current;
      const f = sel ? featuresRef.current.find((x) => x.id === sel) : undefined;
      if (sel && f) setEditing(sel, f, true);
      return;
    }
    draw.setMode(kind === "marker" ? "point" : kind === "area" ? "polygon" : "linestring");
    setDrawing(kind);
    setMsg({
      kind: "ok",
      text:
        kind === "marker"
          ? "Click the map to drop the marker."
          : "Click to place points; click the last point again to finish.",
    });
  }

  /* ---------------- feature draft & persistence ---------------- */

  function patchDraft(patch: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
    setMsg(null);
  }

  function toggleDraftView(id: string) {
    setDraft((d) => {
      if (!d) return d;
      const has = d.views.includes(id);
      return { ...d, views: has ? d.views.filter((v) => v !== id) : [...d.views, id] };
    });
    setDirty(true);
    setMsg(null);
  }

  /** The draft feature with geometry read back from the draw store / marker. */
  function buildFeature(): MapFeature | null {
    if (!draft || !selectedId) return null;
    const existing = featuresRef.current.find((f) => f.id === selectedId);
    if (!existing) return null;

    const kind = draft.kind;

    // Read geometry back where its shape matches the kind; fall back to the
    // stored geometry otherwise (e.g. line ↔ trail switch keeps the same
    // LineString in the draw store, so its path is still valid). Vertex drags,
    // whole-shape drags, and pin moves are all captured here.
    let point = existing.point;
    let path = existing.path;
    let polygon = existing.polygon;
    const marker = markersRef.current.get(selectedId);
    if (kind === "marker" && marker) {
      const ll = marker.getLngLat();
      point = toStoredPoint([ll.lng, ll.lat]);
    }
    const snap = drawRef.current?.getSnapshotFeature(selectedId);
    if (snap) {
      if ((kind === "line" || kind === "trail") && snap.geometry.type === "LineString") {
        path = toStoredPath(snap.geometry.coordinates);
      } else if (kind === "area" && snap.geometry.type === "Polygon") {
        polygon = toStoredRing(snap.geometry.coordinates[0]);
      }
    }

    // Parking type is offered for markers (pay station / small lot) and areas.
    const parkingType =
      (kind === "marker" || kind === "area") && draft.parkingType ? (draft.parkingType as ParkingType) : "";
    const trimmed = (s: string) => s.trim();
    const parking = parkingType
      ? {
          type: parkingType,
          ...(trimmed(draft.owner) ? { owner: trimmed(draft.owner) } : {}),
          ...(trimmed(draft.phone) ? { phone: trimmed(draft.phone) } : {}),
          ...(trimmed(draft.paymentMethod) ? { paymentMethod: trimmed(draft.paymentMethod) } : {}),
          ...(trimmed(draft.paymentLink) ? { paymentLink: trimmed(draft.paymentLink) } : {}),
          ...(trimmed(draft.paymentNotes) ? { paymentNotes: trimmed(draft.paymentNotes) } : {}),
          ...(trimmed(draft.timeLimit) ? { timeLimit: trimmed(draft.timeLimit) } : {}),
        }
      : null;
    const images = draft.images.filter(Boolean);

    // On-map label (markers only). Persist only when a sub-field is non-default;
    // mirrors the API route's validation so client and server agree.
    const labelText = draft.labelText.trim().slice(0, 40);
    const labelPri =
      draft.labelPriority.trim() === ""
        ? 0
        : Math.max(-50, Math.min(50, Math.round(Number(draft.labelPriority) || 0)));
    const label =
      kind === "marker" &&
      (labelText ||
        draft.labelShow !== "auto" ||
        draft.labelDir !== "auto" ||
        labelPri !== 0)
        ? {
            ...(labelText ? { text: labelText } : {}),
            ...(draft.labelShow !== "auto" ? { show: draft.labelShow } : {}),
            ...(draft.labelDir !== "auto" ? { dir: draft.labelDir } : {}),
            ...(labelPri !== 0 ? { priority: labelPri } : {}),
          }
        : null;

    const feature: MapFeature = {
      id: selectedId,
      kind,
      title: draft.title.trim(),
      views: draft.views,
      ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
      ...(kind === "marker" && draft.category ? { category: draft.category } : {}),
      // Deliberately not kind-gated: cost is valid on any feature, and gating
      // here would strip an API-set value the moment a shape was re-saved.
      ...(isCostValue(draft.cost) ? { cost: draft.cost } : {}),
      // Markers AND areas — the two kinds the member treatment renders on. The
      // API whitelists `member` kind-agnostically, so the editor gate is the
      // one place a stale kind list would silently strip the flag on save.
      ...((kind === "marker" || kind === "area") && draft.member ? { member: true } : {}),
      ...(label ? { label } : {}),
      // Parking color is automatic — don't persist a manual color alongside it.
      ...(!parking && draft.color ? { color: draft.color } : {}),
      ...(parking ? { parking } : {}),
      // New saves use images[]; the API keeps imageUrl back-compat on read.
      ...(images.length ? { images } : {}),
      ...(draft.link.trim() ? { link: draft.link.trim() } : {}),
    };
    // Attach only the geometry that matches the (possibly switched) kind.
    if (kind === "marker" && point) feature.point = point;
    if ((kind === "line" || kind === "trail") && path) feature.path = path;
    if (kind === "area" && polygon) feature.polygon = polygon;
    return feature;
  }

  async function save() {
    const feature = buildFeature();
    if (!feature) return;
    if (!feature.title) {
      setMsg({ kind: "error", text: "The feature needs a title." });
      return;
    }
    if (feature.views.length === 0) {
      setMsg({ kind: "error", text: "Assign the feature to at least one view." });
      return;
    }
    // Geometry sanity (mirror of the server rules, for a friendlier message).
    if (feature.kind === "marker" && !feature.point) {
      setMsg({ kind: "error", text: "This marker has no location — redraw it." });
      return;
    }
    if ((feature.kind === "line" || feature.kind === "trail") && (!feature.path || feature.path.length < 2)) {
      setMsg({ kind: "error", text: "A line/trail needs at least 2 points — redraw it." });
      return;
    }
    if (feature.kind === "area" && (!feature.polygon || feature.polygon.length < 3)) {
      setMsg({ kind: "error", text: "An area needs at least 3 points — redraw it." });
      return;
    }

    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/map-features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(feature),
      });
      const data = (await res.json()) as { ok?: boolean; feature?: MapFeature; error?: string };
      if (!res.ok || !data.ok || !data.feature) {
        setMsg({ kind: "error", text: data.error ?? "Could not save the feature." });
        return;
      }
      const saved = data.feature;
      unsavedIdsRef.current.delete(saved.id);
      featuresRef.current = featuresRef.current.some((f) => f.id === saved.id)
        ? featuresRef.current.map((f) => (f.id === saved.id ? saved : f))
        : [...featuresRef.current, saved];
      setFeatures(featuresRef.current);

      // Rebuild this feature's layer so color/emoji/geometry reflect the saved
      // record; drop it if it no longer belongs on the current view filter.
      removeFeatureFromMap(saved.id);
      const onCanvas = visibleFeatures().some((f) => f.id === saved.id);
      if (onCanvas) {
        addFeatureToMap(saved);
        setEditing(saved.id, saved, true);
      }
      setDraft(toDraft(saved));
      setDirty(false);
      setMsg({ kind: "ok", text: "Saved — live on the public map within a minute." });
      router.refresh();
    } catch {
      setMsg({ kind: "error", text: "Could not reach the server — is the app running?" });
    } finally {
      setSaving(false);
    }
  }

  /**
   * Delete a feature by id (drawer "Delete" button). Seed features are
   * tombstoned server-side, not erased; unsaved drafts just drop locally.
   */
  async function deleteFeatureById(id: string, opts: { confirm?: boolean } = {}) {
    const { confirm = true } = opts;
    const f = featuresRef.current.find((x) => x.id === id);
    if (!f) return;
    if (confirm && !window.confirm(`Delete "${f.title}" from the map? (Seed features stay hidden, not erased.)`)) {
      return;
    }

    const wasUnsaved = unsavedIdsRef.current.has(id);
    if (!wasUnsaved) {
      setSaving(true);
      setMsg(null);
      try {
        const res = await fetch(`/api/admin/map-features?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        if (!res.ok && res.status !== 404) {
          const data = (await res.json()) as { error?: string };
          setMsg({ kind: "error", text: data.error ?? "Could not delete the feature." });
          return;
        }
      } catch {
        setMsg({ kind: "error", text: "Could not reach the server — is the app running?" });
        return;
      } finally {
        setSaving(false);
      }
    }

    const title = f.title;
    if (selectedIdRef.current === id) deselect();
    removeFeatureFromMap(id);
    unsavedIdsRef.current.delete(id);
    featuresRef.current = featuresRef.current.filter((x) => x.id !== id);
    setFeatures(featuresRef.current);
    setMsg({ kind: "ok", text: `Deleted "${title}".` });
    router.refresh();
  }
  deleteRef.current = deleteFeatureById;

  function remove() {
    if (selectedId) void deleteFeatureById(selectedId, { confirm: true });
  }

  /* ---------------- image upload ---------------- */

  // Upload one file; append its stored name onto draft.images. Returns true on
  // success. Doesn't manage the `uploading` flag — the caller does, so a batch
  // upload shows a single "Uploading…" for the whole set.
  async function uploadImage(file: File): Promise<boolean> {
    const fd = new FormData();
    fd.append("image", file);
    const res = await fetch("/api/admin/map-features/image", { method: "POST", body: fd });
    const data = (await res.json()) as { ok?: boolean; imageUrl?: string; error?: string };
    if (!res.ok || !data.ok || !data.imageUrl) {
      setMsg({ kind: "error", text: data.error ?? "Could not upload the image." });
      return false;
    }
    const name = data.imageUrl;
    setDraft((d) => (d && !d.images.includes(name) ? { ...d, images: [...d.images, name] } : d));
    setDirty(true);
    return true;
  }

  // Upload one or more selected files, appending each returned name in turn.
  async function uploadImages(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setMsg(null);
    let ok = 0;
    try {
      for (const file of files) {
        // eslint-disable-next-line no-await-in-loop
        if (await uploadImage(file)) ok++;
      }
      if (ok > 0) {
        setMsg({
          kind: "ok",
          text: `${ok === 1 ? "Photo" : `${ok} photos`} uploaded — Save the feature to keep ${ok === 1 ? "it" : "them"}.`,
        });
      }
    } catch {
      setMsg({ kind: "error", text: "Could not upload the image — is the app running?" });
    } finally {
      setUploading(false);
    }
  }

  function removeDraftImage(name: string) {
    setDraft((d) => (d ? { ...d, images: d.images.filter((n) => n !== name) } : d));
    setDirty(true);
    setMsg(null);
  }

  /* ---------------- view filter / active view ---------------- */

  function pickActiveView(id: string) {
    if (dirtyRef.current && !window.confirm("Discard unsaved feature changes?")) return;
    // renderCanvas's re-arm path switches terra-draw into select mode; keep
    // the Draw buttons honest by disarming an in-flight draw first.
    if (drawingRef.current) {
      drawRef.current?.setMode("select");
      setDrawing(null);
    }
    deselect();
    setActiveViewId(id);
    activeViewIdRef.current = id;
    setShowAll(false);
    showAllRef.current = false;
    setViewDraft(null);
    setViewEditId(null);
    setFeatListOpen(false);
    // Recenter on the picked view, then redraw the filtered canvas.
    const map = mapRef.current;
    const view = views.find((v) => v.id === id);
    if (map && view) map.jumpTo({ center: toLngLat(view.center), zoom: view.zoom });
    renderCanvas();
  }

  function toggleShowAll() {
    if (dirtyRef.current && !window.confirm("Discard unsaved feature changes?")) return;
    if (drawingRef.current) {
      drawRef.current?.setMode("select");
      setDrawing(null);
    }
    deselect();
    const next = !showAll;
    setShowAll(next);
    showAllRef.current = next;
    renderCanvas();
  }

  /* ---------------- view create / edit ---------------- */

  function currentMapCenterZoom(): { center: [number, number]; zoom: number } {
    const map = mapRef.current;
    if (!map) return { center: KINGSTON_CENTER, zoom: 15 };
    const c = map.getCenter();
    return {
      center: [r6(c.lat), r6(c.lng)],
      // MapLibre zooms are fractional; the stored view zoom is an int 10–19.
      zoom: Math.min(19, Math.max(10, Math.round(map.getZoom()))),
    };
  }

  function newView() {
    const { center, zoom } = currentMapCenterZoom();
    setViewEditId(null);
    setViewDraft({ name: "", description: "", center, zoom, sources: [], published: false });
    setViewMsg(null);
  }

  function editView(v: MapView) {
    setViewEditId(v.id);
    setViewDraft({
      name: v.name,
      description: v.description ?? "",
      center: v.center,
      zoom: v.zoom,
      sources: [...v.sources],
      published: v.published,
    });
    setViewMsg(null);
  }

  function closeViewPanel() {
    setViewDraft(null);
    setViewEditId(null);
  }

  function patchView(patch: Partial<ViewDraft>) {
    setViewDraft((d) => (d ? { ...d, ...patch } : d));
    setViewMsg(null);
  }

  function toggleViewSource(key: string) {
    setViewDraft((d) => {
      if (!d) return d;
      const has = d.sources.includes(key);
      return { ...d, sources: has ? d.sources.filter((s) => s !== key) : [...d.sources, key] };
    });
    setViewMsg(null);
  }

  function useCurrentCenter() {
    if (!mapRef.current) return;
    patchView(currentMapCenterZoom());
  }

  async function saveView() {
    if (!viewDraft) return;
    if (!viewDraft.name.trim()) {
      setViewMsg({ kind: "error", text: "The view needs a name." });
      return;
    }
    setViewSaving(true);
    setViewMsg(null);
    try {
      const payload: Record<string, unknown> = {
        name: viewDraft.name.trim(),
        description: viewDraft.description.trim() || undefined,
        center: viewDraft.center,
        zoom: viewDraft.zoom,
        sources: viewDraft.sources,
        published: viewDraft.published,
      };
      if (viewEditId) payload.id = viewEditId;
      const res = await fetch("/api/admin/map-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok?: boolean; view?: MapView; error?: string };
      if (!res.ok || !data.ok || !data.view) {
        setViewMsg({ kind: "error", text: data.error ?? "Could not save the view." });
        return;
      }
      const saved = data.view;
      setViews((prev) =>
        prev.some((v) => v.id === saved.id) ? prev.map((v) => (v.id === saved.id ? saved : v)) : [...prev, saved],
      );
      setViewDraft(null);
      setViewEditId(null);
      setActiveViewId(saved.id);
      activeViewIdRef.current = saved.id;
      setContextEpoch((e) => e + 1); // sources may have changed → redraw context
      setViewMsg({ kind: "ok", text: `Saved “${saved.name}”.` });
      router.refresh();
    } catch {
      setViewMsg({ kind: "error", text: "Could not reach the server — is the app running?" });
    } finally {
      setViewSaving(false);
    }
  }

  async function deleteView(v: MapView) {
    if (
      !window.confirm(
        `Delete the "${v.name}" view? Features stay, but they lose this view assignment on the public site. (Seed views are hidden, not erased.)`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/map-views?id=${encodeURIComponent(v.id)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const data = (await res.json()) as { error?: string };
        setViewMsg({ kind: "error", text: data.error ?? "Could not delete the view." });
        return;
      }
    } catch {
      setViewMsg({ kind: "error", text: "Could not reach the server — is the app running?" });
      return;
    }
    setViews((prev) => prev.filter((x) => x.id !== v.id));
    if (activeViewIdRef.current === v.id) {
      const next = views.find((x) => x.id !== v.id)?.id ?? null;
      setActiveViewId(next);
      activeViewIdRef.current = next;
    }
    if (viewEditId === v.id) {
      setViewDraft(null);
      setViewEditId(null);
    }
    setViewMsg({ kind: "ok", text: `Deleted “${v.name}”.` });
    renderCanvas();
    router.refresh();
  }

  /* ---------------- render ---------------- */

  const selectedFeature = selectedId ? features.find((f) => f.id === selectedId) : null;
  const activeView = activeViewId ? views.find((v) => v.id === activeViewId) : null;

  // Feature list scoped to the dropdown (matches canvas filter).
  const listedFeatures = showAll || !activeViewId
    ? features
    : features.filter((f) => f.views.includes(activeViewId));

  /* ----- shared form bodies (rendered in an overlay ≥lg, a block <lg) ----- */

  const featureFormBody = selectedFeature && draft && (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-ink-soft">{selectedFeature.id}</span>
        {unsavedIdsRef.current.has(selectedFeature.id) && <Badge tone="coral">not saved</Badge>}
        {dirty && !unsavedIdsRef.current.has(selectedFeature.id) && (
          <Badge tone="coral">unsaved changes</Badge>
        )}
      </div>

      {draft.kind === "marker" ? (
        <p className="rounded-lg bg-shell/70 px-3 py-2 text-xs text-ink-soft">
          Drag the pin on the map to move it, then Save.
        </p>
      ) : (
        <p className="rounded-lg bg-shell/70 px-3 py-2 text-xs text-ink-soft">
          Drag a point to move it. Click a faint <b>＋</b> midpoint to add a point.
          Right-click a point to remove it. Drag anywhere else on the shape to move
          the whole thing. Then Save.
        </p>
      )}

      <Field label="Kind">
        <select
          className={INPUT}
          value={draft.kind}
          onChange={(e) => patchDraft({ kind: e.target.value as FeatureKind })}
        >
          {(Object.keys(KIND_LABELS) as FeatureKind[])
            // Only allow switching between kinds sharing the same geometry
            // (line ↔ trail). Marker and area can't change kind here.
            .filter((k) =>
              selectedFeature.kind === "line" || selectedFeature.kind === "trail"
                ? k === "line" || k === "trail"
                : k === selectedFeature.kind,
            )
            .map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
        </select>
      </Field>

      {/* Parking — offered for areas (lots) and markers (a pay-station /
          small-lot pin). Picking a type auto-colors the shape. */}
      {(draft.kind === "marker" || draft.kind === "area") && (
        <Field label="Parking type">
          <select
            className={INPUT}
            value={draft.parkingType}
            onChange={(e) => patchDraft({ parkingType: e.target.value })}
          >
            <option value="">— Not a parking area —</option>
            {PARKING_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Title">
        <input
          className={INPUT}
          value={draft.title}
          onChange={(e) => patchDraft({ title: e.target.value })}
        />
      </Field>

      {draft.kind === "marker" && (
        <Field label="Icon category">
          <select
            className={INPUT}
            value={draft.category}
            onChange={(e) => patchDraft({ category: e.target.value })}
          >
            <option value="">— pick an icon —</option>
            {MARKER_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.emoji} {c.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {/* Cost to visitors (issue #80): the E27 free-vs-paid badge, e.g. on the
          /map/restrooms finder rows. Offered for every kind — the field is
          valid on any feature and hiding it would strip API-set values. */}
      <Field label="Cost for visitors">
        <select
          className={INPUT}
          value={draft.cost}
          onChange={(e) => patchDraft({ cost: e.target.value })}
        >
          <option value="">— not stated —</option>
          {COST_VALUES.map((v) => (
            <option key={v} value={v}>
              {COST_LABELS[v]}
            </option>
          ))}
        </select>
      </Field>

      {(draft.kind === "marker" || draft.kind === "area") && (
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-1"
            checked={draft.member}
            onChange={(e) => patchDraft({ member: e.target.checked })}
          />
          <span>
            Chamber member
            <span className="mt-0.5 block text-xs text-ink-soft">
              {draft.kind === "marker"
                ? "Draws a larger pin with a blue ring so the location stands out. The icon category still sets the pin’s own colour."
                : "Tints the footprint member-blue with a visible boundary. If the area has its own colour (a parking type or a chosen colour), that colour stays and membership adds a blue edge around it instead."}
            </span>
          </span>
        </label>
      )}

      {draft.kind === "marker" && (
        <div className="rounded-xl border border-sand bg-shell/40 p-3">
          <span className="text-sm font-medium text-ink">Map label</span>
          <p className="mt-0.5 text-xs text-ink-soft">
            The name shown on the map. Labels declutter by zoom — zoom in to see more.
          </p>
          <div className="mt-2 space-y-2.5">
            <Field label="Short label">
              <input
                className={INPUT}
                value={draft.labelText}
                placeholder={shortenTitle(draft.title) || "auto from title"}
                onChange={(e) => patchDraft({ labelText: e.target.value })}
              />
            </Field>
            <div>
              <span className="text-sm font-medium text-ink">Show</span>
              <div className="mt-1.5 flex gap-2">
                {(
                  [
                    ["auto", "Auto"],
                    ["on", "Always"],
                    ["off", "Hidden"],
                  ] as [LabelShow, string][]
                ).map(([val, lbl]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => patchDraft({ labelShow: val })}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      draft.labelShow === val
                        ? "border-tide bg-tide/10 text-tide-deep"
                        : "border-sand bg-white text-ink-soft hover:bg-shell"
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Placement">
                <select
                  className={INPUT}
                  value={draft.labelDir}
                  onChange={(e) => patchDraft({ labelDir: e.target.value as LabelDir })}
                >
                  <option value="auto">Auto</option>
                  <option value="top">Top</option>
                  <option value="right">Right</option>
                  <option value="bottom">Bottom</option>
                  <option value="left">Left</option>
                </select>
              </Field>
              <Field label="Priority (−50…50)">
                <input
                  className={INPUT}
                  type="number"
                  min={-50}
                  max={50}
                  value={draft.labelPriority}
                  placeholder="0"
                  onChange={(e) => patchDraft({ labelPriority: e.target.value })}
                />
              </Field>
            </div>
          </div>
        </div>
      )}

      {draft.parkingType ? (
        <Field label="Color">
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-9 w-12 rounded border border-sand"
              style={{ background: parkingTypeInfo(draft.parkingType)?.color ?? "#7a7468" }}
            />
            <span className="text-xs text-ink-soft">Color: automatic by parking type</span>
          </span>
        </Field>
      ) : (
        <Field label={draft.kind === "marker" ? "Pin tint (optional)" : "Color"}>
          <span className="flex items-center gap-2">
            <input
              type="color"
              value={draft.color || (draft.kind === "marker" ? markerCategory(draft.category).color : defaultColor(draft.kind))}
              onChange={(e) => patchDraft({ color: e.target.value })}
              className="h-9 w-12 cursor-pointer rounded border border-sand"
            />
            {draft.color && (
              <button
                type="button"
                onClick={() => patchDraft({ color: "" })}
                className="text-xs font-semibold text-ink-soft hover:underline"
              >
                reset
              </button>
            )}
          </span>
        </Field>
      )}

      {/* Parking details — optional structured fields, shown when a parking
          type is selected. */}
      {draft.parkingType && (
        <div className="rounded-xl border border-sand bg-shell/40 p-3">
          <span className="text-sm font-semibold text-sound-deep">Parking details</span>
          <div className="mt-2 flex flex-col gap-3">
            <Field label="Owner">
              <input
                className={INPUT}
                value={draft.owner}
                onChange={(e) => patchDraft({ owner: e.target.value })}
                placeholder="e.g. City of Kingston, Kingston Chamber"
              />
            </Field>
            <Field label="Phone">
              <input
                className={INPUT}
                type="tel"
                value={draft.phone}
                onChange={(e) => patchDraft({ phone: e.target.value })}
                placeholder="(360) 555-0100"
              />
            </Field>
            <Field label="Payment method">
              <input
                className={INPUT}
                value={draft.paymentMethod}
                onChange={(e) => patchDraft({ paymentMethod: e.target.value })}
                placeholder="Text-to-pay, Kiosk (card), PayByPhone…"
              />
            </Field>
            <Field label="Payment link (https:// or app link)">
              <input
                className={INPUT}
                value={draft.paymentLink}
                onChange={(e) => patchDraft({ paymentLink: e.target.value })}
                placeholder="https:// or app deep link"
              />
            </Field>
            <Field label="Payment notes">
              <textarea
                className={INPUT}
                rows={2}
                value={draft.paymentNotes}
                onChange={(e) => patchDraft({ paymentNotes: e.target.value })}
              />
            </Field>
            <Field label="Time limit(s)">
              <input
                className={INPUT}
                value={draft.timeLimit}
                onChange={(e) => patchDraft({ timeLimit: e.target.value })}
                placeholder="e.g. 2 hours, 24 hr max"
              />
            </Field>
          </div>
        </div>
      )}

      <Field label="Notes">
        <textarea
          className={INPUT}
          rows={3}
          value={draft.notes}
          onChange={(e) => patchDraft({ notes: e.target.value })}
        />
      </Field>

      <Field label="Link (https://…)">
        <input
          className={INPUT}
          value={draft.link}
          onChange={(e) => patchDraft({ link: e.target.value })}
          placeholder="https://"
        />
      </Field>

      <div>
        <span className="text-sm font-medium text-ink">Photos</span>
        {draft.images.length > 0 && (
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {draft.images.map((name) => (
              <div key={name} className="relative">
                <img
                  src={`/api/map/image?p=${encodeURIComponent(name)}`}
                  alt=""
                  className="h-20 w-full rounded-lg border border-sand object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeDraftImage(name)}
                  aria-label="Remove photo"
                  className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-sand bg-white text-xs font-bold text-coral-deep shadow transition-colors hover:bg-coral/10"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-2">
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/gif"
            disabled={uploading}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) void uploadImages(files);
              e.target.value = "";
            }}
            className="text-xs text-ink-soft file:mr-2 file:rounded-full file:border-0 file:bg-sound file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white"
          />
        </div>
        {uploading && <p className="mt-1 text-xs text-ink-soft">Uploading…</p>}
      </div>

      <div>
        <span className="text-sm font-medium text-ink">Show on views</span>
        <div className="mt-1.5 flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-lg border border-sand p-2">
          {views.length === 0 && <p className="text-xs text-ink-soft">No views yet.</p>}
          {views.map((v) => (
            <label key={v.id} className="flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={draft.views.includes(v.id)}
                onChange={() => toggleDraftView(v.id)}
              />
              <span className="truncate">{v.name}</span>
              {!v.published && <Badge tone="sand">draft</Badge>}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="rounded-full bg-sound px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sound-deep disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save feature"}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={saving}
          className="rounded-full border border-coral px-3 py-2 text-sm font-semibold text-coral-deep transition-colors hover:bg-coral/10 disabled:opacity-50"
        >
          🗑 Delete feature
        </button>
      </div>

      {msg && (
        <p className={`text-sm font-medium ${msg.kind === "ok" ? "text-fern" : "text-coral-deep"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );

  const viewFormBody = viewDraft && (
    <div className="flex flex-col gap-3">
      <Field label="Name">
        <input
          className={INPUT}
          value={viewDraft.name}
          onChange={(e) => patchView({ name: e.target.value })}
          placeholder="e.g. Food & Drink"
        />
      </Field>
      <Field label="Description">
        <textarea
          className={INPUT}
          rows={2}
          value={viewDraft.description}
          onChange={(e) => patchView({ description: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Center lat">
          <input
            className={INPUT}
            type="number"
            step="0.0001"
            value={viewDraft.center[0]}
            onChange={(e) =>
              patchView({ center: [Number(e.target.value), viewDraft.center[1]] })
            }
          />
        </Field>
        <Field label="Center lng">
          <input
            className={INPUT}
            type="number"
            step="0.0001"
            value={viewDraft.center[1]}
            onChange={(e) =>
              patchView({ center: [viewDraft.center[0], Number(e.target.value)] })
            }
          />
        </Field>
      </div>
      <button
        type="button"
        onClick={useCurrentCenter}
        disabled={!mapReady}
        className="rounded-full border border-sand bg-shell px-3 py-1.5 text-xs font-semibold text-sound-deep transition-colors hover:bg-sand disabled:opacity-50"
      >
        Use current map center
      </button>
      <Field label={`Zoom (10–19): ${viewDraft.zoom}`}>
        <input
          type="range"
          min={10}
          max={19}
          step={1}
          value={viewDraft.zoom}
          onChange={(e) => patchView({ zoom: Number(e.target.value) })}
          className="w-full"
        />
      </Field>
      <div>
        <span className="text-sm font-medium text-ink">Built-in layers</span>
        <div className="mt-1.5 flex flex-col gap-1.5">
          {SOURCE_OPTIONS.map((s) => (
            <label key={s.key} className="flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={viewDraft.sources.includes(s.key)}
                onChange={() => toggleViewSource(s.key)}
              />
              {s.label}
            </label>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={viewDraft.published}
          onChange={(e) => patchView({ published: e.target.checked })}
        />
        Published (visible on the public map switcher)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={saveView}
          disabled={viewSaving}
          className="rounded-full bg-sound px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-sound-deep disabled:opacity-50"
        >
          {viewSaving ? "Saving…" : "Save view"}
        </button>
        <button
          type="button"
          onClick={closeViewPanel}
          className="rounded-full border border-sand px-4 py-1.5 text-sm font-semibold text-ink-soft transition-colors hover:bg-shell"
        >
          Cancel
        </button>
        {viewEditId && (
          <button
            type="button"
            onClick={() => {
              const v = views.find((x) => x.id === viewEditId);
              if (v) deleteView(v);
            }}
            className="rounded-full border border-coral px-4 py-1.5 text-sm font-semibold text-coral-deep transition-colors hover:bg-coral/10"
          >
            Delete view
          </button>
        )}
      </div>
      {viewMsg && (
        <p className={`text-xs font-medium ${viewMsg.kind === "ok" ? "text-fern" : "text-coral-deep"}`}>
          {viewMsg.text}
        </p>
      )}
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <style>{ME_CSS}</style>
      {/* ---------------- views strip ---------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold tracking-wide text-sound-deep uppercase">Views</span>
        {views.length === 0 && (
          <span className="text-sm text-ink-soft">No views yet — create one.</span>
        )}
        {views.map((v) => {
          const count = features.filter((f) => f.views.includes(v.id)).length;
          const isActive = v.id === activeViewId && !showAll;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => pickActiveView(v.id)}
              title={v.sources.length > 0 ? `Built-ins: ${v.sources.join(", ")}` : undefined}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                isActive
                  ? "border-tide bg-tide/10 text-tide-deep"
                  : "border-sand bg-white text-ink-soft hover:bg-shell"
              }`}
            >
              <span className="max-w-40 truncate">{v.name}</span>
              <span className="font-normal">· {count}</span>
              {v.sources.length > 0 && (
                <span aria-hidden className="font-normal">
                  {v.sources.map((s) => SOURCE_SHORT[s] ?? s).join("")}
                </span>
              )}
              {!v.published && <Badge tone="sand">draft</Badge>}
            </button>
          );
        })}
        <button
          type="button"
          onClick={toggleShowAll}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
            showAll
              ? "border-tide bg-tide/10 text-tide-deep"
              : "border-sand bg-white text-ink-soft hover:bg-shell"
          }`}
        >
          {showAll ? "✓ All views" : "All views"}
        </button>
        <button
          type="button"
          onClick={newView}
          className="rounded-full bg-sound px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sound-deep"
        >
          + New view
        </button>
        {activeView && !showAll && (
          <button
            type="button"
            onClick={() => editView(activeView)}
            className="rounded-full border border-sand bg-white px-3 py-1.5 text-xs font-semibold text-tide-deep transition-colors hover:bg-shell"
          >
            ✎ Edit view
          </button>
        )}

        {/* Features (N) dropdown — pans/selects on click */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setFeatListOpen((o) => !o)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              featListOpen
                ? "border-tide bg-tide/10 text-tide-deep"
                : "border-sand bg-white text-ink-soft hover:bg-shell"
            }`}
          >
            {showAll || !activeView ? "All features" : "Features"} ({listedFeatures.length}) {featListOpen ? "▴" : "▾"}
          </button>
          {featListOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded-xl border border-sand bg-white shadow-lg">
              <ul className="divide-y divide-sand">
                {listedFeatures.length === 0 && (
                  <li className="px-3 py-3 text-sm text-ink-soft">Nothing here yet — draw something.</li>
                )}
                {listedFeatures.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setFeatListOpen(false);
                        select(f.id);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-shell ${
                        f.id === selectedId ? "bg-tide/10" : ""
                      }`}
                    >
                      <span aria-hidden>
                        {f.kind === "marker" ? markerCategory(f.category).emoji : KIND_EMOJI[f.kind]}
                      </span>
                      <span className="truncate text-ink">{f.title}</span>
                      {unsavedIdsRef.current.has(f.id) && <Badge tone="coral">new</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {!viewDraft && viewMsg && (
        <p className={`text-xs font-medium ${viewMsg.kind === "ok" ? "text-fern" : "text-coral-deep"}`}>
          {viewMsg.text}
        </p>
      )}

      {/* ---------------- draw tools + context toggle ---------------- */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-semibold text-sound-deep">
            {showAll
              ? "Drawing onto: all views"
              : activeView
                ? `Active view: ${activeView.name}`
                : "No active view — pick or create one"}
            <span className="ml-2 text-xs font-normal text-ink-soft">
              New shapes get assigned to the active view.
            </span>
          </span>
          <div className="flex flex-wrap gap-2">
            {(["marker", "line", "trail", "area"] as FeatureKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => toggleDraw(k)}
                disabled={!mapReady}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                  drawing === k
                    ? "border border-coral bg-coral/10 text-coral-deep"
                    : "bg-sound text-white hover:bg-sound-deep"
                }`}
                title={
                  k === "trail"
                    ? "Draw a polyline; it starts as a trail (dashed). Lines and trails share the same draw tool."
                    : undefined
                }
              >
                {drawing === k ? "✕ Cancel" : `${KIND_EMOJI[k]} Draw ${k}`}
              </button>
            ))}
          </div>
        </div>
        <div className="ml-auto flex flex-col items-end gap-0.5 text-right">
          <label className="flex items-center gap-2 text-xs font-semibold text-ink">
            <input
              type="checkbox"
              checked={showBuiltins}
              onChange={(e) => setShowBuiltins(e.target.checked)}
            />
            Show this view’s built-in layers
          </label>
          <span className="text-[11px] text-ink-soft">
            context only — edit parking zones at /admin/map, listings in the portals.
          </span>
        </div>
      </div>

      {/* ---------------- canvas + floating panels ---------------- */}
      <div className="mb-2">
        <BasemapSwitch getMap={() => mapRef.current} />
      </div>
      <div className="relative">
        <div
          ref={containerRef}
          style={{ height: MAP_HEIGHT }}
          className="relative z-0 w-full overflow-hidden rounded-2xl border border-sand"
          role="region"
          aria-label="Editable map canvas for the selected view"
        />

        {/* View edit panel — dismissible overlay on the map's left edge. */}
        {viewDraft && (
          <div className="absolute top-4 left-3 z-10 flex max-h-[calc(100%-2rem)] w-80 max-w-[calc(100%-5rem)] flex-col overflow-hidden rounded-2xl border border-sand bg-white/95 shadow-xl backdrop-blur">
            <div className="flex items-center justify-between gap-2 border-b border-sand px-4 py-2">
              <span className="text-xs font-semibold tracking-wide text-sound-deep uppercase">
                {viewEditId ? "Edit view" : "New view"}
              </span>
              <button
                type="button"
                onClick={closeViewPanel}
                aria-label="Close the view editor"
                className="rounded-full px-1.5 text-sm font-semibold text-ink-soft transition-colors hover:bg-shell"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-4">{viewFormBody}</div>
          </div>
        )}

        {/* Feature drawer — floats over the map's right edge at ≥lg. */}
        {selectedFeature && draft && panelOpen && (
          <div className="absolute top-4 right-4 z-10 hidden max-h-[calc(100%-2rem)] w-80 max-w-sm flex-col overflow-hidden rounded-2xl border border-sand bg-white/95 shadow-xl backdrop-blur lg:flex">
            <div className="flex items-center justify-between gap-2 border-b border-sand px-4 py-2">
              <span className="text-xs font-semibold tracking-wide text-sound-deep uppercase">Feature</span>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                aria-label="Collapse the feature panel"
                className="rounded-full px-1.5 text-sm font-semibold text-ink-soft transition-colors hover:bg-shell"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-4">{featureFormBody}</div>
          </div>
        )}

        {/* Collapsed drawer → small reopen chip so the map stays unobstructed. */}
        {selectedFeature && draft && !panelOpen && (
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            className="absolute top-4 right-4 z-10 hidden items-center gap-1.5 rounded-full border border-sand bg-white/95 px-3 py-1.5 text-xs font-semibold text-sound-deep shadow-lg backdrop-blur transition-colors hover:bg-shell lg:flex"
          >
            ✎ <span className="max-w-48 truncate">Edit “{selectedFeature.title}”</span>
          </button>
        )}
      </div>

      <p className="text-xs text-ink-soft">
        Draw with the buttons above. Click any feature to select it — drag its vertices,
        drag the shape body to move the whole thing, drag marker pins, then Save. To remove
        a point while reshaping, right-click it; to delete a whole feature, select it and
        hit <b>Delete</b>. “Trail” and “Line” use the same polyline tool; switch between
        them in the feature form.
      </p>

      {!selectedFeature && msg && (
        <p className={`text-sm font-medium ${msg.kind === "ok" ? "text-fern" : "text-coral-deep"}`}>
          {msg.text}
        </p>
      )}

      {/* Below lg the feature form is a normal block under the map. */}
      {selectedFeature && draft && (
        <div className="rounded-2xl border border-sand bg-white p-4 shadow-[0_1px_3px_rgba(22,64,94,0.08)] lg:hidden">
          <p className="mb-3 text-xs font-semibold tracking-wide text-sound-deep uppercase">Feature</p>
          {featureFormBody}
        </div>
      )}
    </div>
  );
}

const ME_CSS = `
.me-pin { position: relative; width: 28px; height: 28px; cursor: pointer; }
.me-pin--selected { width: 34px; height: 34px; }
.me-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: 9999px;
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.45);
  font-size: 14px;
  line-height: 1;
}
.me-pin--selected .me-dot { font-size: 17px; }
.me-tip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 6px);
  transform: translateX(-50%);
  display: none;
  white-space: nowrap;
  font: 600 11px/1.2 system-ui, -apple-system, sans-serif;
  color: #fff;
  background: #16405e;
  border-radius: 3px;
  padding: 2px 6px;
}
.me-pin:hover .me-tip { display: block; }
.me-hover {
  position: absolute;
  z-index: 30;
  pointer-events: none;
  white-space: nowrap;
  font: 600 11px/1.2 system-ui, -apple-system, sans-serif;
  color: #fff;
  background: #16405e;
  border-radius: 3px;
  padding: 2px 6px;
}
/* 0x0 wrapper: anchor "center" then pins the ORIGIN at the point, and the
   teardrop's own translate(-50%,-100%) puts its TIP there — the same geometry
   Leaflet's iconSize [0,0] gave the public map's context pins. */
.ctx-pin { width: 0; height: 0; pointer-events: none; opacity: 0.55; }
`;
