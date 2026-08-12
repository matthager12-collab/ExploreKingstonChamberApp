"use client";

// Parking-map zone editor for the Chamber admin (laptop-first).
//
// E32a (ADR-0006): MapLibre GL on the self-hosted vector tiles + terra-draw
// for interactive editing — the Leaflet + geoman stack this file was built on
// is retired. The heavy browser-only libraries are loaded dynamically inside
// useEffect (same pattern as components/feature-map.tsx); terra-draw is
// created after the map's style loads, which the adapter requires.
//
// Flow: pick a zone from the sidebar (or click it on the map) → the map fits to
// it, its shape grows drag-able handles (terra-draw select mode: drag a vertex,
// click a midpoint to add one, right-click to remove) and its center pin becomes
// draggable → adjust shape and fields → Save POSTs the geometry read back from
// the draw store to /api/admin/parking. Delete tombstones the zone in the
// overlay store (seed zones stay hidden).
//
// TWO GEOMETRY KINDS, and the difference is the thing to hold on to:
//   - a LOT is a `polygon` — one draw feature under the zone id;
//   - a STREET is `streetPaths`, a LIST of centre-line polylines, drawn as
//     curb-hugging offset strokes on the public map. Each path is its own draw
//     feature under `id~n` (see PATH_SEP) and they are reassembled on save.
// Street geometry used to be a read-only OSM underlay. It is now drawable and
// editable here, because the Chamber needs to map streets OSM never split out —
// local eyes beat the import, which is the same principle the polygons already
// followed. `pe-streets` survives as a live PREVIEW of the offset result.
//
// Wire-format invariant (FR-EDIT-06): the API speaks stored [lat,lng] open
// rings, r6-rounded; terra-draw speaks GeoJSON [lng,lat] closed rings. Every
// crossing goes through @/lib/map/draw-coords — nothing here converts by hand.

import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BasemapSwitch } from "@/components/admin/basemap-switch";
import { PhotoPicker } from "@/components/admin/photo-picker";
import type { MediaItem } from "@/lib/media/refs";
import { useRouter } from "next/navigation";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import type { GeoJSONStoreFeatures, TerraDraw } from "terra-draw";
import {
  CURB_SIDES,
  PORT_SHORT_CODE,
  RULE_LABELS,
  type CurbSide,
  type MapZone,
  type ParkingRule,
  type PayHandoff,
  type PayVendor,
} from "@/lib/data/parking";
import { payHref, payInstruction } from "@/lib/parking/pay-links";
import {
  BAY_TRANSFORM_LIMITS,
  IDENTITY_BAY_TRANSFORM,
  bayPivot,
  clampBayTransform,
  isIdentityBayTransform,
  transformRing,
  type BayTransform,
} from "@/lib/map/bay-transform";
import { mapStyle, TILES_PMTILES_PATH } from "@/lib/map/basemap";
import { loadMapLibre, pmtilesUrl } from "@/lib/map/maplibre";
import { editorIdStrategy, loadTerraDraw } from "@/lib/map/terradraw";
import {
  r6,
  toGeoJsonPath,
  toStoredPath,
  toStoredRing,
} from "@/lib/map/draw-coords";
import { curbOffsetSigns } from "@/lib/map/curb";
import {
  isZoneFeature,
  pathMidpoint,
  streetPathsFromFeatures,
  zoneDrawFeatures,
  zoneIdOfFeature,
} from "@/lib/map/zone-draw";
import { Badge } from "@/components/ui";

/* ------------------------------------------------------------------ */
/* Constants & small helpers                                           */
/* ------------------------------------------------------------------ */

// Same canvas colors as the public maps — they live on the map, not in the
// page's token system. Values are ADR-0007 §4 ("Evergreen & Sound").
const RULE_COLORS: Record<string, string> = {
  "free-2hr": "#2e9e4f",
  "free-unrestricted": "#1E96C0",
  paid: "#7c4dbe",
  "business-customer": "#9c2f6f",
  "park-and-ride-24h": "#8a4c22",
  prohibited: "#d43d3d",
  "load-zone": "#b8860b",
  permit: "#7a7468",
};

const RULES: ParkingRule[] = [
  "free-2hr",
  "free-unrestricted",
  "paid",
  "business-customer",
  "park-and-ride-24h",
  "prohibited",
  "load-zone",
  "permit",
];

const INPUT =
  "w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm text-ink focus:border-tide focus:outline-none";

/** One generated bay from /geo/port-stalls.json. */
type BayFeature = {
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: { zone: string; rule: string; code: string | null; range: string | null };
};

/**
 * A readable name for a bay group, from the BAYS rather than from a MapZone.
 *
 * Group ids are generation-time provenance (`port-pokpark-north-rows`), not
 * foreign keys, and treating them as foreign keys is what broke: the Chamber
 * deleted several of those lots and redrew their own, so three groups pointed
 * at nothing. The bays themselves still carry the Port's pay code and printed
 * space ranges, which is both stable and what an admin actually recognises —
 * "POKPARK 181–190, 201–213" beats a slug for a lot that no longer exists.
 */
function bayGroupLabel(zoneId: string, bays: BayFeature[]): string {
  const mine = bays.filter((b) => b.properties.zone === zoneId);
  const code = mine.find((b) => b.properties.code)?.properties.code;
  const ranges = [...new Set(mine.map((b) => b.properties.range).filter(Boolean))];
  if (code && ranges.length) return `${code} · spaces ${ranges.join(", ")}`;
  if (code) return `${code} · ${mine.length} spaces`;
  // Unnumbered groups (free 2-hour, KCYC, tenant, disabled) have no code or
  // range printed on the Port's map, so fall back to the rule and a count.
  const rule = mine[0]?.properties.rule ?? "";
  const pretty = zoneId.replace(/^port-/, "").replace(/-/g, " ");
  return `${pretty} · ${mine.length} spaces${rule ? ` (${rule})` : ""}`;
}

/** Bay fill in the editor preview — one flat colour, not the public palette.
 *  The editor question is "are these in the right PLACE", and seven hues would
 *  only compete with the zone shapes and pins the admin is aiming at. */
const BAY_PREVIEW_COLOR = "#16758f";

function ruleColor(rule: string): `#${string}` {
  return (RULE_COLORS[rule] ?? "#7a7468") as `#${string}`;
}

/** Rule color for a terra-draw feature (zone polygons carry `rule`). */
function featureRuleColor(f: GeoJSONStoreFeatures): `#${string}` {
  const rule = f.properties?.rule;
  return ruleColor(typeof rule === "string" ? rule : "");
}

function centroidOf(polygon: [number, number][]): [number, number] {
  const lat = polygon.reduce((s, p) => s + p[0], 0) / polygon.length;
  const lng = polygon.reduce((s, p) => s + p[1], 0) / polygon.length;
  return [r6(lat), r6(lng)];
}

// Leaflet ran the old editor at raster zooms (256px tiles); MapLibre's vector
// zooms render one level lower for the same scale, so every zoom constant
// here is the old one minus 1.
const START_CENTER: [number, number] = [-122.4979, 47.7968]; // [lng, lat]
const START_ZOOM = 16;
const MAX_ZOOM = 18;

type Draft = {
  name: string;
  rule: ParkingRule;
  summary: string;
  details: string;
  overnight: MapZone["overnight"];
  confidence: MapZone["confidence"];
  /** "" = side unknown (renders the centre line). Street zones only. */
  curb: CurbSide | "";
  /** Shared-library photo names, in display order. */
  images: string[];
  /** Payment hand-offs. Editable here so a Port code change needs no deploy. */
  pay: PayHandoff[];
};

function toDraft(zone: MapZone): Draft {
  return {
    name: zone.name,
    rule: zone.rule,
    summary: zone.summary,
    details: zone.details,
    overnight: zone.overnight,
    confidence: zone.confidence,
    curb: zone.curb ?? "",
    images: zone.images ?? [],
    pay: zone.pay ?? [],
  };
}

const CURB_OPTION_LABELS: Record<CurbSide, string> = {
  both: "Both sides of the street",
  east: "East side only",
  west: "West side only",
  north: "North side only",
  south: "South side only",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-ink">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function ConfidenceBadge({ confidence }: { confidence: MapZone["confidence"] }) {
  if (confidence === "verified") return <Badge tone="green">✓ verified</Badge>;
  if (confidence === "unverified") return <Badge tone="coral">unverified</Badge>;
  return <Badge tone="sand">probable</Badge>;
}

/** Which terra-draw draw mode is armed, if any. */
type DrawKind = "polygon" | "linestring";

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

export function MapZoneEditor({
  initialZones,
  deletedSeedZones = [],
  mediaLibrary,
}: {
  initialZones: MapZone[];
  /** Seed lots hidden by a tombstone — restorable, see the page comment. */
  deletedSeedZones?: MapZone[];
  mediaLibrary: MediaItem[];
}) {
  const router = useRouter();

  const [zones, setZones] = useState<MapZone[]>(initialZones);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [drawing, setDrawing] = useState<DrawKind | null>(null);
  const [saving, setSaving] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<typeof import("maplibre-gl") | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const markersRef = useRef(new Map<string, MapLibreMarker>());
  const hoverChipRef = useRef<HTMLDivElement | null>(null);
  // True while WE mutate the draw store (add/remove/select) — terra-draw fires
  // the same change events for API and user edits, and only user edits may
  // mark the draft dirty.
  const suppressRef = useRef(false);
  // Ids drawn in this session but never saved — deleting them skips the API.
  const unsavedIdsRef = useRef(new Set<string>());

  // Mirrors for map-event callbacks (created once, must see current state).
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  const selectRef = useRef<(id: string) => void>(() => {});

  /* ---------------- Port bay nudge (E34) ----------------
   *
   * Kept entirely separate from `draft`/`dirty`/`save`, which belong to the
   * MapZone and POST to /api/admin/parking. The nudge is a different record in
   * a different store with its own endpoint, so it gets its own dirty flag and
   * its own Save. That is not fussiness: it means adjusting bays can never
   * round-trip a MapZone through the parking whitelist, which is where fields
   * go to be silently wiped.
   *
   * Bays themselves are static — fetched once per mount, exactly like the
   * sibling CMS editor's street geometry — because only the four nudge numbers
   * are editable here. */
  const bayFeaturesRef = useRef<BayFeature[] | null>(null);
  const [bayZones, setBayZones] = useState<Set<string>>(new Set());
  /** Which bay group the sliders act on. Independent of the zone sidebar so a
   *  group whose MapZone was deleted is still reachable. */
  const [bayGroup, setBayGroup] = useState<string | null>(null);
  const bayGroupRef = useRef(bayGroup);
  bayGroupRef.current = bayGroup;
  const [nudge, setNudge] = useState<BayTransform>(IDENTITY_BAY_TRANSFORM);
  const [nudgeDirty, setNudgeDirty] = useState(false);
  const [nudgeSaving, setNudgeSaving] = useState(false);
  /** Ids restored in this session — hides the row without a full reload. */
  const [restored, setRestored] = useState<Set<string>>(new Set());
  /** Saved nudges by zone id, so switching zones restores the stored value. */
  const savedNudgesRef = useRef<Record<string, BayTransform>>({});
  const nudgeRef = useRef(nudge);
  nudgeRef.current = nudge;

  /** Run a programmatic draw-store mutation without tripping dirty tracking. */
  function withStoreOps<T>(fn: () => T): T {
    suppressRef.current = true;
    try {
      return fn();
    } finally {
      suppressRef.current = false;
    }
  }

  /* ---------------- imperative layer management ---------------- */

  /**
   * PREVIEW of the curb strokes as /parking will actually draw them.
   *
   * Was a plain dashed copy of the centre line, back when street geometry was
   * read-only reference. Now that centre lines are drawn and dragged here, the
   * useful thing to show underneath is the OUTPUT: the same `line-offset` sign
   * math the public map runs (`curbOffsetSigns`), so picking "east side" moves
   * a visible stroke onto the east curb instead of changing a dropdown and
   * hoping. Choosing a side that runs parallel to the street is ill-defined and
   * falls back to the centre line — that shows up here as a stroke that simply
   * does not move, which is the honest signal that the answer is unknown.
   *
   * Read-only: the editable line is terra-draw's, above this.
   */
  function streetUnderlayData(): GeoJSON.FeatureCollection {
    return {
      type: "FeatureCollection",
      features: zonesRef.current.flatMap((z) => {
        // The SELECTED zone previews the unsaved dropdown value, so picking a
        // side moves the stroke immediately — that live answer is the whole
        // point of the preview. Colour deliberately stays the SAVED rule: the
        // editable centre line above is drawn from the saved rule too, and
        // recolouring only one of the pair reads as a rendering bug.
        const d = z.id === selectedIdRef.current ? draftRef.current : null;
        const curb = d ? (d.curb === "" ? undefined : d.curb) : z.curb;
        return (z.streetPaths ?? []).flatMap((path) =>
          curbOffsetSigns(path, curb).map((offsetSign) => ({
            type: "Feature" as const,
            properties: { color: ruleColor(z.rule), offsetSign },
            geometry: {
              type: "LineString" as const,
              coordinates: toGeoJsonPath(path),
            },
          })),
        );
      }),
    };
  }

  function refreshStreetUnderlay() {
    const map = mapRef.current;
    const src = map?.getSource("pe-streets") as
      | { setData: (d: GeoJSON.FeatureCollection) => void }
      | undefined;
    src?.setData(streetUnderlayData());
  }

  /**
   * EVERY bay, with the group being nudged flagged as `active`.
   *
   * All of them, not just the selected zone's. The first cut drew only the
   * selected zone's bays and it was wrong twice over: the admin could not see
   * the bay layer at all until they happened to select a zone that had one, and
   * — the real defect — bay groups whose MapZone the Chamber has DELETED
   * (port-pokpark-north-rows, port-free-2hr-row, port-15min-dropoff, 79 bays
   * between them) were unreachable forever, because there was no row left in
   * the sidebar to select. They still draw on the public map. Something visible
   * to a visitor and unreachable by an admin is the one outcome the nudge
   * controls existed to prevent.
   *
   * Reads `nudgeRef`, so the active group shows the UNSAVED value.
   */
  function bayPreviewData(): GeoJSON.FeatureCollection {
    const all = bayFeaturesRef.current;
    if (!all) return { type: "FeatureCollection", features: [] };
    const active = bayGroupRef.current;
    const t = clampBayTransform(nudgeRef.current);
    const byGroup = new Map<string, BayFeature[]>();
    for (const b of all) {
      const g = byGroup.get(b.properties.zone);
      if (g) g.push(b);
      else byGroup.set(b.properties.zone, [b]);
    }
    const feats: GeoJSON.Feature[] = [];
    for (const [zone, bays] of byGroup) {
      const isActive = zone === active;
      // Saved nudges are applied to the inactive groups too, so what the admin
      // sees here matches what /parking renders. Only the active group takes
      // the live, unsaved value.
      const applied = isActive ? t : savedNudgesRef.current[zone];
      const pivot = applied
        ? bayPivot(bays.flatMap((b) => b.geometry.coordinates[0]))
        : null;
      for (const b of bays) {
        const ring = b.geometry.coordinates[0];
        feats.push({
          type: "Feature",
          properties: { active: isActive },
          geometry: {
            type: "Polygon",
            coordinates: [
              pivot && applied ? transformRing(ring, pivot, applied) : ring,
            ],
          },
        } as GeoJSON.Feature);
      }
    }
    return { type: "FeatureCollection", features: feats };
  }

  function refreshBayPreview() {
    const map = mapRef.current;
    const src = map?.getSource("pe-bays") as
      | { setData: (d: GeoJSON.FeatureCollection) => void }
      | undefined;
    src?.setData(bayPreviewData());
  }

  function pinEl(zone: MapZone, selected: boolean): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.className = selected ? "pe-pin pe-pin--selected" : "pe-pin";
    const dot = document.createElement("span");
    dot.className = "pe-dot";
    dot.style.background = ruleColor(zone.rule);
    const tip = document.createElement("span");
    tip.className = "pe-tip";
    tip.textContent = zone.name; // textContent — no HTML, no XSS
    wrap.append(dot, tip);
    wrap.addEventListener("click", (ev) => {
      ev.stopPropagation(); // don't also run the map's hit-test click
      selectRef.current(zone.id);
    });
    return wrap;
  }

  function addZoneToMap(zone: MapZone) {
    const maplibregl = maplibreRef.current;
    const map = mapRef.current;
    const draw = drawRef.current;
    if (!maplibregl || !map || !draw) return;

    const marker = new maplibregl.Marker({ element: pinEl(zone, false), anchor: "center" })
      .setLngLat([zone.center[1], zone.center[0]])
      .addTo(map);
    marker.on("dragend", () => setDirty(true));
    markersRef.current.set(zone.id, marker);

    const features = zoneDrawFeatures(zone);
    if (features.length > 0) {
      const results = withStoreOps(() => draw.addFeatures(features));
      // A rejected add means the geometry silently won't render or edit here —
      // surface it for diagnosis instead of swallowing the validation result.
      for (const r of results) {
        if (!r.valid) console.warn(`map editor: zone "${zone.id}" not editable — ${r.reason}`);
      }
    }
  }

  /** Every draw-store id belonging to a zone: the zone id itself (polygon) plus
   *  any `id~n` path features. Read from the STORE rather than from the zone
   *  record so a removal still finds stale features after a path count change. */
  function drawIdsForZone(id: string): string[] {
    const draw = drawRef.current;
    if (!draw) return [];
    return draw
      .getSnapshot()
      .map((f) => String(f.id))
      .filter((fid) => fid === id || zoneIdOfFeature(fid) === id);
  }

  function removeZoneFromMap(id: string) {
    const draw = drawRef.current;
    const ids = drawIdsForZone(id);
    if (draw && ids.length) withStoreOps(() => draw.removeFeatures(ids));
    markersRef.current.get(id)?.remove();
    markersRef.current.delete(id);
  }

  function setEditing(id: string, zone: MapZone, on: boolean) {
    const draw = drawRef.current;
    // Terra-draw selects ONE feature at a time, so a multi-path street zone
    // hands its handles to the first path. The others stay drawn and are still
    // read back verbatim on save — only their vertices aren't draggable.
    const target = zoneDrawFeatures(zone)[0]?.id;
    if (draw && target != null && draw.hasFeature(target)) {
      withStoreOps(() =>
        on ? draw.selectFeature(target) : draw.deselectFeature(target),
      );
    }
    const marker = markersRef.current.get(id);
    if (marker) {
      marker.getElement().classList.toggle("pe-pin--selected", on);
      marker.setDraggable(on);
    }
  }

  /* ---------------- selection ---------------- */

  function select(id: string) {
    const prev = selectedIdRef.current;
    if (prev === id) return;
    if (
      dirtyRef.current &&
      !window.confirm("Discard unsaved changes to the current zone?")
    ) {
      return;
    }
    // A single terra-draw mode runs at a time: selecting disarms an armed draw.
    if (drawingRef.current) {
      drawRef.current?.setMode("select");
      setDrawing(null);
    }
    if (prev) {
      const prevZone = zonesRef.current.find((z) => z.id === prev);
      if (prevZone) setEditing(prev, prevZone, false);
    }

    const zone = zonesRef.current.find((z) => z.id === id);
    if (!zone) return;
    setSelectedId(id);
    // Eager mirror sync: same-tick callers (map events, rebuild paths) must
    // see the new selection before React re-renders.
    selectedIdRef.current = id;
    setDraft(toDraft(zone));
    setDirty(false);
    setMessage(null);

    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (map && maplibregl) {
      // Frame whatever geometry the zone actually has — a street zone has no
      // polygon, and easing to its centre pin would leave most of the line off
      // screen on a long street.
      const framePts: [number, number][] =
        zone.streetPaths?.length
          ? zone.streetPaths.flat()
          : zone.polygon && zone.polygon.length >= 3
            ? zone.polygon
            : [];
      if (framePts.length > 0) {
        const first: [number, number] = [framePts[0][1], framePts[0][0]];
        const bounds = new maplibregl.LngLatBounds(first, first);
        for (const p of framePts) bounds.extend([p[1], p[0]]);
        map.fitBounds(bounds, { padding: 60, maxZoom: MAX_ZOOM });
      } else {
        map.easeTo({
          center: [zone.center[1], zone.center[0]],
          zoom: Math.max(map.getZoom(), START_ZOOM),
        });
      }
      setEditing(id, zone, true);
    }
  }
  selectRef.current = select;

  function deselect() {
    const prev = selectedIdRef.current;
    if (prev) {
      const prevZone = zonesRef.current.find((z) => z.id === prev);
      if (prevZone) setEditing(prev, prevZone, false);
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
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: mapStyle(pmtilesUrl(TILES_PMTILES_PATH)),
        center: START_CENTER,
        zoom: START_ZOOM,
        maxZoom: MAX_ZOOM,
      });
      mapRef.current = map;
      // Leaflet showed +/- buttons by default; MapLibre needs them explicitly.
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", () => {
        if (cancelled || mapRef.current !== map) return;

        const {
          TerraDraw: TerraDrawCtor,
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
            new TerraDrawPolygonMode({
              validation: (feature, { updateType }) =>
                updateType === "finish" || updateType === "commit"
                  ? ValidateNotSelfIntersecting(feature)
                  : { valid: true },
              styles: {
                fillColor: featureRuleColor,
                fillOpacity: 0.3,
                outlineColor: featureRuleColor,
                outlineWidth: 2,
                closingPointColor: "#ffffff",
                closingPointOutlineColor: "#16405e",
                closingPointOutlineWidth: 2,
              },
            }),
            // Curb centre lines. NO self-intersection validation, unlike
            // polygons: a street that doubles back on itself (a loop road, a
            // cul-de-sac approach) is a real shape, and rejecting it would
            // block honest geometry. `line-offset` handles it fine.
            new TerraDrawLineStringMode({
              styles: {
                lineStringColor: featureRuleColor,
                lineStringWidth: 4,
                closingPointColor: "#ffffff",
                closingPointOutlineColor: "#16405e",
                closingPointOutlineWidth: 2,
              },
            }),
            new TerraDrawSelectMode({
              // Selection is driven by the app (sidebar + hit-test click), so
              // the dirty-discard confirm stays authoritative.
              allowManualSelection: false,
              allowManualDeselection: false,
              keyEvents: { deselect: null, delete: null, rotate: null, scale: null },
              flags: {
                polygon: {
                  feature: {
                    draggable: false, // zones reshape; they don't slide whole
                    selfIntersectable: false,
                    coordinates: { midpoints: true, draggable: true, deletable: true },
                  },
                },
                // Same handle set as polygons so the two feel identical:
                // drag a vertex, click a midpoint to add one, right-click to
                // remove. `draggable: false` for the same reason — a street
                // line is re-traced, never slid wholesale off its street.
                linestring: {
                  feature: {
                    draggable: false,
                    coordinates: { midpoints: true, draggable: true, deletable: true },
                  },
                },
              },
              styles: {
                selectedPolygonColor: featureRuleColor,
                selectedPolygonFillOpacity: 0.5,
                selectedPolygonOutlineColor: featureRuleColor,
                selectedPolygonOutlineWidth: 3,
                selectionPointColor: "#ffffff",
                selectionPointOutlineColor: "#16405e",
                selectionPointOutlineWidth: 2,
                selectionPointWidth: 6,
                midPointColor: "#ffffff",
                midPointOutlineColor: "#16405e",
                midPointWidth: 4,
                selectedLineStringColor: featureRuleColor,
                selectedLineStringWidth: 5,
              },
            }),
          ],
        });
        draw.start();
        draw.setMode("select");
        drawRef.current = draw;
        // Test-only hook: the server-tier spec must be able to prove features
        // actually entered the draw store (its no-touch round-trip would pass
        // vacuously via buildZone's stored-geometry fallback otherwise). Inert
        // unless the spec set the flag before load.
        if ((window as unknown as { __vkTestHooks?: boolean }).__vkTestHooks) {
          (window as unknown as { __vkDraw?: unknown }).__vkDraw = draw;
        }

        draw.on("finish", (finishedId, context) => {
          if (
            (context.mode === "polygon" || context.mode === "linestring") &&
            context.action === "draw"
          ) {
            handleDrawnRef.current(String(finishedId));
            return;
          }
          // Vertex or midpoint drag finished on the selected zone.
          if (context.action === "dragCoordinate" || context.action === "dragFeature") {
            setDirty(true);
          }
        });
        // Geometry edits that don't end in a drag (right-click vertex delete,
        // midpoint insert) — user-driven updates to the selected zone only.
        draw.on("change", (ids, type, context) => {
          if (suppressRef.current || type !== "update") return;
          if (context && "origin" in context && context.origin === "api") return;
          if (context?.target === "properties") return;
          const sel = selectedIdRef.current;
          // zoneIdOfFeature, not a bare compare: a street zone's edits arrive
          // under `id~n`, and comparing raw ids would leave curb-line drags
          // silently un-dirty — the Save button would stay disabled on a real
          // change.
          if (sel && ids.some((i) => zoneIdOfFeature(String(i)) === sel)) setDirty(true);
        });

        // Click-to-select via hit-test (manual selection is disabled above).
        map.on("click", (e) => {
          const d = drawRef.current;
          if (!d || drawingRef.current) return;
          const hit = d
            .getFeaturesAtLngLat(e.lngLat, {
              ignoreSelectFeatures: false,
              ignoreCoordinatePoints: true,
              ignoreClosingPoints: true,
              ignoreSnappingPoints: true,
            })
            .find(isZoneFeature);
          // The hit may be a `id~n` path feature — select its ZONE.
          if (hit?.id != null) selectRef.current(zoneIdOfFeature(String(hit.id)));
        });

        // Hover: name chip + pointer cursor over zone polygons (the Leaflet
        // sticky tooltip's replacement).
        const chip = document.createElement("div");
        chip.className = "pe-hover";
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
              ignoreSelectFeatures: false,
              ignoreCoordinatePoints: true,
              ignoreClosingPoints: true,
              ignoreSnappingPoints: true,
            })
            .find(isZoneFeature);
          const hitZoneId = hit ? zoneIdOfFeature(String(hit.id)) : undefined;
          const zone = hitZoneId ? zonesRef.current.find((z) => z.id === hitZoneId) : undefined;
          if (zone) {
            chip.textContent = zone.name;
            chip.style.display = "block";
            chip.style.left = `${e.point.x + 12}px`;
            chip.style.top = `${e.point.y + 12}px`;
            map.getCanvas().style.cursor = "pointer";
          } else {
            chip.style.display = "none";
            map.getCanvas().style.cursor = "";
          }
        });

        // Bay preview, added BEFORE pe-streets so curb strokes and the
        // terra-draw handles both stay on top of it — the bays are the thing
        // being aimed, not the thing being grabbed.
        map.addSource("pe-bays", { type: "geojson", data: bayPreviewData() });
        // Two tiers: every group is drawn so the layer is never invisible, but
        // the one being nudged is solid and the rest recede — otherwise 302
        // bays bury the row the admin is actually aiming.
        map.addLayer({
          id: "pe-bays",
          type: "fill",
          source: "pe-bays",
          paint: {
            "fill-color": BAY_PREVIEW_COLOR,
            "fill-opacity": ["case", ["get", "active"], 0.6, 0.18],
          },
        });
        map.addLayer({
          id: "pe-bays-line",
          type: "line",
          source: "pe-bays",
          paint: {
            "line-color": "#ffffff",
            "line-width": ["case", ["get", "active"], 0.8, 0.4],
            "line-opacity": ["case", ["get", "active"], 0.75, 0.35],
          },
        });

        map.addSource("pe-streets", { type: "geojson", data: streetUnderlayData() });
        map.addLayer({
          id: "pe-streets",
          type: "line",
          source: "pe-streets",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["get", "color"],
            // Wider and softer than terra-draw's editable centre line so the
            // two read as what they are: this is the published curb stroke,
            // that is the handle you drag.
            "line-width": ["interpolate", ["linear"], ["zoom"], 13, 4, 16, 6, 18, 9],
            "line-opacity": 0.45,
            // The SAME data-driven sign × zoom-driven magnitude the public map
            // uses (feature-map.tsx `curbOffset`). Kept numerically identical
            // on purpose — an editor preview that offsets by a different amount
            // would teach the admin the wrong thing about where the stroke lands.
            "line-offset": [
              "interpolate",
              ["linear"],
              ["zoom"],
              13,
              ["*", ["get", "offsetSign"], 1.5],
              16,
              ["*", ["get", "offsetSign"], 4.5],
              18,
              ["*", ["get", "offsetSign"], 10],
            ],
          },
        });

        for (const zone of zonesRef.current) addZoneToMap(zone);
        setMapReady(true);
      });

      requestAnimationFrame(() => mapRef.current?.resize());
    })();

    return () => {
      cancelled = true;
      try {
        drawRef.current?.stop();
      } catch {
        // stop() throws if the adapter never registered — nothing to undo
      }
      drawRef.current = null;
      for (const m of markersRef.current.values()) m.remove();
      markersRef.current.clear();
      hoverChipRef.current?.remove();
      hoverChipRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Zones are managed imperatively after mount; re-running would tear the
    // map down mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the curb preview honest while the dropdown moves. Runs after the
  // render that updated draftRef, which is why it cannot live inside
  // patchDraft — that would read the previous draft.
  useEffect(() => {
    refreshStreetUnderlay();
    // refreshStreetUnderlay reads refs, not props; re-running it on these keys
    // is the whole intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.curb, selectedId, zones]);

  // Load the generated bays and any saved nudges, once per mount. Both are
  // progressive enhancement: a failure here hides the nudge panel and leaves
  // every other editor function working.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [baysRes, tRes] = await Promise.all([
          fetch("/geo/port-stalls.json"),
          fetch("/api/admin/bay-transform"),
        ]);
        if (cancelled) return;
        if (baysRes.ok) {
          const data = (await baysRes.json()) as { features: BayFeature[] };
          const feats = (data.features ?? []).filter(
            (f) => f?.geometry?.type === "Polygon" && f.properties?.zone,
          );
          bayFeaturesRef.current = feats;
          if (!cancelled) setBayZones(new Set(feats.map((f) => f.properties.zone)));
        }
        if (tRes.ok) {
          const data = (await tRes.json()) as { transforms?: Record<string, BayTransform> };
          savedNudgesRef.current = data.transforms ?? {};
          const id = selectedIdRef.current;
          if (id && !cancelled) {
            setNudge(savedNudgesRef.current[id] ?? IDENTITY_BAY_TRANSFORM);
          }
        }
        if (!cancelled) refreshBayPreview();
      } catch {
        // No bays and no nudge panel; the rest of the editor is unaffected.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Static per mount, exactly like the sibling editor's street geometry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Selecting a zone that HAS bays follows through to that bay group — the
  // common case, and it keeps the two selections feeling like one. Selecting a
  // zone with no bays leaves the picker alone rather than blanking it.
  useEffect(() => {
    if (selectedId && bayZones.has(selectedId)) setBayGroup(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, bayZones]);

  // Switching bay groups loads that group's saved nudge and drops any unsaved
  // edit — an offset means nothing once a different group is being aimed.
  useEffect(() => {
    setNudge(
      (bayGroup && savedNudgesRef.current[bayGroup]) || IDENTITY_BAY_TRANSFORM,
    );
    setNudgeDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bayGroup]);

  // Redraw the preview after the render that updated nudgeRef — same reason the
  // curb preview cannot live inside patchDraft.
  useEffect(() => {
    refreshBayPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nudge, bayGroup, selectedId, mapReady, bayZones]);

  /* ---------------- draw new zone ---------------- */

  const handleDrawnRef = useRef<(tdId: string) => void>(() => {});
  handleDrawnRef.current = (tdId: string) => {
    const map = mapRef.current;
    const draw = drawRef.current;
    setDrawing(null);
    if (!draw) return;
    draw.setMode("select");

    const feat = draw.getSnapshotFeature(tdId);
    // Re-added under the zone's own id via addZoneToMap so wiring is uniform.
    withStoreOps(() => draw.removeFeatures([tdId]));
    if (!feat || !map) return;

    let zone: MapZone | null = null;
    if (feat.geometry.type === "Polygon") {
      const polygon = toStoredRing(feat.geometry.coordinates[0]);
      if (polygon.length < 3) return;
      zone = {
        id: `zone-${Math.random().toString(36).slice(2, 8)}`,
        name: "New zone",
        rule: "paid",
        summary: "",
        details: "",
        confidence: "probable",
        overnight: "confirm-first",
        center: centroidOf(polygon),
        polygon,
      };
    } else if (feat.geometry.type === "LineString") {
      const path = toStoredPath(feat.geometry.coordinates as number[][]);
      if (path.length < 2) return;
      zone = {
        id: `street-${Math.random().toString(36).slice(2, 8)}`,
        name: "New street",
        // free-2hr, not the polygon default of `paid`: a drawn curb line is
        // almost always a residential street, and downtown Kingston's streets
        // are overwhelmingly free 2-hour. It is one dropdown to change.
        rule: "free-2hr",
        summary: "",
        details: "",
        // The whole reason to draw one by hand is standing in front of it, but
        // "probable" is still the honest default — the admin flips it with the
        // field-verified button once they have actually checked the signs.
        confidence: "probable",
        overnight: "confirm-first",
        center: pathMidpoint(path),
        streetPaths: [path],
        // curb deliberately UNSET: a freshly traced centre line claims nothing
        // about which side the rule covers until someone says so.
      };
    }
    if (!zone) return;
    const id = zone.id;
    unsavedIdsRef.current.add(id);
    zonesRef.current = [...zonesRef.current, zone];
    setZones(zonesRef.current);
    addZoneToMap(zone);
    const before = selectedIdRef.current;
    select(id);
    if (selectedIdRef.current === before) {
      // The dirty-discard confirm was declined: hand the editing handles back
      // to the still-selected zone (arming the draw had dropped them).
      const prev = before ? zonesRef.current.find((z) => z.id === before) : undefined;
      if (before && prev) setEditing(before, prev, true);
      return;
    }
    setDirty(true);
    setMessage({
      kind: "ok",
      text: zone.streetPaths
        ? "Line drawn — name it, set the rule, pick the curb side, then Save to publish."
        : "Shape drawn — name it, set the rule, then Save to publish.",
    });
  };

  /** Arm (or disarm) one of the two draw modes. Pressing the armed one again
   *  cancels; pressing the other switches, since only one mode runs at a time. */
  function armDraw(kind: DrawKind) {
    const draw = drawRef.current;
    if (!draw) return;
    if (drawing === kind) {
      draw.setMode("select");
      setDrawing(null);
      // Arming the draw dropped the zone's draw-selection — hand it back.
      const sel = selectedIdRef.current;
      const zone = sel ? zonesRef.current.find((z) => z.id === sel) : undefined;
      if (sel && zone) setEditing(sel, zone, true);
      return;
    }
    draw.setMode(kind);
    setDrawing(kind);
    setMessage({
      kind: "ok",
      text:
        kind === "polygon"
          ? "Click the map to place corners; click the first corner again to finish."
          : "Click along the middle of the street; click the last point again to finish. Switch the base map to Satellite to trace the real kerb line.",
    });
  }

  /* ---------------- draft & persistence ---------------- */

  function patchDraft(patch: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
    setMessage(null);
  }

  /** The draft zone with geometry read back from the draw store + pin. */
  function buildZone(): MapZone | null {
    if (!draft || !selectedId) return null;
    const zone = zonesRef.current.find((z) => z.id === selectedId);
    if (!zone) return null;

    const draw = drawRef.current;

    let polygon = zone.polygon;
    const feat = draw?.getSnapshotFeature(selectedId);
    if (feat && feat.geometry.type === "Polygon") {
      polygon = toStoredRing(feat.geometry.coordinates[0]);
    }

    /**
     * Street geometry, read back from every `id~n` feature in INDEX ORDER.
     *
     * This must run for multi-path zones too, not just the selected path: the
     * API rebuilds the zone from a field whitelist, so whatever this returns is
     * the whole truth about the zone's lines afterwards. Sending back only the
     * edited path would delete the others.
     *
     * The fallback to the stored value is what makes the whole thing safe: if
     * the draw store has nothing (features rejected, style not loaded yet), the
     * zone keeps the geometry it came in with rather than losing it. A SEED
     * zone would survive that anyway — parking-store's withSeedStreetGeometry
     * merges the seed's paths back on read — but a street zone drawn here has
     * no seed, so for those the fallback is the only protection there is.
     */
    const streetPaths =
      (draw && streetPathsFromFeatures(selectedId, draw.getSnapshot())) ??
      zone.streetPaths;

    const marker = markersRef.current.get(selectedId);
    const center: [number, number] = marker
      ? [r6(marker.getLngLat().lat), r6(marker.getLngLat().lng)]
      : zone.center;

    return {
      ...zone,
      name: draft.name.trim(),
      rule: draft.rule,
      summary: draft.summary.trim(),
      details: draft.details.trim(),
      overnight: draft.overnight,
      confidence: draft.confidence,
      // Explicit so CLEARING the side persists: undefined is dropped by
      // JSON.stringify, and the API rebuild then omits curb entirely.
      curb: draft.curb === "" ? undefined : draft.curb,
      // Explicit for the same reason as curb above: REMOVING every photo has to
      // persist, and `undefined` is dropped by JSON.stringify — the API would
      // then rebuild the zone from the whitelist without images and the old
      // ones would quietly come back on the next read.
      images: draft.images.length ? draft.images : undefined,
      // Same whitelist rule as streetPaths above: omitting this deletes the
      // lot's payment hand-off, including on a save that only moved a shape.
      // ALWAYS the array, never undefined — an emptied list must persist as []
      // so parking-store's withSeedPay() reads it as "the admin cleared this"
      // rather than "this record predates the field" and restores the seed.
      pay: draft.pay,
      center,
      ...(polygon ? { polygon } : {}),
      // MUST be sent: the API rebuilds from a whitelist, so omitting this drops
      // the lines. A seed zone would be rescued on read by
      // withSeedStreetGeometry; a street zone drawn in this editor would not.
      ...(streetPaths?.length ? { streetPaths } : {}),
    };
  }

  /** Edit one hand-off in place, leaving the others alone. */
  function patchPay(index: number, patch: Partial<PayHandoff>) {
    const next = draftRef.current?.pay.map((p, i) =>
      i === index ? { ...p, ...patch } : p,
    );
    if (next) patchDraft({ pay: next });
  }

  function patchNudge(patch: Partial<BayTransform>) {
    setNudge((n) => clampBayTransform({ ...n, ...patch }));
    setNudgeDirty(true);
    setMessage(null);
  }

  /**
   * Persist the selected zone's bay nudge.
   *
   * Its own endpoint and its own store — this never touches the MapZone, so it
   * cannot be undone by a later zone save, and a zone save cannot undo it.
   */
  /**
   * Bring a deleted seed lot back.
   *
   * Writes the SEED document through the ordinary admin save, which upserts
   * with `deleted: false` and audits as a normal edit. No new endpoint and no
   * un-delete primitive — the tombstone is simply overwritten by real content.
   */
  async function restoreZone(zone: MapZone) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/parking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(zone),
      });
      const data = (await res.json()) as { zone?: MapZone; error?: string };
      if (!res.ok || !data.zone) {
        setMessage({ kind: "error", text: data.error ?? "Could not restore that lot." });
        return;
      }
      setZones((zs) => [...zs, data.zone!].sort((a, b) => a.name.localeCompare(b.name)));
      setRestored((r) => new Set(r).add(zone.id));
      setMessage({
        kind: "ok",
        text: `Restored "${zone.name}" — live on /parking within a minute.`,
      });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server — is the app running?" });
    } finally {
      setSaving(false);
    }
  }

  async function saveNudge() {
    // The bay GROUP, not the selected zone — they are usually the same, but a
    // group whose lot was deleted has no selected zone to borrow an id from.
    const id = bayGroupRef.current;
    if (!id) return;
    setNudgeSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/bay-transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...clampBayTransform(nudgeRef.current) }),
      });
      const data = (await res.json()) as { transform?: BayTransform; error?: string };
      if (!res.ok || !data.transform) {
        setMessage({ kind: "error", text: data.error ?? "Could not save the bay position." });
        return;
      }
      // Store what the SERVER returned, not what we sent: it has been clamped
      // and rounded, and the panel should show the value that actually persisted.
      savedNudgesRef.current[id] = data.transform;
      setNudge(data.transform);
      setNudgeDirty(false);
      setMessage({
        kind: "ok",
        text: isIdentityBayTransform(data.transform)
          ? "Bays reset to their generated position."
          : "Bay position saved — live on /parking within a minute.",
      });
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server — is the app running?" });
    } finally {
      setNudgeSaving(false);
    }
  }

  async function save() {
    const zone = buildZone();
    if (!zone) return;
    if (!zone.name) {
      setMessage({ kind: "error", text: "The zone needs a name." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/parking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(zone),
      });
      const data = (await res.json()) as { ok?: boolean; zone?: MapZone; error?: string };
      if (!res.ok || !data.ok || !data.zone) {
        setMessage({ kind: "error", text: data.error ?? "Could not save the zone." });
        return;
      }
      const saved = data.zone;
      unsavedIdsRef.current.delete(saved.id);
      zonesRef.current = zonesRef.current.map((z) => (z.id === saved.id ? saved : z));
      setZones(zonesRef.current);

      // Rebuild the zone's pin + draw feature so color, tooltip, and geometry
      // all reflect the saved record, then hand the editing handles straight
      // back.
      removeZoneFromMap(saved.id);
      addZoneToMap(saved);
      setEditing(saved.id, saved, true);
      refreshStreetUnderlay(); // rule recolor / curb change on a street zone

      setDraft(toDraft(saved));
      setDirty(false);
      setMessage({ kind: "ok", text: "Saved — live on /parking within a minute." });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server — is the app running?" });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!selectedId) return;
    const zone = zonesRef.current.find((z) => z.id === selectedId);
    if (!zone) return;
    if (
      !window.confirm(
        `Delete "${zone.name}" from the map? It disappears from /parking (seed zones stay hidden, not erased).`,
      )
    ) {
      return;
    }

    const wasUnsaved = unsavedIdsRef.current.has(selectedId);
    if (!wasUnsaved) {
      setSaving(true);
      setMessage(null);
      try {
        const res = await fetch(
          `/api/admin/parking?id=${encodeURIComponent(selectedId)}`,
          { method: "DELETE" },
        );
        // 404 = drawn elsewhere but never saved — safe to drop locally.
        if (!res.ok && res.status !== 404) {
          const data = (await res.json()) as { error?: string };
          setMessage({ kind: "error", text: data.error ?? "Could not delete the zone." });
          return;
        }
      } catch {
        setMessage({ kind: "error", text: "Could not reach the server — is the app running?" });
        return;
      } finally {
        setSaving(false);
      }
    }

    const id = selectedId;
    deselect();
    removeZoneFromMap(id);
    unsavedIdsRef.current.delete(id);
    zonesRef.current = zonesRef.current.filter((z) => z.id !== id);
    setZones(zonesRef.current);
    setMessage({ kind: "ok", text: `Deleted "${zone.name}".` });
    router.refresh();
  }

  /* ---------------- render ---------------- */

  const selectedZone = selectedId ? zones.find((z) => z.id === selectedId) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[290px_1fr]">
      <style>{PIN_CSS}</style>
      {/* Sidebar: zone list */}
      <div className="flex flex-col gap-3">
        {/* Two shapes, two buttons: a LOT is an area you outline, a STREET is a
            line you trace down the middle. They produce different geometry
            (`polygon` vs `streetPaths`) and the public map renders them
            differently — a fill versus curb-hugging strokes — so the choice
            belongs here rather than in a mode buried behind one button. */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => armDraw("polygon")}
            disabled={!mapReady}
            className={`min-h-[44px] rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
              drawing === "polygon"
                ? "border border-coral bg-coral/10 text-coral-deep"
                : "bg-sound text-white hover:bg-sound-deep"
            }`}
          >
            {drawing === "polygon" ? "✕ Cancel drawing" : "✎ Draw new lot"}
          </button>
          <button
            type="button"
            onClick={() => armDraw("linestring")}
            disabled={!mapReady}
            className={`min-h-[44px] rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
              drawing === "linestring"
                ? "border border-coral bg-coral/10 text-coral-deep"
                : "bg-sound text-white hover:bg-sound-deep"
            }`}
          >
            {drawing === "linestring" ? "✕ Cancel drawing" : "╱ Draw new street line"}
          </button>
          <p className="px-1 text-xs text-ink-soft">
            A <span className="font-semibold">lot</span> is an area you outline. A{" "}
            <span className="font-semibold">street line</span> is traced down the middle of
            the road — the map then draws the colour against the kerb you pick.
          </p>
        </div>

        <ul className="max-h-[560px] divide-y divide-sand overflow-y-auto rounded-2xl border border-sand bg-white">
          {zones.map((zone) => (
            <li key={zone.id}>
              <button
                type="button"
                onClick={() => select(zone.id)}
                className={`flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-shell ${
                  zone.id === selectedId ? "bg-tide/10" : ""
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                    style={{ backgroundColor: ruleColor(zone.rule) }}
                  />
                  <span className="text-sm font-medium text-ink">{zone.name}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5 pl-4.5">
                  <span className="text-xs text-ink-soft">{RULE_LABELS[zone.rule]}</span>
                  <ConfidenceBadge confidence={zone.confidence} />
                  {unsavedIdsRef.current.has(zone.id) && <Badge tone="coral">not saved</Badge>}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {/* Deleted lots. A delete hides a seeded lot with no way back — the
            editor lists merged zones, and a tombstoned lot is not in that list.
            Restoring from /admin/audit does not work either: a delete stores
            only the id, so replaying it would resurrect an empty record. This
            re-saves the original, which overwrites the tombstone with real
            content and audits as an ordinary edit. */}
        {deletedSeedZones.filter((z) => !restored.has(z.id)).length > 0 && (
          <div className="mt-4 rounded-2xl border border-sand bg-shell/60 p-4">
            <p className="text-sm font-medium text-ink">Deleted lots</p>
            <p className="mt-1 text-xs text-ink-soft">
              These came with the map and have been deleted. Their parking spaces may
              still be drawn for visitors, so restore any that were removed by mistake.
            </p>
            <ul className="mt-3 space-y-2">
              {deletedSeedZones
                .filter((z) => !restored.has(z.id))
                .map((zone) => (
                  <li key={zone.id} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 text-sm text-ink">
                      <span className="block truncate font-medium">{zone.name}</span>
                      <span className="block truncate text-xs text-ink-soft">
                        {RULE_LABELS[zone.rule]}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => restoreZone(zone)}
                      disabled={saving}
                      className="shrink-0 rounded-full border border-fern/40 bg-fern/10 px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-fern transition-colors hover:bg-fern/20 disabled:opacity-50"
                    >
                      Restore
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>

      {/* Map + fields */}
      <div className="flex flex-col gap-4">
        <BasemapSwitch getMap={() => mapRef.current} />
        <div
          ref={containerRef}
          style={{ height: "460px" }}
          className="relative z-0 w-full overflow-hidden rounded-2xl border border-sand"
          role="region"
          aria-label="Editable map of Kingston parking zones"
        />

        {!selectedZone && (
          <p className="text-sm text-ink-soft">
            Select a zone from the list or on the map to edit its shape and details — or
            draw a new one. Zones without an outline show only a draggable pin.
          </p>
        )}

        {selectedZone && draft && (
          <div className="rounded-2xl border border-sand bg-white p-5 shadow-[0_1px_3px_rgba(22,64,94,0.08)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-ink-soft">
                Editing <span className="font-mono">{selectedZone.id}</span> — drag the
                white corner handles to reshape; drag the colored pin to move the label
                point.
              </p>
              {dirty && (
                <Badge tone="coral">Unsaved changes — Save to publish, reload to discard</Badge>
              )}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_220px]">
              <Field label="Name">
                <input
                  className={INPUT}
                  value={draft.name}
                  onChange={(e) => patchDraft({ name: e.target.value })}
                />
              </Field>
              <Field label="Rule">
                <select
                  className={INPUT}
                  value={draft.rule}
                  onChange={(e) => patchDraft({ rule: e.target.value as ParkingRule })}
                >
                  {RULES.map((rule) => (
                    <option key={rule} value={rule}>
                      {RULE_LABELS[rule]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="mt-4">
              <Field label="Summary (one line — shown in map popups and card headers)">
                <textarea
                  className={INPUT}
                  rows={2}
                  value={draft.summary}
                  onChange={(e) => patchDraft({ summary: e.target.value })}
                />
              </Field>
            </div>

            <div className="mt-4">
              <Field label="Details (longer prose for the parking-page card)">
                <textarea
                  className={INPUT}
                  rows={4}
                  value={draft.details}
                  onChange={(e) => patchDraft({ details: e.target.value })}
                />
              </Field>
            </div>

            {selectedZone.streetPaths?.length ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Curb side (which side of the street the rule covers)">
                  <select
                    className={INPUT}
                    value={draft.curb}
                    onChange={(e) => patchDraft({ curb: e.target.value as CurbSide | "" })}
                  >
                    <option value="">Unknown — draw on the centre line</option>
                    {CURB_SIDES.map((s) => (
                      <option key={s} value={s}>
                        {CURB_OPTION_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </Field>
                <p className="self-end text-xs text-ink-soft">
                  The thin line is the street centre — drag its dots to re-trace it. The
                  thick soft line shows where the colour actually lands once you pick a
                  side. Pick a side only after checking the signs on the ground; leave it
                  Unknown and the map claims nothing.
                </p>
              </div>
            ) : null}

            {/* Payment hand-offs. The Port revises codes and Diamond reprices,
                and docs/PARKING-PAY-LINKS.md flags every value as
                verify-before-relying — so they have to be changeable here
                rather than in a deploy. */}
            <div className="mt-4 rounded-xl border border-sand bg-shell/60 p-4">
              <p className="text-sm font-medium text-ink">How people pay for this lot</p>
              <p className="mt-1 text-xs text-ink-soft">
                Leave this empty for free, permit and no-parking zones — a
                &ldquo;pay now&rdquo; button on a free lot tells a visitor they owe money
                for a space the Port gives away.
              </p>
              {draft.pay.map((p, i) => (
                <div key={i} className="mt-3 grid gap-2 sm:grid-cols-[150px_1fr_120px_auto]">
                  <select
                    className={INPUT}
                    value={p.vendor}
                    aria-label="Payment vendor"
                    onChange={(e) => patchPay(i, { vendor: e.target.value as PayVendor })}
                  >
                    <option value="t2">Text-to-pay</option>
                    <option value="parkmobile">ParkMobile</option>
                    <option value="paybyphone">PayByPhone</option>
                  </select>
                  <input
                    className={INPUT}
                    placeholder="Code (POKHILL / 97599515)"
                    aria-label="Payment code"
                    value={p.code}
                    onChange={(e) => patchPay(i, { code: e.target.value })}
                  />
                  {p.vendor === "t2" ? (
                    <input
                      className={INPUT}
                      placeholder="Text to (25023)"
                      aria-label="Short code"
                      value={p.shortCode ?? ""}
                      onChange={(e) => patchPay(i, { shortCode: e.target.value })}
                    />
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    aria-label="Remove this payment option"
                    onClick={() => patchDraft({ pay: draft.pay.filter((_, j) => j !== i) })}
                    className="self-center px-2 text-lg font-semibold text-coral-deep"
                  >
                    ✕
                  </button>
                  {/* What the visitor will see and what the button will open.
                      Shown before saving so a typo is caught here rather than
                      by somebody standing in the lot. */}
                  <p className="text-xs break-all text-ink-soft sm:col-span-4">
                    {payInstruction(p)} · opens{" "}
                    <code className="text-ink">{payHref(p)}</code>
                  </p>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  patchDraft({
                    pay: [
                      ...draft.pay,
                      { vendor: "t2", code: "", shortCode: PORT_SHORT_CODE },
                    ],
                  })
                }
                className="mt-3 text-sm font-semibold text-tide-deep underline"
              >
                ＋ Add a way to pay
              </button>
            </div>

            {/* Bay nudge (E34) — only for zones that actually have generated
                bays, so the panel never appears on a street or a park & ride. */}
            {bayZones.size > 0 ? (
              <div className="mt-4 rounded-xl border border-sand bg-shell/60 p-4">
                <p className="text-sm font-medium text-ink">Parking bay position</p>
                <p className="mt-1 text-xs text-ink-soft">
                  The individual spaces are drawn from the Port&apos;s map, fitted to the
                  lot outlines. If a row sits off the real spaces, move the whole set
                  here — the shapes stay rigid, so you are correcting the fit, not
                  redrawing stalls. Switch the basemap to satellite to aim them.
                </p>
                <div className="mt-3">
                  <Field label="Which set of spaces">
                    <select
                      className={INPUT}
                      value={bayGroup ?? ""}
                      onChange={(e) => setBayGroup(e.target.value || null)}
                    >
                      <option value="">Choose a set…</option>
                      {[...bayZones].sort().map((z) => (
                        <option key={z} value={z}>
                          {bayGroupLabel(z, bayFeaturesRef.current ?? [])}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {/* Listed independently of the sidebar on purpose: some sets
                      belong to lots that were deleted from the map, and there is
                      no row left to click — but their spaces still draw for
                      visitors, so they still have to be adjustable. */}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label={`East / west — ${nudge.dx > 0 ? `${nudge.dx} m east` : nudge.dx < 0 ? `${-nudge.dx} m west` : "centred"}`}>
                    <input
                      type="range"
                      className="w-full"
                      min={-BAY_TRANSFORM_LIMITS.offset}
                      max={BAY_TRANSFORM_LIMITS.offset}
                      step={0.5}
                      value={nudge.dx}
                      disabled={!bayGroup}
                      onChange={(e) => patchNudge({ dx: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label={`North / south — ${nudge.dy > 0 ? `${nudge.dy} m north` : nudge.dy < 0 ? `${-nudge.dy} m south` : "centred"}`}>
                    <input
                      type="range"
                      className="w-full"
                      min={-BAY_TRANSFORM_LIMITS.offset}
                      max={BAY_TRANSFORM_LIMITS.offset}
                      step={0.5}
                      value={nudge.dy}
                      disabled={!bayGroup}
                      onChange={(e) => patchNudge({ dy: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label={`Rotation — ${nudge.rotateDeg}°`}>
                    <input
                      type="range"
                      className="w-full"
                      min={-BAY_TRANSFORM_LIMITS.rotate}
                      max={BAY_TRANSFORM_LIMITS.rotate}
                      step={0.5}
                      value={nudge.rotateDeg}
                      disabled={!bayGroup}
                      onChange={(e) => patchNudge({ rotateDeg: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label={`Size — ${Math.round(nudge.scale * 100)}%`}>
                    <input
                      type="range"
                      className="w-full"
                      min={BAY_TRANSFORM_LIMITS.scaleMin}
                      max={BAY_TRANSFORM_LIMITS.scaleMax}
                      step={0.01}
                      value={nudge.scale}
                      disabled={!bayGroup}
                      onChange={(e) => patchNudge({ scale: Number(e.target.value) })}
                    />
                  </Field>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={saveNudge}
                    disabled={nudgeSaving || !nudgeDirty || !bayGroup}
                    className="rounded-full bg-sound px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sound-deep disabled:opacity-50"
                  >
                    {nudgeSaving ? "Saving…" : "Save bay position"}
                  </button>
                  <button
                    type="button"
                    onClick={() => patchNudge(IDENTITY_BAY_TRANSFORM)}
                    disabled={nudgeSaving || isIdentityBayTransform(nudge) || !bayGroup}
                    className="text-sm font-semibold text-tide-deep underline disabled:opacity-40"
                  >
                    Reset to generated
                  </button>
                  {nudgeDirty && (
                    <span className="text-xs text-ink-soft">Unsaved — the map above is the preview.</span>
                  )}
                </div>
              </div>
            ) : null}

            <div className="mt-4">
              <p className="text-sm font-medium text-ink">Photos of this lot</p>
              <p className="mb-2 mt-1 text-xs text-ink-soft">
                A photo of the pay station, the sign, or the entrance answers questions the
                map cannot — visitors see the first one in the map popup and all of them on
                the parking page. Upload under{" "}
                <a href="/admin/media" className="font-semibold text-tide-deep underline">
                  Photos
                </a>{" "}
                first, then pick here.
              </p>
              <PhotoPicker
                value={draft.images}
                library={mediaLibrary}
                onChange={(images) => patchDraft({ images })}
                emptyHint="No photos in the library yet. Add some under Photos, then come back and they'll be selectable here."
              />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Overnight">
                <select
                  className={INPUT}
                  value={draft.overnight}
                  onChange={(e) =>
                    patchDraft({ overnight: e.target.value as MapZone["overnight"] })
                  }
                >
                  <option value="yes">Yes — allowed</option>
                  <option value="no">No</option>
                  <option value="confirm-first">Confirm first (call ahead)</option>
                </select>
              </Field>
              <Field label="Confidence">
                <span className="flex gap-2">
                  <select
                    className={INPUT}
                    value={draft.confidence}
                    onChange={(e) =>
                      patchDraft({ confidence: e.target.value as MapZone["confidence"] })
                    }
                  >
                    <option value="verified">Verified</option>
                    <option value="probable">Probable</option>
                    <option value="unverified">Unverified</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => patchDraft({ confidence: "verified" })}
                    disabled={draft.confidence === "verified"}
                    title="I checked this on the ground — mark it verified"
                    className="shrink-0 rounded-lg border border-fern/40 bg-fern/10 px-3 py-2 text-sm font-semibold whitespace-nowrap text-fern transition-colors hover:bg-fern/20 disabled:opacity-50"
                  >
                    ✓ field-verified
                  </button>
                </span>
              </Field>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={save}
                disabled={saving || !dirty}
                className="rounded-full bg-sound px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-sound-deep disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save zone"}
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={saving}
                className="rounded-full border border-coral px-4 py-2 text-sm font-semibold text-coral-deep transition-colors hover:bg-coral/10 disabled:opacity-50"
              >
                Delete zone
              </button>
              {message && (
                <p
                  className={`text-sm font-medium ${
                    message.kind === "ok" ? "text-fern" : "text-coral-deep"
                  }`}
                >
                  {message.text}
                </p>
              )}
            </div>
          </div>
        )}

        {!selectedZone && message && (
          <p
            className={`text-sm font-medium ${
              message.kind === "ok" ? "text-fern" : "text-coral-deep"
            }`}
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}

const PIN_CSS = `
.pe-pin { position: relative; width: 0; height: 0; cursor: pointer; }
.pe-dot {
  position: absolute;
  left: 0;
  top: 0;
  transform: translate(-50%, -50%);
  display: block;
  width: 13px;
  height: 13px;
  border-radius: 9999px;
  border: 2px solid #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.4);
}
.pe-pin--selected .pe-dot { width: 18px; height: 18px; }
.pe-tip {
  position: absolute;
  left: 0;
  bottom: 10px;
  transform: translateX(-50%);
  display: none;
  white-space: nowrap;
  font: 600 11px/1.2 system-ui, -apple-system, sans-serif;
  color: #fff;
  background: #16405e;
  border-radius: 3px;
  padding: 2px 6px;
}
.pe-pin:hover .pe-tip { display: block; }
.pe-hover {
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
`;
