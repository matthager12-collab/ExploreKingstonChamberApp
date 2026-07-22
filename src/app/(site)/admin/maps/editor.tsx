"use client";

// The Map Builder (laptop-first) — the Chamber's map CMS.
//
// Layout: a compact VIEWS strip (pills + "New view" + features dropdown) sits
// above a dominant leaflet+geoman CANVAS. The view edit form opens as a
// dismissible overlay on the map's left edge; the selected-FEATURE form is a
// floating drawer on the map's right edge (≥lg) or a plain block under the
// map (<lg). The active view's built-in source layers (restaurants,
// parking zones, street overlay) render as muted, non-interactive CONTEXT so
// the admin can draw against them.
//
// Leaflet touches `window` at module scope, so it is imported dynamically
// inside useEffect (same pattern as components/town-map.tsx and the parking
// editor). Geoman's browser bundle reads the global `L`, so the import order
// in the effect is: leaflet → window.L = L → geoman → create the map. Geoman's
// CSS is a plain stylesheet import — safe at module top because this file is
// client-only and Next extracts CSS at build time.
//
// Geometry read-back on save: the currently selected feature's live leaflet
// layer is queried directly — marker.getLatLng() for markers, and
// polyline/polygon.getLatLngs() (walked to a flat ring) for lines/trails/areas
// — so any geoman vertex drag, whole-shape drag, or marker move is captured at
// Save time (geoman's drag mixin mutates the layer's latlngs in place).
//
// Moving vs reshaping: geoman can't run vertex editing and whole-layer drag on
// the same shape at once (enableLayerDrag() disables edit mode), so selected
// lines/areas get an explicit Reshape ⟷ Move toggle. Markers are simply
// draggable while selected (pm.enable() on a marker enables layer drag).

import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type {
  LatLng,
  Layer,
  LayerGroup,
  Map as LeafletMap,
  Marker,
  Polygon,
  Polyline,
} from "leaflet";
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
import { Badge } from "@/components/ui";

/* ------------------------------------------------------------------ */
/* Constants & small helpers                                           */
/* ------------------------------------------------------------------ */

const KINGSTON_CENTER: [number, number] = [47.7985, -122.4975];

// The canvas is the dominant element of the builder.
const MAP_HEIGHT = "clamp(560px, 72vh, 900px)";

// Leaflet pane for muted built-in context layers: below the overlay pane
// (z 400) so drawn features always sit on top, and pointer-events none so
// clicks and geoman draws pass straight through to the canvas.
const CONTEXT_PANE = "builtin-context";

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

const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;

function pointOf(ll: LatLng): [number, number] {
  return [r6(ll.lat), r6(ll.lng)];
}

function ringToPath(ring: LatLng[]): [number, number][] {
  return ring.map(pointOf);
}

/** polyline.getLatLngs() may nest one level (multi-polyline); take the first. */
function flatLatLngs(raw: unknown): LatLng[] {
  const arr = raw as LatLng[] | LatLng[][];
  if (Array.isArray(arr) && arr.length && Array.isArray(arr[0])) {
    return (arr as LatLng[][])[0];
  }
  return arr as LatLng[];
}

// Leaflet's .bindTooltip(string)/.setTooltipContent(string) assign innerHTML, so
// any dynamic text (feature title / admin label) must be HTML-escaped first, or
// an admin could self-XSS with e.g. `<img src=x onerror=…>` in a label field.
function escHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

type Draft = {
  kind: FeatureKind;
  title: string;
  category: string;
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

/** divIcon showing the category emoji on a colored pin. */
function markerIcon(
  L: typeof import("leaflet"),
  f: { category?: string; color?: string; parking?: { type?: string } | null; parkingType?: string },
  selected: boolean,
) {
  const cat = markerCategory(f.category);
  const color = parkingDrawColor(f) || f.color || cat.color;
  const size = selected ? 34 : 28;
  return L.divIcon({
    className: "",
    html: `<span style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.45);font-size:${
      selected ? 17 : 14
    }px;line-height:1;">${cat.emoji}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function shapeStyle(
  f: { kind: FeatureKind; color?: string; parking?: { type?: string } | null; parkingType?: string },
  selected: boolean,
) {
  const color = shapeColor(f);
  const base = { color, weight: selected ? 5 : 3, opacity: 0.9 };
  if (f.kind === "area") {
    return { ...base, weight: selected ? 3 : 2, fillColor: color, fillOpacity: selected ? 0.4 : 0.25 };
  }
  if (f.kind === "trail") {
    return { ...base, dashArray: "6 6" };
  }
  return base;
}

/* ------------------------------------------------------------------ */
/* Built-in context layer styling (kept in sync with feature-map.tsx)  */
/* ------------------------------------------------------------------ */

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

function normalizeStreetRule(rule: string): StreetRule {
  return rule in STREET_COLORS ? (rule as StreetRule) : "default";
}

function streetStyle(rule: StreetRule): {
  color: string;
  weight: number;
  opacity: number;
  dashArray?: string;
} {
  switch (rule) {
    case "ferry-holding":
      return { color: STREET_COLORS[rule], weight: 3, opacity: 0.45, dashArray: "4 6" };
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

/** Rounded teardrop divIcon html — same pin as the public feature-map. */
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
];

const SOURCE_SHORT: Record<string, string> = {
  restaurants: "🍽",
  "parking-zones": "🅿️",
  streets: "🛣",
};

/** Geoman's per-layer API (the browser bundle attaches `pm` to every layer). */
type GeomanLayer = Layer & {
  pm: {
    enable: (opts?: Record<string, unknown>) => void;
    disable: () => void;
    enableLayerDrag: () => void;
    disableLayerDrag: () => void;
  };
};

type ShapeMode = "reshape" | "move";

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
  // Reshape (vertex edit) vs Move (whole-shape drag) for the selected shape.
  const [shapeMode, setShapeMode] = useState<ShapeMode>("reshape");
  // "Features (N)" dropdown in the strip above the map.
  const [featListOpen, setFeatListOpen] = useState(false);
  // Built-in context layers toggle (default ON).
  const [showBuiltins, setShowBuiltins] = useState(true);
  // Bumped when a view is saved so context layers re-render even if the
  // active view id didn't change (its sources may have).
  const [contextEpoch, setContextEpoch] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const layersRef = useRef(new Map<string, Layer>());
  // Ids drawn this session but never saved — deleting them skips the API.
  const unsavedIdsRef = useRef(new Set<string>());
  // Muted built-in layers for the active view, grouped so a view switch
  // clears and redraws them in one shot.
  const contextGroupRef = useRef<LayerGroup | null>(null);
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
  const activeViewIdRef = useRef(activeViewId);
  activeViewIdRef.current = activeViewId;
  const showAllRef = useRef(showAll);
  showAllRef.current = showAll;
  const showBuiltinsRef = useRef(showBuiltins);
  showBuiltinsRef.current = showBuiltins;
  const shapeModeRef = useRef(shapeMode);
  shapeModeRef.current = shapeMode;
  const selectRef = useRef<(id: string) => void>(() => {});
  // Deletes a feature by id — used by the drawer button and the eraser tool.
  const deleteRef = useRef<
    (id: string, opts?: { confirm?: boolean; alreadyRemovedFromMap?: boolean }) => Promise<void>
  >(async () => {});

  /* ---------------- which features belong on the canvas ---------------- */

  function visibleFeatures(): MapFeature[] {
    const list = featuresRef.current;
    if (showAllRef.current || !activeViewIdRef.current) return list;
    return list.filter((f) => f.views.includes(activeViewIdRef.current!));
  }

  /* ---------------- imperative layer management ---------------- */

  function makeLayer(f: MapFeature): Layer | null {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return null;

    let layer: Layer | null = null;
    if (f.kind === "marker" && f.point) {
      layer = L.marker(f.point, { icon: markerIcon(L, f, false) })
        .addTo(map)
        .bindTooltip(
          escHtml(
            resolveLabel({ title: f.title, category: f.category, kind: f.kind, label: f.label })
              .text,
          ),
          { direction: "top", offset: [0, -14] },
        );
    } else if ((f.kind === "line" || f.kind === "trail") && f.path && f.path.length >= 2) {
      layer = L.polyline(f.path, shapeStyle(f, false))
        .addTo(map)
        .bindTooltip(escHtml(f.title), { sticky: true });
    } else if (f.kind === "area" && f.polygon && f.polygon.length >= 3) {
      layer = L.polygon(f.polygon, shapeStyle(f, false))
        .addTo(map)
        .bindTooltip(escHtml(f.title), { sticky: true });
    }
    if (!layer) return null;

    layer.on("click", () => selectRef.current(f.id));
    // pm:* events fire only while geoman editing/dragging is enabled.
    layer.on("pm:edit", () => setDirty(true));
    layer.on("pm:markerdragend", () => setDirty(true));
    layer.on("pm:dragend", () => setDirty(true)); // geoman whole-layer drag
    layer.on("dragend", () => setDirty(true));
    layersRef.current.set(f.id, layer);
    return layer;
  }

  function removeLayer(id: string) {
    const layer = layersRef.current.get(id);
    layer?.remove();
    layersRef.current.delete(id);
  }

  function renderCanvas() {
    // Rebuild every layer to reflect the current view filter + feature data.
    for (const id of [...layersRef.current.keys()]) removeLayer(id);
    for (const f of visibleFeatures()) makeLayer(f);
    // Re-arm editing on the selected feature if it's still visible.
    const sel = selectedIdRef.current;
    if (sel) {
      const f = featuresRef.current.find((x) => x.id === sel);
      if (f && layersRef.current.has(sel)) setEditing(sel, f, true);
    }
  }

  function setEditing(id: string, f: MapFeature, on: boolean) {
    const layer = layersRef.current.get(id) as GeomanLayer | undefined;
    const L = leafletRef.current;
    if (!layer || !L) return;
    if (f.kind === "marker") {
      (layer as unknown as Marker).setIcon(markerIcon(L, f, on));
      // pm.enable() on a marker enables layer drag (move) automatically.
      // preventMarkerRemoval stops geoman's right-click delete, which would
      // silently desync the layer from app state.
      if (on) layer.pm.enable({ draggable: true, preventMarkerRemoval: true });
      else layer.pm.disable();
      return;
    }
    (layer as unknown as Polyline).setStyle(shapeStyle(f, on));
    if (!on) {
      layer.pm.disableLayerDrag();
      layer.pm.disable();
      return;
    }
    // Geoman can't vertex-edit and whole-layer-drag simultaneously, so the
    // selected shape honors the Reshape ⟷ Move toggle.
    if (shapeModeRef.current === "move") {
      layer.pm.disable();
      layer.pm.enableLayerDrag();
    } else {
      layer.pm.disableLayerDrag();
      layer.pm.enable({ allowSelfIntersection: f.kind !== "area" });
    }
  }

  /** Switch the selected shape between vertex editing and whole-shape drag. */
  function pickShapeMode(mode: ShapeMode) {
    if (shapeModeRef.current === mode) return;
    shapeModeRef.current = mode;
    setShapeMode(mode);
    const id = selectedIdRef.current;
    if (!id) return;
    const f = featuresRef.current.find((x) => x.id === id);
    if (f && f.kind !== "marker" && layersRef.current.has(id)) setEditing(id, f, true);
  }

  /* ---------------- built-in context layers ---------------- */

  // Renders the active view's built-in sources as muted, non-interactive
  // context (same colors/shapes as the public feature-map, opacity roughly
  // halved, no popups). Everything lives in one layerGroup on a pane below
  // the overlay pane with pointer-events disabled, so clicks and geoman draws
  // pass straight through.
  async function renderContextLayers() {
    const seq = ++contextSeqRef.current;
    contextGroupRef.current?.remove();
    contextGroupRef.current = null;

    const L = leafletRef.current;
    const map = mapRef.current;
    const viewId = activeViewIdRef.current;
    if (!L || !map || !viewId || !showBuiltinsRef.current) return;

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

      const muted = { pane: CONTEXT_PANE, interactive: false } as const;
      const group = L.layerGroup();

      // Restaurants — same teardrop pins as the public map, dimmed.
      for (const r of data.builtins.restaurants ?? []) {
        const cat = markerCategory(r.category);
        const icon = L.divIcon({
          className: "",
          html: contextPinHtml(cat.emoji, cat.color),
          iconSize: [0, 0],
        });
        group.addLayer(L.marker([r.lat, r.lng], { ...muted, icon, opacity: 0.55 }));
      }

      // Parking zones — polygons colored by rule (circle fallback).
      for (const z of data.builtins.parkingZones ?? []) {
        const color = parkingColor(z.rule);
        if (z.polygon && z.polygon.length >= 3) {
          group.addLayer(
            L.polygon(z.polygon, {
              ...muted,
              color,
              weight: 2,
              opacity: 0.45,
              fillColor: color,
              fillOpacity: 0.18,
            }),
          );
        } else {
          group.addLayer(
            L.circleMarker(z.center, {
              ...muted,
              radius: 7,
              color: "#ffffff",
              weight: 2,
              opacity: 0.5,
              fillColor: color,
              fillOpacity: 0.45,
            }),
          );
        }
      }

      // Streets — UGA boundary (dashed navy) + rule-styled segments.
      if (street) {
        group.addLayer(
          L.polygon(street.boundary, {
            ...muted,
            color: BOUNDARY_COLOR,
            weight: 2,
            dashArray: "6 6",
            fill: false,
            opacity: 0.5,
          }),
        );
        const rank = (r: StreetRule) => (r === "default" ? 0 : r === "ferry-holding" ? 1 : 2);
        const ordered = [...street.segments].sort(
          (a, b) => rank(normalizeStreetRule(a.rule)) - rank(normalizeStreetRule(b.rule)),
        );
        for (const seg of ordered) {
          const style = streetStyle(normalizeStreetRule(seg.rule));
          group.addLayer(
            L.polyline(seg.coords, { ...muted, ...style, opacity: style.opacity / 2 }),
          );
        }
      }

      group.addTo(mapRef.current);
      contextGroupRef.current = group;
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

  // Reflect the selected feature's draft color / parking type on its live map
  // layer as the admin edits (before Save). Parking type wins over manual
  // color; falls back to the stored feature otherwise.
  useEffect(() => {
    const id = selectedIdRef.current;
    const L = leafletRef.current;
    if (!id || !draft || !L) return;
    const f = featuresRef.current.find((x) => x.id === id);
    const layer = layersRef.current.get(id);
    if (!f || !layer) return;
    const selected = true;
    // Draft-driven color source for the style/icon helpers.
    const styled = { kind: f.kind, color: draft.color, parkingType: draft.parkingType };
    if (f.kind === "marker") {
      (layer as unknown as Marker).setIcon(
        markerIcon(L, { category: draft.category, color: draft.color, parkingType: draft.parkingType }, selected),
      );
      // Live-preview the effective label text in the hover tooltip as the admin types.
      (layer as unknown as Marker).setTooltipContent(
        escHtml(
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
        ),
      );
    } else {
      (layer as unknown as Polyline).setStyle(shapeStyle(styled, selected));
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
    if (prev) {
      const prevF = featuresRef.current.find((f) => f.id === prev);
      if (prevF) setEditing(prev, prevF, false);
    }

    const f = featuresRef.current.find((x) => x.id === id);
    if (!f) return;
    setSelectedId(id);
    setDraft(toDraft(f));
    setDirty(false);
    setMsg(null);
    setPanelOpen(true);
    shapeModeRef.current = "reshape";
    setShapeMode("reshape");

    const map = mapRef.current;
    const layer = layersRef.current.get(id);
    if (map && layer) {
      if (f.kind === "marker" && f.point) {
        map.setView(f.point, Math.max(map.getZoom(), 16));
      } else if ("getBounds" in layer) {
        map.fitBounds((layer as Polyline).getBounds(), { padding: [60, 60], maxZoom: 18 });
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
    setDraft(null);
    setDirty(false);
    shapeModeRef.current = "reshape";
    setShapeMode("reshape");
  }

  /* ---------------- map bootstrap ---------------- */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      // Geoman's browser bundle registers itself on the global L.
      (window as unknown as { L?: typeof L }).L = L;
      await import("@geoman-io/leaflet-geoman-free");
      // Guard: unmounted while loading, or already initialized (StrictMode).
      if (cancelled || !containerRef.current || mapRef.current) return;

      leafletRef.current = L;
      const first = initialViews[0];
      const map = L.map(containerRef.current, {
        center: first ? first.center : KINGSTON_CENTER,
        zoom: first ? first.zoom : 15,
      });
      mapRef.current = map;

      // Pane for muted built-in context layers: between the tiles (z 200) and
      // the overlay pane (z 400); pointer-events none so it never swallows a
      // click or a geoman draw.
      const pane = map.createPane(CONTEXT_PANE);
      pane.style.zIndex = "350";
      pane.style.pointerEvents = "none";

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      // Geoman controls — draw markers, polylines (line/trail), polygons (area).
      map.pm.addControls({
        position: "topleft",
        drawMarker: true,
        drawPolyline: true,
        drawPolygon: true,
        drawCircle: false,
        drawRectangle: false,
        drawCircleMarker: false,
        drawText: false,
        editMode: true,
        dragMode: true,
        cutPolygon: false,
        rotateMode: false,
        removalMode: true, // the trash tool: click a feature to delete it
      });
      map.pm.setGlobalOptions({ allowSelfIntersection: false });

      map.on("pm:create", (e: { shape: string; layer: Layer }) => {
        handleDrawnRef.current(e.shape, e.layer);
      });

      // Eraser tool removed a layer — reverse-look it up and delete the
      // matching feature (context layers are non-interactive, so they never
      // fire this; an untracked half-drawn layer is ignored).
      map.on("pm:remove", (e: { layer: Layer }) => {
        let removedId: string | null = null;
        for (const [fid, layer] of layersRef.current) {
          if (layer === e.layer) {
            removedId = fid;
            break;
          }
        }
        if (removedId) {
          void deleteRef.current(removedId, { confirm: false, alreadyRemovedFromMap: true });
        }
      });

      renderCanvas();
      setMapReady(true);
    })();

    return () => {
      cancelled = true;
      contextSeqRef.current++; // invalidate in-flight context fetches
      mapRef.current?.remove();
      mapRef.current = null;
      layersRef.current.clear();
      contextGroupRef.current = null;
    };
    // Features are managed imperatively after mount; re-running would tear the
    // map down mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- draw a new feature ---------------- */

  const handleDrawnRef = useRef<(shape: string, layer: Layer) => void>(() => {});
  handleDrawnRef.current = (shape: string, layer: Layer) => {
    setDrawing(null);
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    // Infer kind + geometry from the drawn shape.
    let kind: FeatureKind;
    const partial: Partial<MapFeature> = {};
    if (shape === "Marker") {
      kind = "marker";
      partial.point = pointOf((layer as Marker).getLatLng());
    } else if (shape === "Line") {
      kind = "line"; // admin can switch to "trail" in the form
      const path = ringToPath(flatLatLngs((layer as Polyline).getLatLngs()));
      if (path.length < 2) {
        layer.remove();
        return;
      }
      partial.path = path;
    } else if (shape === "Polygon") {
      kind = "area";
      const poly = ringToPath(flatLatLngs((layer as Polygon).getLatLngs()));
      if (poly.length < 3) {
        layer.remove();
        return;
      }
      partial.polygon = poly;
    } else {
      layer.remove();
      return;
    }

    layer.remove(); // re-added via makeLayer so wiring is uniform

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
    makeLayer(f);
    select(id);
    setDirty(true);
    setMsg({
      kind: "ok",
      text: targetView
        ? "Shape drawn — fill in the details, then Save to publish."
        : "Shape drawn — pick at least one view under “Show on views”, then Save.",
    });
  };

  function toggleDraw(kind: FeatureKind) {
    const map = mapRef.current;
    if (!map) return;
    if (drawing === kind) {
      map.pm.disableDraw();
      setDrawing(null);
      return;
    }
    map.pm.disableDraw();
    const geomanShape = kind === "marker" ? "Marker" : kind === "area" ? "Polygon" : "Line";
    map.pm.enableDraw(geomanShape);
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

  /** The draft feature with geometry read back from its live map layer. */
  function buildFeature(): MapFeature | null {
    if (!draft || !selectedId) return null;
    const existing = featuresRef.current.find((f) => f.id === selectedId);
    if (!existing) return null;

    const layer = layersRef.current.get(selectedId);
    const kind = draft.kind;

    // Read geometry back from the live layer where its shape matches the kind;
    // fall back to the stored geometry otherwise (e.g. line ↔ trail switch
    // keeps the same polyline layer, so its path is still valid). Geoman's
    // vertex edits AND whole-layer drags both mutate the live layer's latlngs,
    // so dragged positions are captured here too.
    let point = existing.point;
    let path = existing.path;
    let polygon = existing.polygon;
    if (layer) {
      if (kind === "marker" && "getLatLng" in layer) {
        point = pointOf((layer as Marker).getLatLng());
      } else if ((kind === "line" || kind === "trail") && "getLatLngs" in layer) {
        path = ringToPath(flatLatLngs((layer as Polyline).getLatLngs()));
      } else if (kind === "area" && "getLatLngs" in layer) {
        polygon = ringToPath(flatLatLngs((layer as Polygon).getLatLngs()));
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
      removeLayer(saved.id);
      const onCanvas = visibleFeatures().some((f) => f.id === saved.id);
      if (onCanvas) {
        makeLayer(saved);
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
   * Delete a feature by id. Used by the drawer "Delete" button (confirm) and
   * the toolbar eraser tool (no confirm; geoman already pulled the layer off
   * the map, so pass alreadyRemovedFromMap). Seed features are tombstoned
   * server-side, not erased; unsaved drafts just drop locally.
   */
  async function deleteFeatureById(
    id: string,
    opts: { confirm?: boolean; alreadyRemovedFromMap?: boolean } = {},
  ) {
    const { confirm = true, alreadyRemovedFromMap = false } = opts;
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
          // Server refused — put the erased layer back so state stays honest.
          if (alreadyRemovedFromMap) {
            layersRef.current.delete(id);
            renderCanvas();
          }
          return;
        }
      } catch {
        setMsg({ kind: "error", text: "Could not reach the server — is the app running?" });
        if (alreadyRemovedFromMap) {
          layersRef.current.delete(id);
          renderCanvas();
        }
        return;
      } finally {
        setSaving(false);
      }
    }

    const title = f.title;
    if (selectedIdRef.current === id) deselect();
    if (alreadyRemovedFromMap) layersRef.current.delete(id);
    else removeLayer(id);
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
    if (map && view) map.setView(view.center, view.zoom);
    renderCanvas();
  }

  function toggleShowAll() {
    if (dirtyRef.current && !window.confirm("Discard unsaved feature changes?")) return;
    deselect();
    const next = !showAll;
    setShowAll(next);
    showAllRef.current = next;
    renderCanvas();
  }

  /* ---------------- view create / edit ---------------- */

  function newView() {
    const map = mapRef.current;
    const center: [number, number] = map
      ? [r6(map.getCenter().lat), r6(map.getCenter().lng)]
      : KINGSTON_CENTER;
    const zoom = map ? map.getZoom() : 15;
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
    const map = mapRef.current;
    if (!map) return;
    patchView({
      center: [r6(map.getCenter().lat), r6(map.getCenter().lng)],
      zoom: map.getZoom(),
    });
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
        <div>
          <span className="text-sm font-medium text-ink">Editing mode</span>
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              onClick={() => pickShapeMode("reshape")}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                shapeMode === "reshape"
                  ? "border-tide bg-tide/10 text-tide-deep"
                  : "border-sand bg-white text-ink-soft hover:bg-shell"
              }`}
            >
              Reshape (drag points)
            </button>
            <button
              type="button"
              onClick={() => pickShapeMode("move")}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                shapeMode === "move"
                  ? "border-tide bg-tide/10 text-tide-deep"
                  : "border-sand bg-white text-ink-soft hover:bg-shell"
              }`}
            >
              Move whole shape
            </button>
          </div>
          {shapeMode === "reshape" && (
            <p className="mt-1.5 rounded-lg bg-shell/70 px-3 py-2 text-xs text-ink-soft">
              Drag a point to move it. Click a faint <b>＋</b> midpoint to add a point.
              Right-click (or two-finger tap) a point to remove it. Then Save.
            </p>
          )}
        </div>
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
              style={{ background: parkingTypeInfo(draft.parkingType)?.color ?? "#6b7280" }}
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
      <div className="relative">
        <div
          ref={containerRef}
          style={{ height: MAP_HEIGHT }}
          className="relative z-0 w-full overflow-hidden rounded-2xl border border-sand"
          role="region"
          aria-label="Editable map canvas for the selected view"
        />

        {/* View edit panel — dismissible overlay on the map's left edge,
            offset past the geoman toolbar. */}
        {viewDraft && (
          <div className="absolute top-4 left-14 z-10 flex max-h-[calc(100%-2rem)] w-80 max-w-[calc(100%-5rem)] flex-col overflow-hidden rounded-2xl border border-sand bg-white/95 shadow-xl backdrop-blur">
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
        Draw with the buttons above (or geoman’s toolbar, top-left). Click any feature to select
        it — drag its vertices (or switch to “Move whole shape”), drag marker pins, then Save.
        To remove a point while reshaping, right-click it; to delete a whole feature, select it
        and hit <b>Delete</b>, or use the trash (🗑) tool in the toolbar and click the feature.
        “Trail” and “Line” use the same polyline tool; switch between them in the feature form.
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
