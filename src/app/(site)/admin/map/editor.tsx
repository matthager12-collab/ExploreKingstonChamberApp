"use client";

// Parking-map zone editor for the Chamber admin (laptop-first).
//
// E32a (ADR-0006): MapLibre GL on the self-hosted vector tiles + terra-draw
// for interactive editing — the Leaflet + geoman stack this file was built on
// is retired. The heavy browser-only libraries are loaded dynamically inside
// useEffect (same pattern as components/feature-map.tsx); terra-draw is
// created after the map's style loads, which the adapter requires.
//
// Flow (unchanged): pick a zone from the sidebar (or click it on the map) →
// the map fits to it, its polygon grows drag-able corner handles (terra-draw
// select mode: drag corners, click a midpoint to add one, right-click a
// corner to remove it, no self-intersection) and its center pin becomes
// draggable → adjust shape and fields → Save POSTs the geometry read back
// from the draw store to /api/admin/parking. "Draw new zone" arms terra-draw
// polygon draw; Delete tombstones the zone in the overlay store (seed zones
// stay hidden).
//
// Wire-format invariant (FR-EDIT-06): the API speaks stored [lat,lng] open
// rings, r6-rounded; terra-draw speaks GeoJSON [lng,lat] closed rings. Every
// crossing goes through @/lib/map/draw-coords — nothing here converts by hand.

import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import type { GeoJSONStoreFeatures, TerraDraw } from "terra-draw";
import { RULE_LABELS, type MapZone, type ParkingRule } from "@/lib/data/parking";
import { mapStyle, TILES_PMTILES_PATH } from "@/lib/map/basemap";
import { loadMapLibre, pmtilesUrl } from "@/lib/map/maplibre";
import { editorIdStrategy, loadTerraDraw } from "@/lib/map/terradraw";
import { r6, toGeoJsonRing, toStoredRing } from "@/lib/map/draw-coords";
import { Badge } from "@/components/ui";

/* ------------------------------------------------------------------ */
/* Constants & small helpers                                           */
/* ------------------------------------------------------------------ */

// Same canvas colors as the public maps — they live on the map, not in the
// page's token system.
const RULE_COLORS: Record<string, string> = {
  "free-2hr": "#2e9e4f",
  "free-unrestricted": "#1E96C0",
  paid: "#7c4dbe",
  "park-and-ride-24h": "#e8891d",
  prohibited: "#d43d3d",
  "load-zone": "#f0b429",
  permit: "#6b7280",
};

const RULES: ParkingRule[] = [
  "free-2hr",
  "free-unrestricted",
  "paid",
  "park-and-ride-24h",
  "prohibited",
  "load-zone",
  "permit",
];

const INPUT =
  "w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm text-ink focus:border-tide focus:outline-none";

function ruleColor(rule: string): `#${string}` {
  return (RULE_COLORS[rule] ?? "#6b7280") as `#${string}`;
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
};

function toDraft(zone: MapZone): Draft {
  return {
    name: zone.name,
    rule: zone.rule,
    summary: zone.summary,
    details: zone.details,
    overnight: zone.overnight,
    confidence: zone.confidence,
  };
}

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

/** The zone's polygon as a terra-draw store feature (id = zone id). */
function zoneDrawFeature(zone: MapZone): GeoJSONStoreFeatures {
  return {
    id: zone.id,
    type: "Feature",
    properties: { mode: "polygon", rule: zone.rule },
    geometry: { type: "Polygon", coordinates: [toGeoJsonRing(zone.polygon ?? [])] },
  } as GeoJSONStoreFeatures;
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

export function MapZoneEditor({ initialZones }: { initialZones: MapZone[] }) {
  const router = useRouter();

  const [zones, setZones] = useState<MapZone[]>(initialZones);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [drawing, setDrawing] = useState(false);
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
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  const selectRef = useRef<(id: string) => void>(() => {});

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

    if (zone.polygon && zone.polygon.length >= 3) {
      withStoreOps(() => draw.addFeatures([zoneDrawFeature(zone)]));
    }
  }

  function removeZoneFromMap(id: string) {
    const draw = drawRef.current;
    if (draw?.hasFeature(id)) withStoreOps(() => draw.removeFeatures([id]));
    markersRef.current.get(id)?.remove();
    markersRef.current.delete(id);
  }

  function setEditing(id: string, zone: MapZone, on: boolean) {
    const draw = drawRef.current;
    if (draw && zone.polygon && zone.polygon.length >= 3 && draw.hasFeature(id)) {
      withStoreOps(() => (on ? draw.selectFeature(id) : draw.deselectFeature(id)));
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
      setDrawing(false);
    }
    if (prev) {
      const prevZone = zonesRef.current.find((z) => z.id === prev);
      if (prevZone) setEditing(prev, prevZone, false);
    }

    const zone = zonesRef.current.find((z) => z.id === id);
    if (!zone) return;
    setSelectedId(id);
    setDraft(toDraft(zone));
    setDirty(false);
    setMessage(null);

    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (map && maplibregl) {
      if (zone.polygon && zone.polygon.length >= 3) {
        const first: [number, number] = [zone.polygon[0][1], zone.polygon[0][0]];
        const bounds = new maplibregl.LngLatBounds(first, first);
        for (const p of zone.polygon) bounds.extend([p[1], p[0]]);
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

      map.on("load", () => {
        if (cancelled || mapRef.current !== map) return;

        const {
          TerraDraw: TerraDrawCtor,
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
              },
            }),
          ],
        });
        draw.start();
        draw.setMode("select");
        drawRef.current = draw;

        draw.on("finish", (finishedId, context) => {
          if (context.mode === "polygon" && context.action === "draw") {
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
          if (sel && ids.some((i) => String(i) === sel)) setDirty(true);
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
            .find((f) => f.geometry.type === "Polygon" && f.properties?.mode === "polygon");
          if (hit?.id != null) selectRef.current(String(hit.id));
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
            .find((f) => f.geometry.type === "Polygon" && f.properties?.mode === "polygon");
          const zone = hit ? zonesRef.current.find((z) => z.id === String(hit.id)) : undefined;
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

  /* ---------------- draw new zone ---------------- */

  const handleDrawnRef = useRef<(tdId: string) => void>(() => {});
  handleDrawnRef.current = (tdId: string) => {
    const map = mapRef.current;
    const draw = drawRef.current;
    setDrawing(false);
    if (!draw) return;
    draw.setMode("select");

    const feat = draw.getSnapshotFeature(tdId);
    // Re-added under the zone's own id via addZoneToMap so wiring is uniform.
    withStoreOps(() => draw.removeFeatures([tdId]));
    if (!feat || feat.geometry.type !== "Polygon") return;
    const polygon = toStoredRing(feat.geometry.coordinates[0]);
    if (!map || polygon.length < 3) return;

    const id = `zone-${Math.random().toString(36).slice(2, 8)}`;
    const zone: MapZone = {
      id,
      name: "New zone",
      rule: "paid",
      summary: "",
      details: "",
      confidence: "probable",
      overnight: "confirm-first",
      center: centroidOf(polygon),
      polygon,
    };
    unsavedIdsRef.current.add(id);
    zonesRef.current = [...zonesRef.current, zone];
    setZones(zonesRef.current);
    addZoneToMap(zone);
    select(id);
    setDirty(true);
    setMessage({
      kind: "ok",
      text: "Shape drawn — name it, set the rule, then Save to publish.",
    });
  };

  function toggleDraw() {
    const draw = drawRef.current;
    if (!draw) return;
    if (drawing) {
      draw.setMode("select");
      setDrawing(false);
      // Arming the draw dropped the zone's draw-selection — hand it back.
      const sel = selectedIdRef.current;
      const zone = sel ? zonesRef.current.find((z) => z.id === sel) : undefined;
      if (sel && zone) setEditing(sel, zone, true);
      return;
    }
    draw.setMode("polygon");
    setDrawing(true);
    setMessage({
      kind: "ok",
      text: "Click the map to place corners; click the first corner again to finish.",
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

    let polygon = zone.polygon;
    const feat = drawRef.current?.getSnapshotFeature(selectedId);
    if (feat && feat.geometry.type === "Polygon") {
      polygon = toStoredRing(feat.geometry.coordinates[0]);
    }
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
      center,
      ...(polygon ? { polygon } : {}),
    };
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
        <button
          type="button"
          onClick={toggleDraw}
          disabled={!mapReady}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
            drawing
              ? "border border-coral bg-coral/10 text-coral-deep"
              : "bg-sound text-white hover:bg-sound-deep"
          }`}
        >
          {drawing ? "✕ Cancel drawing" : "✎ Draw new zone"}
        </button>

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
      </div>

      {/* Map + fields */}
      <div className="flex flex-col gap-4">
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
