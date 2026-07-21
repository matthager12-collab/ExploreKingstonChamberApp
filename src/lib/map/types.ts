// Domain model for the general-purpose map CMS.
//
// A MapView is a named, reusable map configuration ("food-drink", "parking",
// "trails", …). A MapFeature is a drawn thing (marker, line, trail, area) that
// declares which views it appears on. Views can also pull in built-in data
// layers (restaurants, parking zones, street overlay) so the Chamber
// doesn't re-enter data that already lives in the app.
//
// Everything is portal-editable: seed views/features ship in src/lib/data,
// admin edits overlay them in .data/stores (see map-store.ts).

import type { CostValue } from "@/lib/cost";

export type FeatureKind = "marker" | "line" | "trail" | "area";

/** Built-in data layers a view can include without re-entering data. */
export type BuiltInSource = "restaurants" | "parking-zones" | "streets";

export interface MapView {
  id: string; // slug, e.g. "food-drink"
  name: string;
  description?: string;
  center: [number, number];
  zoom: number;
  /** Built-in layers to render alongside this view's custom features. */
  sources: BuiltInSource[];
  /** false hides the view from the public /map switcher (admin-only draft). */
  published: boolean;
}

export type LabelShow = "auto" | "on" | "off";
export type LabelDir = "auto" | "top" | "right" | "bottom" | "left";

/** On-map name-label config for a feature. All fields optional → smart defaults. */
export interface MapLabel {
  /** Short on-map label; when unset, derived from title via shortenTitle(). */
  text?: string;
  /** auto = declutter decides by zoom+priority; on = always; off = never. */
  show?: LabelShow;
  /** Placement relative to the pin. auto currently resolves to "top". */
  dir?: LabelDir;
  /** −50..+50 admin nudge, merged with the category rank. Default 0. */
  priority?: number;
}

export interface MapFeature {
  id: string;
  kind: FeatureKind;
  title: string;
  notes?: string;
  /** Marker icon category (see MARKER_CATEGORIES). Ignored for non-markers. */
  category?: string;
  /** E27 (M-04-06): does this cost a visitor money? Rendered as the shared
   *  text CostBadge. Distinct from `parking` metadata's own free/paid taxonomy
   *  below — see src/lib/cost.ts for why the two are kept apart. */
  cost?: CostValue;
  /** Hex color for line/trail/area stroke+fill, or a marker tint override. */
  color?: string;
  /** Relative image path served by /api/map/image?p=… */
  imageUrl?: string;
  /** One or more stored image names (served by /api/map/image?p=). */
  images?: string[];
  /** When set, feature is a parking area; color is automatic. */
  parking?: ParkingMeta;
  link?: string;
  /** On-map name label + overrides. Absent = all smart defaults. */
  label?: MapLabel;
  /** MapView ids this feature appears on. */
  views: string[];
  // Geometry — exactly one is set, matching `kind`:
  point?: [number, number]; // marker
  path?: [number, number][]; // line / trail
  polygon?: [number, number][]; // area
}

export type ParkingType =
  | "paid" | "free" | "free-timed" | "permit" | "park-and-ride" | "load-zone" | "no-parking";

export const PARKING_TYPES = [
  { key: "paid",          label: "Paid lot",            color: "#7c4dbe" },
  { key: "free",          label: "Free",                color: "#2e9e4f" },
  { key: "free-timed",    label: "Free · time-limited", color: "#1e96c0" },
  { key: "permit",        label: "Permit / commuter",   color: "#6b7280" },
  { key: "park-and-ride", label: "Park & ride",         color: "#e8891d" },
  { key: "load-zone",     label: "Load / 15-min zone",  color: "#f0b429" },
  { key: "no-parking",    label: "No parking",          color: "#d43d3d" },
] as const;

export function parkingTypeInfo(key: string | undefined) {
  return PARKING_TYPES.find((t) => t.key === key);
}

export interface ParkingMeta {
  type: ParkingType;
  owner?: string;
  phone?: string;
  paymentMethod?: string;   // e.g. "Text-to-pay", "Kiosk (card)", "PayByPhone"
  paymentLink?: string;     // https URL or app deep link
  paymentNotes?: string;
  timeLimit?: string;       // free text, e.g. "2 hours", "12 hours", "24 hr max"
}

export function featureImages(f: { imageUrl?: string; images?: string[] }): string[] {
  const out = Array.isArray(f.images) ? f.images.filter(Boolean) : [];
  if (f.imageUrl && !out.includes(f.imageUrl)) out.unshift(f.imageUrl);
  return out;
}

/** Fill/stroke color: parking type wins (automatic), else manual color, else fallback. */
export function featureColor(f: { parking?: ParkingMeta | null; color?: string }, fallback: string): string {
  if (f.parking && parkingTypeInfo(f.parking.type)) return parkingTypeInfo(f.parking.type)!.color;
  return f.color || fallback;
}

/** Marker icon palette. `emoji` renders in the divIcon; `color` tints the pin. */
export const MARKER_CATEGORIES = [
  { key: "food", label: "Food", emoji: "🍽️", color: "#d96b4f" },
  { key: "coffee", label: "Coffee", emoji: "☕", color: "#8b5e34" },
  { key: "drink", label: "Drinks", emoji: "🍺", color: "#c99a2e" },
  { key: "shop", label: "Shop", emoji: "🛍️", color: "#7c4dbe" },
  { key: "lodging", label: "Lodging", emoji: "🛏️", color: "#324a6d" },
  { key: "parking", label: "Parking", emoji: "🅿️", color: "#2a7f8a" },
  { key: "restroom", label: "Restroom", emoji: "🚻", color: "#4a7c59" },
  // Practical visitor basics (E27). Kept BEFORE "info"/"star" on purpose:
  // markerCategory() below resolves its default by key, but the public map's
  // category dropdown reads this array in order, and the basics belong beside
  // restroom rather than after the generic pins.
  { key: "water", label: "Drinking water", emoji: "💧", color: "#16758f" },
  { key: "bench", label: "Bench", emoji: "🪑", color: "#6b7683" },
  { key: "picnic", label: "Picnic table", emoji: "🧺", color: "#a85c28" },
  { key: "shade", label: "Shade", emoji: "🌳", color: "#4a7c59" },
  { key: "bin", label: "Trash / recycling", emoji: "🗑️", color: "#6b7683" },
  { key: "viewpoint", label: "Viewpoint", emoji: "📸", color: "#1e96c0" },
  { key: "beach", label: "Beach", emoji: "🏖️", color: "#e8a13a" },
  { key: "trailhead", label: "Trailhead", emoji: "🥾", color: "#4a7c59" },
  { key: "park", label: "Park", emoji: "🌲", color: "#4a7c59" },
  { key: "art", label: "Art / mural", emoji: "🎨", color: "#d96b4f" },
  { key: "event", label: "Event", emoji: "🎉", color: "#d96b4f" },
  { key: "shipwreck", label: "Landmark", emoji: "📍", color: "#16405e" },
  { key: "info", label: "Info", emoji: "ℹ️", color: "#2a7f8a" },
  { key: "star", label: "Highlight", emoji: "⭐", color: "#c99a2e" },
] as const;

export type MarkerCategoryKey = (typeof MARKER_CATEGORIES)[number]["key"];

const DEFAULT_MARKER_CATEGORY =
  MARKER_CATEGORIES.find((c) => c.key === "info") ?? MARKER_CATEGORIES[0];

export function markerCategory(key: string | undefined) {
  // Resolve the fallback by key, not by position: this used to index
  // MARKER_CATEGORIES[length - 2], which silently became a different icon the
  // moment a category was appended (E27 added five). Behavior is unchanged —
  // the default is still "info".
  return MARKER_CATEGORIES.find((c) => c.key === key) ?? DEFAULT_MARKER_CATEGORY;
}

/* ------------------------------------------------------------------ */
/* Label helpers — shared by feature-map.tsx, resolve.ts, the editor   */
/* ------------------------------------------------------------------ */

/** Category → base label rank (0..100). Higher = shows earlier + wins collisions. */
export const CATEGORY_LABEL_RANK: Record<string, number> = {
  star: 85, viewpoint: 82, beach: 80, trailhead: 78, park: 76,
  shipwreck: 72, // the "Landmark" 📍 pin's category key is `shipwreck`, not `landmark`
  lodging: 60, event: 58, art: 55, info: 50,
  food: 50, coffee: 50, drink: 50, shop: 48,
  parking: 30, restroom: 25,
  // Practical basics (E27) rank below restroom so they declutter behind
  // landmarks. All sit under 45, so labelZoomThreshold() already holds them to
  // zoom 16+; these ranks only decide who wins when two amenity labels overlap
  // — and the restroom/water pair (the P0 finder) is meant to win.
  water: 24, picnic: 15, shade: 14, bench: 12, bin: 10,
};
const DEFAULT_LABEL_RANK = 45;

function clampNum(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Effective label priority on one absolute 0..100 scale (category rank + admin nudge). */
export function labelPriority(catKey: string | undefined, nudge = 0): number {
  const rank = CATEGORY_LABEL_RANK[catKey ?? ""] ?? DEFAULT_LABEL_RANK;
  return clampNum(rank + nudge, 0, 100);
}

/** Shorten a long title into a compact map-chip label. Full title stays in the popup. */
export function shortenTitle(title: string): string {
  let t = title.trim();
  t = t.replace(/\s*\([^)]*\)\s*$/, ""); // drop a trailing parenthetical
  t = t.replace(/^the\s+/i, ""); // drop a leading "The "
  const clause = t.split(/\s*[—–]\s+|,\s+|:\s+/)[0]?.trim(); // first clause boundary
  if (clause && clause.length >= 3) t = clause;
  const CAP = 18;
  if (t.length > CAP) {
    const cut = t.slice(0, CAP);
    const sp = cut.lastIndexOf(" ");
    // Break on the last word boundary unless that leaves too little (< 8 chars),
    // in which case hard-cut. `>= 8` so a boundary exactly at 8 still wins
    // (avoids ugly mid-word cuts like "Downtown Waterfron…").
    t =
      (sp >= 8 ? cut.slice(0, sp) : cut)
        .replace(/\s+$/, "")
        .replace(/[\uD800-\uDBFF]$/, "") + // drop a trailing lone high surrogate (split emoji)
      "…";
  }
  return t;
}

/**
 * Single source of truth for a feature's label — consumed by the public map,
 * the restaurants builtin, and (later) the admin preview, so they never drift.
 */
export function resolveLabel(input: {
  title: string;
  category?: string;
  kind?: FeatureKind;
  label?: MapLabel;
}): { text: string; show: LabelShow; dir: LabelDir; priority: number } {
  const l = input.label ?? {};
  const isShape =
    input.kind === "line" || input.kind === "trail" || input.kind === "area";
  return {
    // Fall back to the raw trimmed title if shortening collapses to "" (e.g. a
    // parenthetical-only title) so a chip is never empty — an empty chip is
    // invisible yet still occupies a declutter slot and could hide a neighbor.
    text: l.text?.trim() || shortenTitle(input.title) || input.title.trim(),
    show: l.show ?? (isShape ? "off" : "auto"),
    dir: l.dir ?? "auto",
    priority: clampNum(
      labelPriority(input.category, l.priority ?? 0) - (isShape ? 15 : 0),
      0,
      100,
    ),
  };
}

/**
 * A view's data resolved for rendering: its config, the custom features on it,
 * and lightweight built-in-source payloads the client map draws directly.
 */
export interface ResolvedMapView {
  view: MapView;
  features: MapFeature[];
  builtins: {
    restaurants?: {
      id: string;
      name: string;
      lat: number;
      lng: number;
      walkMinutesFromFerry: number;
      /** MARKER_CATEGORIES key chosen server-side from cuisine/tags. */
      category: string;
      /** Optional name-as-label for the map chip (see resolveLabel). */
      label?: { text?: string; priority?: number };
    }[];
    parkingZones?: {
      id: string;
      name: string;
      rule: string;
      summary: string;
      center: [number, number];
      polygon?: [number, number][];
    }[];
    streets?: boolean; // client fetches /geo/street-parking.json itself when true
  };
}
