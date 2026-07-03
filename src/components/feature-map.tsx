"use client";

// Public, reusable Leaflet map that renders any named MapView anywhere in the
// app. It fetches the resolved view from /api/map/<view> (view config + custom
// features + built-in-source payloads) and draws every layer client-side.
//
// Leaflet touches `window` at module scope, so it is imported dynamically
// inside useEffect — this component renders an empty shell on the server and
// hydrates on the client. Leaflet CSS is imported globally. Default marker
// icons are deliberately avoided (their asset paths break under bundlers):
// markers use L.divIcon; everything else uses circleMarker/polyline/polygon.
//
// Colors on the map canvas are intentionally hex — they live on the tiles,
// not in the page's token system, and are kept consistent with town-map.tsx.

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import {
  markerCategory,
  featureColor,
  featureImages,
  parkingTypeInfo,
  type MapFeature,
  type ResolvedMapView,
} from "@/lib/map/types";

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

/** Rounded teardrop divIcon: an emoji chip on a white pin with a colored ring. */
function markerIconHtml(emoji: string, ring: string): string {
  return `<div style="position:relative;transform:translate(-50%,-100%);">
    <div style="width:30px;height:30px;border-radius:50% 50% 50% 0;background:#fff;border:2px solid ${ring};box-shadow:0 2px 4px rgba(0,0,0,0.3);transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;">
      <span style="transform:rotate(45deg);font-size:15px;line-height:1;">${emoji}</span>
    </div>
  </div>`;
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

function restaurantPopupHtml(r: { name: string; walkMinutesFromFerry: number }): string {
  return `<div style="font-size:0.8rem;line-height:1.35;max-width:230px;">
    <p style="margin:0;font-weight:600;font-size:0.95rem;">🍽️ ${esc(r.name)}</p>
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
  const mapRef = useRef<LeafletMap | null>(null);
  const [data, setData] = useState<ResolvedMapView | null>(resolved ?? null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    resolved ? "ready" : "loading",
  );
  const [legend, setLegend] = useState<LegendEntry[]>([]);
  // On touch devices the map starts non-draggable so the page can scroll past
  // it; a tap unlocks panning. Always false on desktop (fine pointer).
  const [locked, setLocked] = useState(false);

  function unlock() {
    mapRef.current?.dragging.enable();
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
  // keeps this component fully reusable across view switches.
  useEffect(() => {
    if (status !== "ready" || !data) return;
    let cancelled = false;
    const legendEntries = new Map<string, LegendEntry>();
    const addLegend = (e: LegendEntry) => {
      if (!legendEntries.has(e.key)) legendEntries.set(e.key, e);
    };

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        center: data.view.center,
        zoom: data.view.zoom,
        scrollWheelZoom: false, // don't hijack page scroll; pinch/± still zoom
      });
      mapRef.current = map;

      // On touch devices a full-width map otherwise eats the page's vertical
      // swipes ("scroll trap"): disable panning until the visitor taps to
      // activate. Desktop is untouched (fine-pointer → stays interactive).
      const coarse =
        typeof window !== "undefined" &&
        window.matchMedia?.("(pointer: coarse)").matches;
      if (coarse) {
        map.dragging.disable();
        setLocked(true);
      } else {
        setLocked(false);
      }

      // Collect content coordinates so the view auto-frames what it actually
      // shows (the configured center/zoom is only a fallback).
      const pts: [number, number][] = [];

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      // ---- custom features ----
      // A parking-typed feature colors itself by parking.type (featureColor)
      // and gets a legend entry keyed by that type (deduped across lots),
      // instead of the generic per-kind color/legend.
      const parkingLegend = (
        f: MapFeature,
        color: string,
        shape: "pin" | "swatch",
      ): LegendEntry | null => {
        const info = f.parking ? parkingTypeInfo(f.parking.type) : undefined;
        if (!info) return null;
        return { key: `parking-type-${info.key}`, label: info.label, color, shape };
      };

      for (const f of data.features) {
        if (f.kind === "marker" && f.point) {
          const cat = markerCategory(f.category);
          const ring = featureColor(f, cat.color);
          const icon = L.divIcon({
            className: "feature-pin",
            html: markerIconHtml(cat.emoji, ring),
            iconSize: [0, 0],
            popupAnchor: [0, -30],
          });
          L.marker(f.point, { icon })
            .addTo(map)
            .bindPopup(featurePopupHtml(f), { maxWidth: 240 });
          pts.push(f.point);
          const pl = parkingLegend(f, ring, "pin");
          addLegend(
            pl ?? {
              key: `cat-${cat.key}`,
              label: cat.label,
              color: ring,
              shape: "pin",
              emoji: cat.emoji,
            },
          );
        } else if (f.kind === "line" && f.path) {
          const color = featureColor(f, LINE_COLOR);
          L.polyline(f.path, { color, weight: 4, opacity: 0.85 })
            .addTo(map)
            .bindPopup(featurePopupHtml(f), { maxWidth: 240 });
          pts.push(...f.path);
          const pl = parkingLegend(f, color, "swatch");
          addLegend(pl ?? { key: "kind-line", label: "Route", color, shape: "line" });
        } else if (f.kind === "trail" && f.path) {
          const color = featureColor(f, TRAIL_COLOR);
          L.polyline(f.path, { color, weight: 4, opacity: 0.9, dashArray: "6 6" })
            .addTo(map)
            .bindPopup(featurePopupHtml(f), { maxWidth: 240 });
          pts.push(...f.path);
          const pl = parkingLegend(f, color, "swatch");
          addLegend(pl ?? { key: "kind-trail", label: "Trail", color, shape: "dash" });
        } else if (f.kind === "area" && f.polygon) {
          const color = featureColor(f, AREA_COLOR);
          L.polygon(f.polygon, {
            color,
            weight: 2,
            fillColor: color,
            fillOpacity: 0.22,
          })
            .addTo(map)
            .bindPopup(featurePopupHtml(f), { maxWidth: 240 });
          pts.push(...f.polygon);
          const pl = parkingLegend(f, color, "swatch");
          addLegend(pl ?? { key: "kind-area", label: "Area", color, shape: "swatch" });
        }
      }

      // ---- built-ins: restaurants (category-aware pins) ----
      for (const r of data.builtins.restaurants ?? []) {
        const cat = markerCategory(r.category);
        const icon = L.divIcon({
          className: "feature-pin",
          html: markerIconHtml(cat.emoji, cat.color),
          iconSize: [0, 0],
          popupAnchor: [0, -30],
        });
        L.marker([r.lat, r.lng], { icon })
          .addTo(map)
          .bindPopup(restaurantPopupHtml(r), { maxWidth: 240 });
        pts.push([r.lat, r.lng]);
        addLegend({
          key: `builtin-restaurant-${cat.key}`,
          label: cat.label,
          color: cat.color,
          shape: "pin",
          emoji: cat.emoji,
        });
      }

      // ---- built-ins: parking zones ----
      for (const z of data.builtins.parkingZones ?? []) {
        const color = parkingColor(z.rule);
        const popup = `<div style="font-size:0.8rem;line-height:1.35;max-width:230px;">
          <p style="margin:0;font-weight:600;font-size:0.95rem;">${esc(z.name)}</p>
          <p style="margin:4px 0 0;">${esc(z.summary)}</p>
        </div>`;
        if (z.polygon && z.polygon.length >= 3) {
          L.polygon(z.polygon, {
            color,
            weight: 2,
            fillColor: color,
            fillOpacity: 0.35,
          })
            .addTo(map)
            .bindPopup(popup, { maxWidth: 240 });
        } else {
          L.circleMarker(z.center, {
            radius: 7,
            color: "#ffffff",
            weight: 2,
            fillColor: color,
            fillOpacity: 0.9,
          })
            .addTo(map)
            .bindPopup(popup, { maxWidth: 240 });
        }
        pts.push(z.center);
        addLegend({
          key: `parking-${z.rule}`,
          label: PARKING_RULE_LABELS[z.rule] ?? z.rule,
          color,
          shape: "swatch",
        });
      }

      // Auto-frame to the content we just drew, so a view fits what it shows
      // instead of an out-of-date center/zoom. Skipped when:
      //  - the view carries the wide street overlay (its center/zoom is tuned), or
      //  - the content is spread wide (e.g. a lighthouse 13 km north): a lone
      //    far pin would zoom the whole map out and bury downtown, so we keep
      //    the configured center/zoom and let the visitor pan to the outlier.
      if (!data.builtins.streets && pts.length > 0) {
        const bounds = L.latLngBounds(pts);
        const spanKm = bounds.getNorthWest().distanceTo(bounds.getSouthEast()) / 1000;
        if (spanKm <= 4) {
          map.fitBounds(bounds, { padding: [32, 32], maxZoom: 16 });
        }
      }

      // ---- built-ins: streets (fetched here) ----
      if (data.builtins.streets) {
        try {
          const res = await fetch("/geo/street-parking.json");
          if (res.ok && !cancelled && mapRef.current) {
            const street = (await res.json()) as StreetData;

            L.polygon(street.boundary, {
              color: BOUNDARY_COLOR,
              weight: 2,
              dashArray: "6 6",
              fill: false,
              interactive: false,
            }).addTo(map);

            // Draw quiet layers first so rule-bearing streets sit on top.
            const rank = (r: StreetRule) =>
              r === "default" ? 0 : r === "ferry-holding" ? 1 : 2;
            const ordered = [...street.segments].sort(
              (a, b) =>
                rank(normalizeStreetRule(a.rule)) - rank(normalizeStreetRule(b.rule)),
            );
            for (const seg of ordered) {
              const rule = normalizeStreetRule(seg.rule);
              const [title, subtitle] =
                rule === "ferry-holding"
                  ? [STREET_RULE_LABELS[rule], seg.name]
                  : [seg.name, STREET_RULE_LABELS[rule]];
              const popup = `<div style="font-size:0.8rem;line-height:1.35;max-width:230px;">
                <p style="margin:0;font-weight:600;font-size:0.95rem;">${esc(title)}</p>
                <p style="margin:4px 0 0;font-weight:600;color:${
                  STREET_COLORS[rule]
                };">${esc(subtitle)}</p>
                ${seg.note ? `<p style="margin:4px 0 0;">${esc(seg.note)}</p>` : ""}
              </div>`;
              L.polyline(seg.coords, streetStyle(rule))
                .addTo(map)
                .bindPopup(popup, { maxWidth: 240 });
              addLegend({
                key: `street-${rule}`,
                label:
                  rule === "ferry-holding"
                    ? "Ferry holding line"
                    : rule === "default"
                      ? "Street: no known limit"
                      : rule === "prohibited"
                        ? "Street: no parking"
                        : rule === "free-2hr"
                          ? "Street: free, 2-hr"
                          : "Street: free, no limit",
                color: STREET_COLORS[rule],
                shape: rule === "ferry-holding" ? "dash" : "line",
              });
            }
            addLegend({
              key: "street-boundary",
              label: "Kingston UGA",
              color: BOUNDARY_COLOR,
              shape: "dash",
            });
          }
        } catch {
          // Overlay is progressive enhancement — the base map still works.
        }
      }

      if (!cancelled) setLegend([...legendEntries.values()]);
    })();

    return () => {
      cancelled = true;
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
