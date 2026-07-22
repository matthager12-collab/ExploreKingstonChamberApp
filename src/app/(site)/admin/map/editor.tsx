"use client";

// Parking-map zone editor for the Chamber admin (laptop-first).
//
// Leaflet touches `window` at module scope, so it is imported dynamically
// inside useEffect (same pattern as components/town-map.tsx). Geoman's
// browser bundle reads the global `L`, so the import order in the effect is:
// leaflet → window.L = L → geoman → create the map. Geoman's CSS is a plain
// stylesheet import — safe at module top because this file is client-only
// and Next extracts CSS at build time.
//
// Flow: pick a zone from the sidebar (or click it on the map) → the map fits
// to it, its polygon grows drag-able corner handles (geoman edit mode, no
// self-intersection) and its center pin becomes draggable → adjust shape and
// fields → Save POSTs the geometry read back from the live layers to
// /api/admin/parking. "Draw new zone" arms geoman's polygon draw; Delete
// tombstones the zone in the overlay store (seed zones stay hidden).

import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { LatLng, Map as LeafletMap, Marker, Polygon } from "leaflet";
import { RULE_LABELS, type MapZone, type ParkingRule } from "@/lib/data/parking";
import { Badge } from "@/components/ui";

/* ------------------------------------------------------------------ */
/* Constants & small helpers                                           */
/* ------------------------------------------------------------------ */

// Same canvas colors as town-map.tsx — they live on the map, not in the
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

function ruleColor(rule: string): string {
  return RULE_COLORS[rule] ?? "#6b7280";
}

const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;

function ringToPolygon(ring: LatLng[]): [number, number][] {
  return ring.map((ll) => [r6(ll.lat), r6(ll.lng)] as [number, number]);
}

function centroidOf(polygon: [number, number][]): [number, number] {
  const lat = polygon.reduce((s, p) => s + p[0], 0) / polygon.length;
  const lng = polygon.reduce((s, p) => s + p[1], 0) / polygon.length;
  return [r6(lat), r6(lng)];
}

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

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

type ZoneLayers = { polygon?: Polygon; marker: Marker };

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
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const layersRef = useRef(new Map<string, ZoneLayers>());
  // Ids drawn in this session but never saved — deleting them skips the API.
  const unsavedIdsRef = useRef(new Set<string>());

  // Mirrors for map-event callbacks (created once, must see current state).
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const selectRef = useRef<(id: string) => void>(() => {});

  /* ---------------- imperative layer management ---------------- */

  function baseStyle(zone: MapZone, selected: boolean) {
    const color = ruleColor(zone.rule);
    return {
      color,
      weight: selected ? 3 : 2,
      fillColor: color,
      fillOpacity: selected ? 0.5 : 0.3,
    };
  }

  function markerIcon(zone: MapZone, selected: boolean) {
    const L = leafletRef.current!;
    const color = ruleColor(zone.rule);
    const size = selected ? 18 : 13;
    return L.divIcon({
      className: "",
      html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4);"></span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function addZoneLayers(zone: MapZone) {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    const entry: ZoneLayers = {
      marker: L.marker(zone.center, {
        icon: markerIcon(zone, false),
        pmIgnore: true, // the pin is plain-leaflet draggable, not geoman-managed
      })
        .addTo(map)
        .bindTooltip(zone.name, { direction: "top", offset: [0, -8] })
        .on("click", () => selectRef.current(zone.id))
        .on("dragend", () => setDirty(true)),
    };

    if (zone.polygon && zone.polygon.length >= 3) {
      entry.polygon = L.polygon(zone.polygon, baseStyle(zone, false))
        .addTo(map)
        .bindTooltip(zone.name, { sticky: true })
        .on("click", () => selectRef.current(zone.id))
        // Both fire only while geoman editing is enabled — i.e. when selected.
        .on("pm:edit", () => setDirty(true))
        .on("pm:markerdragend", () => setDirty(true));
    }

    layersRef.current.set(zone.id, entry);
  }

  function removeZoneLayers(id: string) {
    const entry = layersRef.current.get(id);
    entry?.polygon?.remove();
    entry?.marker.remove();
    layersRef.current.delete(id);
  }

  function setEditing(id: string, zone: MapZone, on: boolean) {
    const entry = layersRef.current.get(id);
    if (!entry) return;
    if (entry.polygon) {
      if (on) entry.polygon.pm.enable({ allowSelfIntersection: false });
      else entry.polygon.pm.disable();
      entry.polygon.setStyle(baseStyle(zone, on));
    }
    entry.marker.setIcon(markerIcon(zone, on));
    if (on) entry.marker.dragging?.enable();
    else entry.marker.dragging?.disable();
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
    const entry = layersRef.current.get(id);
    if (map && entry) {
      if (entry.polygon) {
        map.fitBounds(entry.polygon.getBounds(), { padding: [60, 60], maxZoom: 19 });
      } else {
        map.setView(zone.center, Math.max(map.getZoom(), 17));
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
      const L = (await import("leaflet")).default;
      // Geoman's browser bundle registers itself on the global L.
      (window as unknown as { L?: typeof L }).L = L;
      await import("@geoman-io/leaflet-geoman-free");
      // Guard: unmounted while loading, or already initialized (StrictMode).
      if (cancelled || !containerRef.current || mapRef.current) return;

      leafletRef.current = L;
      const map = L.map(containerRef.current, {
        center: [47.7968, -122.4979],
        zoom: 17,
      });
      mapRef.current = map;

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      map.pm.setGlobalOptions({ allowSelfIntersection: false });
      map.on("pm:create", (e) => {
        handleDrawnRef.current(e.layer as Polygon);
      });

      for (const zone of zonesRef.current) addZoneLayers(zone);
      setMapReady(true);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layersRef.current.clear();
    };
    // Zones are managed imperatively after mount; re-running would tear the
    // map down mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- draw new zone ---------------- */

  const handleDrawnRef = useRef<(layer: Polygon) => void>(() => {});
  handleDrawnRef.current = (layer: Polygon) => {
    const map = mapRef.current;
    setDrawing(false);
    const ring = layer.getLatLngs()[0] as LatLng[];
    const polygon = ringToPolygon(ring);
    layer.remove(); // re-added via addZoneLayers so the wiring is uniform
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
    addZoneLayers(zone);
    select(id);
    setDirty(true);
    setMessage({
      kind: "ok",
      text: "Shape drawn — name it, set the rule, then Save to publish.",
    });
  };

  function toggleDraw() {
    const map = mapRef.current;
    if (!map) return;
    if (drawing) {
      map.pm.disableDraw();
      setDrawing(false);
      return;
    }
    map.pm.enableDraw("Polygon");
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

  /** The draft zone with geometry read back from the live map layers. */
  function buildZone(): MapZone | null {
    if (!draft || !selectedId) return null;
    const zone = zonesRef.current.find((z) => z.id === selectedId);
    if (!zone) return null;

    const entry = layersRef.current.get(selectedId);
    let polygon = zone.polygon;
    if (entry?.polygon) {
      const ring = entry.polygon.getLatLngs()[0] as LatLng[];
      polygon = ringToPolygon(ring);
    }
    const center: [number, number] = entry
      ? [r6(entry.marker.getLatLng().lat), r6(entry.marker.getLatLng().lng)]
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

      // Rebuild the zone's layers so color, tooltip, and geometry all reflect
      // the saved record, then hand the editing handles straight back.
      removeZoneLayers(saved.id);
      addZoneLayers(saved);
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
    removeZoneLayers(id);
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
