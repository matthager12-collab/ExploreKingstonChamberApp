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
// Colors on the map canvas are intentionally hex — they live on the canvas, not
// in the page's token system. Parking colors are kept in sync BY HAND with the
// two admin editors (see docs/MAPS.md "Two divergent parking color maps").

import { useEffect, useRef, useState } from "react";
import type {
  ExpressionSpecification,
  Map as MapLibreMap,
  Marker as MapLibreMarker,
} from "maplibre-gl";
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
import { applyBasemapMode, mapStyle, type BasemapMode } from "@/lib/map/basemap";
import type { ParkingPhoto } from "@/lib/map/parking-photos";
import { basemapArchiveUrl, loadMapLibre } from "@/lib/map/maplibre";
import { fixMarkerA11y } from "@/lib/map/marker-a11y";
import { MapTouchLockOverlay, useMapTouchLock } from "@/components/map-touch-lock";
import { curbOffsetSigns } from "@/lib/map/curb";

/** How far inside the viewport a map must be before the ~200 KB MapLibre engine
 *  loads, as a FRACTION of the viewport — see the reveal gate at the bottom of
 *  the build effect for why this is a fraction and never a pixel count. Both
 *  the IntersectionObserver rootMargin and the plain-rect fallback derive from
 *  this one value, so the two can never disagree about what "revealed" means. */
const REVEAL_INSET = 0.25;

// ---- shared color conventions (kept in sync with both admin editors) ----
// Values are ADR-0007 §4 (the "Evergreen & Sound" overlay half): dark,
// saturated overlay hues over the light desaturated base. The four that moved
// there (park-and-ride-24h, load-zone, ferry-holding, permit) are the ADR's;
// the rest are deliberately unchanged.

const PARKING_RULE_COLORS: Record<string, string> = {
  "free-2hr": "#2e9e4f",
  "free-unrestricted": "#1E96C0",
  paid: "#7c4dbe",
  // Deep magenta: the one hue the parking legend had left. Measured against
  // every other rule colour before picking it (ΔE76 41.3 from its nearest
  // neighbour, `paid` purple) — wider than ANY existing pair in the legend, so
  // ADR-0007 §4's "zero confusable pairs" still holds. 3.65:1 on the worst base
  // surface (greenspace) clears WCAG 1.4.11, and white on it is 6.89:1, a
  // shade better than the P&R badge the ADR was written to fix.
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

const PARKING_RULE_LABELS: Record<string, string> = {
  "free-2hr": "Free · 2-hour limit",
  "free-unrestricted": "Free · no time limit",
  paid: "Paid lot",
  "business-customer": "Customer parking",
  "park-and-ride-24h": "Park & ride · 24 hr",
  prohibited: "No parking",
  "load-zone": "Load zone",
  permit: "Permit parking",
};

/** Popup wording for a zone's known curb side (E31 phase 6). */
const CURB_LABELS: Record<string, string> = {
  both: "both sides of the street",
  east: "the east side of the street",
  west: "the west side of the street",
  north: "the north side of the street",
  south: "the south side of the street",
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
  "ferry-holding": "#3f5473", // ADR-0007: navy — no longer a near-twin of permit
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

/** Chamber-member pin ring — a map-specific deepening of the brand cyan, in the
 *  same spirit as the basemap PALETTE (ADR-0007): tints and shades derived from
 *  the globals.css tokens, because the UI values are tuned for text on white,
 *  not for graphics on a basemap.
 *
 *  A member pin should read as "this is a Chamber business", so brand blue is
 *  the honest colour — but the ring is a graphical object under WCAG 1.4.11 and
 *  needs 3:1 against whatever it overlaps. Neither token qualifies: the logo
 *  cyan `--color-tide #1E96C0` is 2.14:1 on water, and `--color-tide-deep
 *  #16758f` is 2.80:1 on the deepened greenspace green. This shade clears every
 *  base surface (worst 3.44:1, on greenspace).
 *
 *  tests/unit/member-pin.test.ts recomputes all of this — if the basemap
 *  palette moves, that test fails rather than the contrast quietly rotting. */
const MEMBER_RING = "#136680";

/** Fill opacity for a matched member building — the "member built" tier against
 *  the basemap's neutral "built" fill.
 *
 *  0.32 is not a taste value. Below it the composite drifts into the water
 *  fill's lightness and a highlighted building starts reading as a pond
 *  (at 0.25 it is only 6.8 L* off `#b5d2de`); 0.32 composites to `#99b7bb`,
 *  10.1 L* clear of water and 1.55:1 against a plain neighbouring building,
 *  while keeping the `MEMBER_RING` outline at 3.04:1 on its own fill. Raising
 *  it is safe; lowering it is not. */
const MEMBER_BUILDING_OPACITY = 0.32;

/** Fill opacity for a member-flagged DRAWN area (a building footprint traced
 *  in the /admin/maps builder) — the app-side member-building treatment the
 *  runtime match above can only approximate from tile data.
 *
 *  Deliberately deeper than MEMBER_BUILDING_OPACITY: a drawn footprint can sit
 *  on ANY base surface, not just the neutral building grey. 0.32 over plain
 *  land (`earth #e4e8e4`) composites to only 7.4 L* from the water fill — a
 *  hair under the 8 L* pond floor; 0.38 clears every land surface (worst
 *  10.3 L*, on earth) while the MEMBER_RING boundary keeps WCAG 1.4.11's 3:1
 *  on every surface it can border (worst 3.44:1, greenspace).
 *  tests/unit/member-pin.test.ts recomputes all of this per surface. */
const MEMBER_AREA_OPACITY = 0.38;

const BOUNDARY_COLOR = "#324A6D";
const LINE_COLOR = "#2a7f8a";
const TRAIL_COLOR = "#4a7c59";
const AREA_COLOR = "#2a7f8a";

/* ---- overlay contrast on aerial imagery -------------------------------- */
//
// The ADR-0007 overlay palette is a set of DARK, saturated hues, chosen to sit
// on the light desaturated vector base. Dropped straight onto an aerial photo
// they lose their meaning: a purple paid-lot outline over dark asphalt is a
// smudge, and WCAG 1.4.11's 3:1 for graphical objects cannot be promised at all
// against arbitrary photographic pixels.
//
// The fix is the cartographic standard rather than a colour change: keep every
// hue exactly as the ADR specifies and put a white CASING under it, so each
// stroke carries its own light backdrop wherever it lands. Casing layers ship
// with the overlay always and are simply held at opacity 0 on the vector base —
// cheaper and far less fragile than adding and removing layers on every toggle.

const CASING_COLOR = "#ffffff";

/** Casing layers, each added immediately BELOW the coloured layer it backs. */
const CASING_LAYERS = [
  "fm-fills-casing",
  "fm-curbs-casing",
  "fm-lines-casing",
  "fm-dashed-casing",
] as const;

const BASE_FILL_OPACITY: ExpressionSpecification = ["coalesce", ["get", "opacity"], 0.22];

/**
 * The same per-feature opacity, roughly HALVED for imagery — and the direction
 * is the whole point, so it is worth stating plainly: an area fill gets
 * *weaker* over satellite, not stronger.
 *
 * On the vector base a translucent fill is the cheapest way to say "this area
 * means X", because there is nothing underneath worth preserving. Over aerial
 * photography the content beneath the fill IS the information — the painted
 * stalls, the angled rows, where the asphalt actually ends — so identity has to
 * move off the fill and onto the white-cased boundary above. Measured at the
 * first cut: a 0.5 fill turned the Port lot into a flat purple rectangle with
 * the cars invisible, which is the exact opposite of why /parking opens on
 * imagery at all.
 *
 * The floor keeps a faint area from disappearing entirely; the multiplier keeps
 * a deliberately-heavier fill proportionally heavier.
 */
const IMAGERY_FILL_OPACITY: ExpressionSpecification = [
  "max",
  0.12,
  ["*", ["coalesce", ["get", "opacity"], 0.22], 0.45],
];

/** Re-tune the app's own overlay for the base underneath it. Guarded per layer:
 *  a view with no areas has no `fm-fills`, and that must be a no-op. */
function applyOverlayContrast(map: MapLibreMap, mode: BasemapMode): void {
  const satellite = mode === "satellite";
  for (const id of CASING_LAYERS) {
    if (map.getLayer(id)) map.setPaintProperty(id, "line-opacity", satellite ? 0.9 : 0);
  }
  if (map.getLayer("fm-fills")) {
    map.setPaintProperty(
      "fm-fills",
      "fill-opacity",
      satellite ? IMAGERY_FILL_OPACITY : BASE_FILL_OPACITY,
    );
  }
  if (map.getLayer("fm-circles")) {
    // The circles already carry a white stroke on the vector base; over
    // imagery it has to do real separation work, so it thickens.
    map.setPaintProperty("fm-circles", "circle-stroke-width", satellite ? 3 : 2);
  }
}

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

/** Distinct park-&-ride badge (E31 phase 6): the two Kitsap Transit lots are
 *  the "leave the car here" answer, so they get a labelled chip instead of an
 *  anonymous circle. Anchor "center". */
function prPinEl(): HTMLElement {
  const el = document.createElement("div");
  el.className = "fm-pr-pin";
  el.textContent = "P&R";
  // No aria-hidden here: this element gets role="img" + the lot's name via
  // fixMarkerA11y() after addTo(), and that aria-label supersedes the inner text.
  return el;
}

/** Rounded teardrop pin element: an emoji chip on a white pin with a colored
 *  ring. MapLibre positions it with anchor "bottom" (the rotate puts the sharp
 *  tip at bottom-center), so there is no translate here (unlike the Leaflet
 *  divIcon version). */
function pinEl(emoji: string, ring: string, member = false): HTMLElement {
  const el = document.createElement("div");
  el.className = member ? "feature-pin feature-pin--member" : "feature-pin";
  el.style.cursor = "pointer";
  // Member emphasis rides two channels at once — size AND a concentric outer
  // ring — so it never depends on colour alone (the category ring is already
  // carrying colour, and colour-blind visitors would lose a colour-only cue).
  // The white 1px gap is what keeps the two rings from reading as one thick
  // band. box-shadow (not border) draws it, so it follows the teardrop radius
  // and adds nothing to layout size.
  const size = member ? 34 : 30;
  const shadow = member
    ? `0 0 0 1px #fff, 0 0 0 3.5px ${MEMBER_RING}, 0 2px 5px rgba(0,0,0,0.35)`
    : "0 2px 4px rgba(0,0,0,0.3)";
  el.innerHTML = `<div style="width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;background:#fff;border:2px solid ${ring};box-shadow:${shadow};transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;">
    <span style="transform:rotate(45deg);font-size:${member ? 17 : 15}px;line-height:1;">${emoji}</span>
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

/**
 * Photos for a built-in parking-zone popup. Escapes all user text.
 *
 * ONE photo, not the whole set: a map popup is a 230px box anchored to a pin,
 * and a stack of images inside it pushes the rule — the thing the visitor
 * tapped for — off the bottom of the screen on a phone. The rest of a zone's
 * photos are shown in the page's "Every lot, in words" list, which has the room
 * for them. `alt` is resolved server-side (src/lib/map/parking-photos.ts), and
 * carried through to the img so a popup is not a hole in the a11y story.
 */
function zonePhotosHtml(photos: ParkingPhoto[] | undefined): string {
  const first = photos?.[0];
  if (!first) return "";
  const credit = first.credit
    ? `<p style="margin:2px 0 0;font-size:0.68rem;color:#6b7683;">Photo: ${esc(first.credit)}</p>`
    : "";
  return `<img src="${esc(first.src)}" alt="${esc(first.alt)}" loading="lazy" style="display:block;width:100%;max-width:210px;border-radius:6px;margin-top:6px;" />${credit}`;
}

/** Shared popup body for a custom feature. Escapes all user text. */
function featurePopupHtml(f: MapFeature): string {
  const parts: string[] = [
    `<p style="margin:0;font-weight:600;font-size:0.95rem;">${esc(f.title)}</p>`,
  ];
  // Says in words what the pin's outer ring says in colour — the ring alone
  // would leave the fact invisible to anyone who can't distinguish it.
  if (f.member) {
    parts.push(
      `<p style="margin:4px 0 0;"><span style="display:inline-block;padding:1px 8px;border-radius:9999px;font-size:0.72rem;font-weight:600;color:#fff;background:${MEMBER_RING};">Chamber member</span></p>`,
    );
  }
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
  shape: "pin" | "line" | "dash" | "swatch" | "dot" | "pr";
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
  basemap = "map",
  basemapToggle = false,
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
  /**
   * Which base layer to open on. Defaults to the self-hosted vector map, so
   * every existing caller is unchanged and makes no third-party request.
   * "satellite" is /parking's default — see SATELLITE_TILE_URL in basemap.ts.
   */
  basemap?: BasemapMode;
  /** Show the on-map Map/Satellite switch. */
  basemapToggle?: boolean;
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
  // it; a tap unlocks panning. Always false on desktop (fine pointer). Shared
  // with the two ferry maps so all three behave and read the same.
  // Destructured because the build effect below depends on `applyTouchLock`:
  // the hook's callbacks are stable, the object it returns is not, so naming
  // the callback keeps the dependency honest without re-running on every render.
  const { locked: touchLocked, applyTo: applyTouchLock, unlock: unlockTouch } = useMapTouchLock();
  // The visitor's PREFERENCE. What actually renders is `effectiveMode` below,
  // which can override it when there is no network to fetch imagery over.
  const [mode, setMode] = useState<BasemapMode>(basemap);
  /**
   * False when the map was built with the network already gone.
   *
   * Satellite tiles are third-party, and public/sw.js only ever intercepts
   * SAME-ORIGIN requests — so no service worker can cache them and imagery
   * simply cannot paint offline. The vector base can: E31 Phase 7 precaches a
   * downtown slice for exactly this moment (a visitor who loses signal at the
   * ferry dock and still needs the parking map). Falling back to it is what
   * keeps that promise intact now that /parking opens on satellite.
   *
   * Decided ONCE at init, matching basemapArchiveUrl()'s documented rule and
   * for the same reason: swapping a base layer mid-session re-fetches the world
   * for an edge nobody is standing in. A session that started online keeps the
   * imagery option even if the network drops (already-loaded tiles stay up);
   * a reload is what re-evaluates.
   */
  const [imageryAvailable, setImageryAvailable] = useState(true);
  const effectiveMode: BasemapMode = imageryAvailable ? mode : "map";
  // The build effect below must NOT re-run on a toggle — rebuilding the map
  // would drop every pin and re-fit the view just to change the base layer — so
  // it reads the current mode through a ref instead of taking it as a dependency.
  const modeRef = useRef<BasemapMode>(basemap);

  // Follow the prop if a parent changes it.
  useEffect(() => {
    setMode(basemap);
  }, [basemap]);

  // Apply a mode change to the LIVE map. Before the style has loaded there are
  // no layers to flip, and draw() applies modeRef.current once there are.
  useEffect(() => {
    modeRef.current = effectiveMode;
    const map = mapRef.current;
    if (!map) return;
    // Deliberately NOT gated on isStyleLoaded(): that returns false while ANY
    // source is still unloaded, so a stalled or failing vector archive would
    // make the toggle silently do nothing. Both helpers guard every layer
    // lookup themselves, which is the precondition that actually matters.
    applyBasemapMode(map, effectiveMode);
    applyOverlayContrast(map, effectiveMode);
  }, [effectiveMode]);

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
    let cleanupReveal: () => void = () => {};
    const container = containerRef.current;
    if (!container) return;

    const legendEntries = new Map<string, LegendEntry>();
    const addLegend = (e: LegendEntry) => {
      if (!legendEntries.has(e.key)) legendEntries.set(e.key, e);
    };

    const init = async () => {
      // Same single check, at the same moment, as basemapArchiveUrl() — which
      // is already choosing the precached offline slice on this exact signal.
      // Written to the ref as well as to state so draw() cannot race a render
      // and light up an imagery layer that has no network to fetch from.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        modeRef.current = "map";
        setImageryAvailable(false);
      }
      const maplibregl = await loadMapLibre();
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: mapStyle(basemapArchiveUrl()),
        center: [view.view.center[1], view.view.center[0]],
        zoom: view.view.zoom,
        scrollZoom: false, // don't hijack page scroll; pinch/± still zoom
      });
      mapRef.current = map;

      // Bring the chosen base up as soon as the STYLE has parsed, rather than
      // waiting for draw() — which runs on `load`, and `load` waits for EVERY
      // source to finish. The vector archive (R2, via our proxy) and the
      // imagery (Esri) are independent services with independent failure
      // modes, and this app has already had one R2 outage that 502'd the tile
      // proxy. Without this, that outage would blank /parking completely even
      // though the imagery it defaults to was serving fine.
      //
      // `on`, not `once`: the style can re-parse, and both helpers are cheap
      // no-ops when nothing changed (MapLibre's set*Property early-returns on
      // an unchanged value). Overlay contrast still has to run again at the end
      // of draw(), where the fm-* layers finally exist.
      const applyBase = () => {
        if (mapRef.current !== map) return;
        applyBasemapMode(map, modeRef.current);
        applyOverlayContrast(map, modeRef.current);
      };
      map.on("styledata", applyBase);
      // MapLibre names every canvas region "Map"; two maps on one page then
      // fail axe's landmark-unique (seen on /ferry and /line, which render the
      // vessel map and the SR-104 map together). Each map component sets its
      // own canvas name so the landmarks stay distinguishable.
      map.getCanvas().setAttribute("aria-label", "Kingston map");
      // Test-only hook (the editor's __vkDraw pattern): screenshot/verify
      // drives need a map handle to frame deterministic views. Inert unless
      // the harness set the flag before load.
      if ((window as unknown as { __vkTestHooks?: boolean }).__vkTestHooks) {
        ((window as unknown as { __vkMaps?: MapLibreMap[] }).__vkMaps ??= []).push(map);
      }
      // Leaflet showed +/- buttons by default; with scrollZoom off they are the
      // only mouse way to zoom, so MapLibre needs them added explicitly.
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      // On touch devices a full-width map otherwise eats the page's vertical
      // swipes: disable panning until the visitor taps to activate.
      applyTouchLock(map);

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
        // The chip only repeats the name its pin already announces.
        fixMarkerA11y(marker, null);
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
      // Member-flagged drawn areas (building footprints). App-side features
      // only — anonymous tile buildings stay achromatic per ADR-0007; the
      // membership fact lives in OUR data, never in the tiles.
      const memberAreas: ReturnType<typeof polyFeature>[] = [];
      const circles: { lngLat: LngLat; color: string; popup: string }[] = [];
      // Street-parking curb strokes (E31 phase 6): rendered in their own layer
      // because line-offset places each stroke against the correct curb.
      const curbStrokes: ReturnType<typeof lineFeature>[] = [];

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
          const featureMarker = new maplibregl.Marker({ element: pinEl(cat.emoji, ring, f.member === true), anchor: "bottom" })
            .setLngLat(toLngLat(f.point))
            .setPopup(markerPopup(featurePopupHtml(f)))
            .addTo(map);
          fixMarkerA11y(featureMarker, f.title);
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
          const popup = featurePopupHtml(f);
          // Does the area carry a colour of its OWN (parking auto-colour or a
          // manual pick)? The AREA_COLOR fallback is a generic default, not a
          // meaning — only a real category colour is protected from repaint.
          const ownColor =
            Boolean(f.color) || Boolean(f.parking && parkingTypeInfo(f.parking.type));
          // Member geometry gets an explicitly CLOSED ring: areas are stored
          // as open rings (E32 wire format), which MapLibre's fill layer
          // auto-closes but a LINE layer does not — an open ring leaves the
          // wide member band with rounded end-caps ("lobes") at the start
          // vertex instead of a mitred corner.
          const closedRing =
            f.polygon.length >= 3 &&
            (f.polygon[0][0] !== f.polygon[f.polygon.length - 1][0] ||
              f.polygon[0][1] !== f.polygon[f.polygon.length - 1][1])
              ? [...f.polygon, f.polygon[0]]
              : f.polygon;
          if (f.member === true && !ownColor) {
            // A traced member building footprint: the member family owns the
            // fill + boundary, the same treatment as the runtime-matched
            // "member built" tier above, so a hand-traced footprint and a
            // matched tile building read as one thing. (#140's channel rule
            // holds trivially — there is no category colour here to repaint.)
            memberAreas.push(
              polyFeature(closedRing, { popup, tint: MEMBER_AREA_OPACITY, ring: 2.5, casing: 0 }),
            );
            addLegend({
              key: "member-area",
              label: "Chamber member",
              color: MEMBER_RING,
              shape: "swatch",
            });
          } else {
            if (f.member === true) {
              // Member area WITH its own colour: membership ADDS, it never
              // repaints (#140). The colour fill/outline below render exactly
              // as for a non-member; a member-blue casing with a white gap
              // goes UNDER the colour outline — the areas analogue of the
              // pin's concentric outer ring, gap and all.
              memberAreas.push(polyFeature(closedRing, { popup, tint: 0, ring: 9, casing: 1 }));
            }
            fills.push(polyFeature(f.polygon, { color, popup }));
            const pl = parkingLegend(f, color, "swatch");
            addLegend(pl ?? { key: "kind-area", label: "Area", color, shape: "swatch" });
          }
          f.polygon.forEach((p) => pts.push(toLngLat(p)));
        }
      }

      // ---- built-ins: restaurants (category-aware pins) ----
      for (const r of view.builtins.restaurants ?? []) {
        const cat = markerCategory(r.category);
        const restaurantMarker = new maplibregl.Marker({ element: pinEl(cat.emoji, cat.color), anchor: "bottom" })
          .setLngLat([r.lng, r.lat])
          .setPopup(markerPopup(restaurantPopupHtml(r)))
          .addTo(map);
        fixMarkerA11y(restaurantMarker, r.name);
        pts.push([r.lng, r.lat]);
        addLabel([r.lng, r.lat], resolveLabel({ title: r.label?.text ?? r.name, category: r.category }));
        addLegend({ key: `builtin-restaurant-${cat.key}`, label: cat.label, color: cat.color, shape: "pin", emoji: cat.emoji });
      }

      // ---- built-ins: parking zones ----
      for (const z of view.builtins.parkingZones ?? []) {
        const color = parkingColor(z.rule);
        const curbRow = z.curb && CURB_LABELS[z.curb]
          ? `<p style="margin:4px 0 0;font-weight:600;color:${color};">Applies to ${esc(CURB_LABELS[z.curb])}</p>`
          : "";
        const popup = `<div style="font-size:0.8rem;line-height:1.35;max-width:230px;">
          <p style="margin:0;font-weight:600;font-size:0.95rem;">${esc(z.name)}</p>
          <p style="margin:4px 0 0;">${esc(z.summary)}</p>
          ${curbRow}
          ${zonePhotosHtml(z.photos)}
        </div>`;

        if (z.rule === "park-and-ride-24h") {
          // The "leave the car here" lots: a distinct P&R badge + an early,
          // high-priority name label instead of an anonymous circle.
          const prMarker = new maplibregl.Marker({ element: prPinEl(), anchor: "center" })
            .setLngLat(toLngLat(z.center))
            // Smaller offset than markerPopup(): the badge is center-anchored,
            // not a 34px teardrop.
            .setPopup(new maplibregl.Popup({ offset: [0, -18], maxWidth: "240px" }).setHTML(popup))
            .addTo(map);
          fixMarkerA11y(prMarker, z.name);
          pts.push(toLngLat(z.center));
          addLabel(
            toLngLat(z.center),
            resolveLabel({
              title: z.name,
              // Identity, not repetition: the badge already says P&R.
              label: { text: z.name.replace(/\s*park\s*&\s*ride$/i, ""), priority: 45 },
            }),
          );
          addLegend({
            key: "parking-pr",
            label: "Park & ride — leave the car, ride the bus",
            color: parkingColor(z.rule),
            shape: "pr",
          });
          continue;
        }

        if (z.streetPaths && z.streetPaths.length > 0) {
          // Street zone (E31 phase 6): curb-hugging offset strokes replace the
          // old centre pin. Unknown side = one centre-line stroke (honesty
          // rule); "both" = a stroke against each curb.
          for (const path of z.streetPaths) {
            if (path.length < 2) continue;
            for (const sign of curbOffsetSigns(path, z.curb)) {
              curbStrokes.push(lineFeature(path, { color, popup, offsetSign: sign }));
            }
            path.forEach((p) => pts.push(toLngLat(p)));
          }
          addLegend({
            key: `parking-street-${z.rule}`,
            label: `Street: ${PARKING_RULE_LABELS[z.rule] ?? z.rule}`,
            color,
            shape: "line",
          });
          continue;
        }

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

        // ---- member buildings ------------------------------------------
        // "Built" vs "member built". The basemap's buildings come from our
        // OSM-derived PMTiles, which carry no membership attribute, so a
        // member's footprint cannot be styled from the tile data. Instead we
        // ask the renderer what building is under each member's point and copy
        // that polygon into our own GeoJSON source.
        //
        // Deliberately best-effort, and it degrades to nothing visible:
        //  - queryRenderedFeatures only sees CURRENTLY RENDERED tiles, so this
        //    re-runs on move/zoom and fills in footprints as they come into
        //    view. Matches are cached; a building already found stays found.
        //  - the basemap's buildings layer is minzoom 13, so below that there
        //    is nothing to match and no highlight appears.
        //  - where OSM has no footprint (or the point sits on a park), there is
        //    simply no match. The pin's member ring still marks the location,
        //    which is why this can fail quietly without losing information.
        //  - returned geometry is tile-clipped, so a building straddling a tile
        //    boundary can highlight as a partial polygon.
        const memberPts = view.features.filter(
          (f): f is MapFeature & { point: [number, number] } =>
            f.kind === "marker" && f.member === true && Array.isArray(f.point),
        );
        if (memberPts.length && map.getLayer("buildings")) {
          const matched = new Map<string, GeoJSON.Feature>();
          map.addSource("fm-member-buildings", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          // Under roads/labels, over the plain buildings fill.
          const beforeId = map.getLayer("roads") ? "roads" : undefined;
          map.addLayer(
            {
              id: "fm-member-buildings",
              type: "fill",
              source: "fm-member-buildings",
              paint: { "fill-color": MEMBER_RING, "fill-opacity": MEMBER_BUILDING_OPACITY },
            },
            beforeId,
          );
          map.addLayer(
            {
              id: "fm-member-buildings-outline",
              type: "line",
              source: "fm-member-buildings",
              paint: { "line-color": MEMBER_RING, "line-width": 1.5 },
            },
            beforeId,
          );

          const syncMemberBuildings = () => {
            if (cancelled || !map.getLayer("buildings")) return;
            const { width, height } = map.getCanvas();
            let added = false;
            for (const f of memberPts) {
              if (matched.has(f.id)) continue;
              const p = map.project(toLngLat(f.point));
              // Off-screen points have no rendered tile to query.
              if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) continue;
              const hit = map.queryRenderedFeatures(p, { layers: ["buildings"] })[0];
              if (!hit?.geometry) continue;
              matched.set(f.id, { type: "Feature", properties: {}, geometry: hit.geometry });
              added = true;
            }
            if (!added) return;
            const src = map.getSource("fm-member-buildings");
            if (src && "setData" in src) {
              (src as maplibregl.GeoJSONSource).setData({
                type: "FeatureCollection",
                features: [...matched.values()],
              });
            }
          };
          syncMemberBuildings();
          map.on("idle", syncMemberBuildings);
        }

        // Add geometry sources + layers (fills under lines under circles).
        const addGeo = (id: string, features: GeoJSON.Feature[]) => {
          map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features } });
        };
        const wirePopup = (layerId: string) => {
          map.on("click", layerId, (e) => {
            // One popup per tap: wired layers can overlap (the invisible curb
            // hit band over a centre stroke, fills under lines) and each
            // layer's handler fires for the same click — without this guard a
            // single tap would stack popups.
            const oe = e.originalEvent as MouseEvent & { _fmPopupDone?: boolean };
            if (oe._fmPopupDone) return;
            const f = e.features?.[0] as { properties?: { popup?: string } } | undefined;
            const html = f?.properties?.popup;
            if (html) {
              oe._fmPopupDone = true;
              new maplibregl.Popup({ maxWidth: "240px" }).setLngLat(e.lngLat).setHTML(html).addTo(map);
            }
          });
          map.on("mouseenter", layerId, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", layerId, () => (map.getCanvas().style.cursor = ""));
        };

        if (fills.length) {
          addGeo("fm-fills", fills);
          map.addLayer({ id: "fm-fills", type: "fill", source: "fm-fills", paint: { "fill-color": ["get", "color"], "fill-opacity": BASE_FILL_OPACITY } });
          // White casing under the outline — inert (opacity 0) on the vector
          // base, lit by applyOverlayContrast() over imagery.
          map.addLayer({ id: "fm-fills-casing", type: "line", source: "fm-fills", layout: { "line-join": "round" }, paint: { "line-color": CASING_COLOR, "line-width": 5, "line-opacity": 0 } });
          map.addLayer({ id: "fm-fills-outline", type: "line", source: "fm-fills", paint: { "line-color": ["get", "color"], "line-width": 2 } });
          wirePopup("fm-fills");
        }
        // Member-flagged drawn areas. Slotted around the fm-fills pair on
        // purpose: an own-colour member area lives in BOTH sources, and the
        // sandwich (colour fill → member band → white gap → colour outline)
        // is what renders the concentric edge — colour core, white gap,
        // member-blue band — mirroring the member pin's category ring /
        // white gap / outer ring, with no half of the band washed by the
        // translucent colour fill.
        if (memberAreas.length) {
          addGeo("fm-member-areas", memberAreas);
          map.addLayer(
            {
              id: "fm-member-areas",
              type: "fill",
              source: "fm-member-areas",
              // tint = MEMBER_AREA_OPACITY for a plain traced footprint, 0
              // for an own-colour area (the colour keeps its fill; membership
              // is the boundary treatment + popup text there).
              paint: { "fill-color": MEMBER_RING, "fill-opacity": ["get", "tint"] },
            },
            map.getLayer("fm-fills") ? "fm-fills" : undefined,
          );
          const beforeOutline = map.getLayer("fm-fills-outline") ? "fm-fills-outline" : undefined;
          map.addLayer(
            {
              id: "fm-member-areas-ring",
              type: "line",
              source: "fm-member-areas",
              layout: { "line-join": "round" },
              paint: { "line-color": MEMBER_RING, "line-width": ["get", "ring"] },
            },
            beforeOutline,
          );
          // The white gap between the member band and the colour outline —
          // same job as the pin's 1px white gap: the two never read as one
          // thick band, and the band stays structurally visible even if an
          // admin picks an area colour near the member blue (not colour-alone).
          map.addLayer(
            {
              id: "fm-member-areas-gap",
              type: "line",
              source: "fm-member-areas",
              filter: ["==", ["get", "casing"], 1],
              layout: { "line-join": "round" },
              paint: { "line-color": "#ffffff", "line-width": 5 },
            },
            beforeOutline,
          );
          wirePopup("fm-member-areas");
        }
        if (curbStrokes.length) {
          addGeo("fm-curbs", curbStrokes);
          // Data-driven SIGN × zoom-driven magnitude. The zoom expression must
          // be the top-level interpolate input, so the per-feature sign lives
          // in the output terms. Shared by the visible stroke and its hit twin
          // so the tap band tracks the drawn curb exactly.
          const curbOffset: ExpressionSpecification = [
            "interpolate", ["linear"], ["zoom"],
            13, ["*", ["get", "offsetSign"], 1.5],
            16, ["*", ["get", "offsetSign"], 4.5],
            18, ["*", ["get", "offsetSign"], 10],
          ];
          // Curb casing: same offset expression, a little wider, so the white
          // backing tracks the drawn curb exactly instead of drifting off it.
          map.addLayer({
            id: "fm-curbs-casing",
            type: "line",
            source: "fm-curbs",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": CASING_COLOR,
              "line-width": ["interpolate", ["linear"], ["zoom"], 13, 5, 16, 7, 18, 9.5],
              "line-opacity": 0,
              "line-offset": curbOffset,
            },
          });
          map.addLayer({
            id: "fm-curbs",
            type: "line",
            source: "fm-curbs",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": ["get", "color"],
              // Grow with zoom so the stroke reads as "this curb", not a road.
              "line-width": ["interpolate", ["linear"], ["zoom"], 13, 2.5, 16, 4, 18, 6],
              "line-opacity": 0.9,
              "line-offset": curbOffset,
            },
          });
          // Invisible fat twin of the stroke: the visible curb is only
          // 2.5–6 px wide — a meaner tap target than the 7 px circles it
          // replaced. Opacity-0 lines still hit-test, so popups + cursor are
          // wired HERE and only here (wiring both layers would double-fire
          // the click handler for one tap on the visible stroke).
          map.addLayer({
            id: "fm-curbs-hit",
            type: "line",
            source: "fm-curbs",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#000", "line-opacity": 0, "line-width": 20, "line-offset": curbOffset },
          });
          wirePopup("fm-curbs-hit");
        }
        if (solidLines.length) {
          addGeo("fm-lines", solidLines);
          map.addLayer({ id: "fm-lines-casing", type: "line", source: "fm-lines", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": CASING_COLOR, "line-width": ["+", ["coalesce", ["get", "width"], 4], 3], "line-opacity": 0 } });
          map.addLayer({ id: "fm-lines", type: "line", source: "fm-lines", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["coalesce", ["get", "width"], 4], "line-opacity": ["coalesce", ["get", "opacity"], 0.85] } });
          wirePopup("fm-lines");
        }
        if (dashedLines.length) {
          addGeo("fm-dashed", dashedLines);
          // Deliberately UNdashed: a solid white backing under coloured dashes
          // is the classic cased-dash treatment and keeps the dash pattern
          // readable over photography, where a dashed casing would just add
          // more noise to noise.
          map.addLayer({ id: "fm-dashed-casing", type: "line", source: "fm-dashed", layout: { "line-cap": "butt", "line-join": "round" }, paint: { "line-color": CASING_COLOR, "line-width": ["+", ["coalesce", ["get", "width"], 3], 3], "line-opacity": 0 } });
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

        // Base layer LAST, once every overlay layer exists — applyOverlayContrast
        // walks the fm-* layers, so running it earlier would silently skip them.
        applyBasemapMode(map, modeRef.current);
        applyOverlayContrast(map, modeRef.current);

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
    // well inside the viewport before loading, so a map that sits below a page's
    // fold (e.g. the "food map" section on /eat) never loads during the initial
    // paint — keeping it out of the Lighthouse perf budget — while a map that
    // fills the viewport from the top (the dedicated /map, /parking pages) still
    // loads immediately.
    //
    // The inset MUST be a PERCENTAGE, and it must be vertical-only. A fixed
    // "-200px" shorthand applies to all four sides, and a root shrunk by 200 px
    // on both left AND right collapses to zero width on any viewport under
    // 400 CSS px — every non-Max iPhone (375 / 390 / 393). WebKit then reports
    // isIntersecting: false forever, so init() never ran and the map rendered as
    // an empty bordered box on iOS; Blink papers over it by clamping the root to
    // zero width and still intersecting, which is why this survived desktop and
    // Chromium CI. Percentages are resolved against the root's own dimensions,
    // so REVEAL_INSET can never invert the box no matter how small the viewport
    // gets — including a phone in LANDSCAPE (~320 px tall), where even a
    // vertical-only "-200px 0px" would collapse the same way. On a typical phone
    // viewport 25% lands at ~165 px, close to the original 200 px intent.

    // Every route into init() goes through here: it runs at most once, and a
    // rejected init lands in the "error" state instead of vanishing. `void
    // init()` used to swallow the rejection, so a map that failed to build (no
    // WebGL, a style that would not load) left the same silent empty box as a
    // map that was never started — status is already "ready" by this point, so
    // nothing else would ever render an overlay.
    let started = false;
    const start = () => {
      if (started || cancelled) return;
      started = true;
      cleanupReveal();
      init().catch(() => {
        if (!cancelled) setStatus("error");
      });
    };

    if (typeof IntersectionObserver === "undefined") {
      start();
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) start();
        },
        { rootMargin: `-${REVEAL_INSET * 100}% 0px` },
      );
      io.observe(container);

      // Belt and braces. IntersectionObserver's geometry is subtly
      // engine-specific — a collapsed root reads as "never intersecting" on
      // WebKit and "always intersecting" on Blink, which is exactly how the
      // -200px inset above blanked every map on iPhone for ten days. This
      // reimplements the SAME band with a plain rect test off a passive scroll
      // listener, from the same REVEAL_INSET, so the two cannot disagree about
      // when a map is revealed. If the observer is ever wrong again, the map
      // still loads on the next scroll rather than staying dead all session.
      const revealedByRect = () => {
        const r = container.getBoundingClientRect();
        const vh = window.innerHeight;
        return r.top < vh * (1 - REVEAL_INSET) && r.bottom > vh * REVEAL_INSET;
      };
      const onMaybeRevealed = () => {
        if (revealedByRect()) start();
      };
      window.addEventListener("scroll", onMaybeRevealed, { passive: true });
      window.addEventListener("resize", onMaybeRevealed, { passive: true });
      cleanupReveal = () => {
        io.disconnect();
        window.removeEventListener("scroll", onMaybeRevealed);
        window.removeEventListener("resize", onMaybeRevealed);
      };
      // Covers a map that is already in view at mount, where no scroll follows.
      onMaybeRevealed();
    }

    return () => {
      cancelled = true;
      cleanupReveal();
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
  }, [status, data, applyTouchLock]);

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
        {status === "ready" && touchLocked && (
          <MapTouchLockOverlay onUnlock={unlockTouch} />
        )}
        {/* Above the touch-lock overlay (z-450) on purpose: on a phone the lock
            covers the whole canvas, and having to unlock the map before you can
            change what it shows would be a trap. Switching the base layer is
            not panning, so it does not need the map unlocked. */}
        {status === "ready" && basemapToggle && (
          <BasemapSwitch
            mode={effectiveMode}
            onChange={setMode}
            imageryAvailable={imageryAvailable}
          />
        )}
      </div>
      {status === "ready" && legend.length > 0 && <MapLegend entries={legend} />}
    </div>
  );
}

/**
 * The Map / Satellite switch.
 *
 * A radio GROUP, not a single toggle button: with two named options a screen
 * reader announces both the choice and which one is active, where a lone
 * "Satellite" button would leave "pressed or not?" to be inferred. Top-LEFT
 * because MapLibre's zoom control owns top-right.
 *
 * Sized to the E14 floor (44px min target) and painted opaque — it sits over
 * aerial photography half the time, so nothing here may depend on the map
 * pixels behind it.
 */
function BasemapSwitch({
  mode,
  onChange,
  imageryAvailable,
}: {
  mode: BasemapMode;
  onChange: (m: BasemapMode) => void;
  imageryAvailable: boolean;
}) {
  const options: { key: BasemapMode; label: string }[] = [
    { key: "map", label: "Map" },
    { key: "satellite", label: "Satellite" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Base map style"
      className="absolute left-3 top-3 z-[460] flex overflow-hidden rounded-full border border-sand bg-white shadow-md"
    >
      {options.map((o) => {
        const active = mode === o.key;
        // Offline, satellite is not a choice that can be honoured — say so on
        // the control rather than letting a tap produce an empty grey map and
        // leave the visitor wondering what they broke.
        const unavailable = o.key === "satellite" && !imageryAvailable;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={unavailable}
            title={unavailable ? "Satellite view needs an internet connection" : undefined}
            onClick={() => onChange(o.key)}
            className={`min-h-[44px] px-4 text-sm font-semibold transition-colors ${
              active
                ? "bg-sound-deep text-white"
                : unavailable
                  ? "cursor-not-allowed bg-white text-ink-soft"
                  : "bg-white text-ink hover:bg-shell"
            }`}
          >
            {o.label}
            {unavailable && <span className="sr-only"> (needs an internet connection)</span>}
          </button>
        );
      })}
    </div>
  );
}

const PIN_CSS = `
.feature-pin { background: transparent; border: none; }
.fm-pr-pin {
  display: inline-block;
  padding: 3px 7px;
  border-radius: 8px;
  /* ADR-0007: brand coral-deep — white text is 6.69:1 here (the old #e8891d
     orange was 2.62:1, a live WCAG AA failure at this size). */
  background: #8a4c22;
  color: #fff;
  font: 800 0.75rem/1.1 system-ui, -apple-system, sans-serif;
  letter-spacing: .02em;
  border: 2px solid #fff;
  box-shadow: 0 2px 5px rgba(0,0,0,.35);
  cursor: pointer;
}
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
    case "pr":
      return (
        <span
          aria-hidden
          className="inline-block rounded-[5px] px-1 text-[0.5625rem] leading-[0.875rem] font-extrabold text-white"
          style={{ backgroundColor: entry.color }}
        >
          P&R
        </span>
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
  // tabindex + name: with enough entries (prod's parking view at 390px) the
  // max-h-28 list actually scrolls, and a scrollable region with no focusable
  // content is unreachable by keyboard (axe scrollable-region-focusable,
  // serious). The class list is load-bearing — globals.css keys an E14
  // contrast override on `ul.max-h-28.overflow-y-auto.text-ink-soft`.
  return (
    <ul
      tabIndex={0}
      aria-label="Map legend"
      className="mt-3 flex max-h-28 flex-wrap gap-x-4 gap-y-2 overflow-y-auto text-sm text-ink-soft"
    >
      {entries.map((e) => (
        <li key={e.key} className="flex items-center gap-1.5">
          <LegendSwatch entry={e} />
          {e.label}
        </li>
      ))}
    </ul>
  );
}
