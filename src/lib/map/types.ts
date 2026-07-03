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

export interface MapFeature {
  id: string;
  kind: FeatureKind;
  title: string;
  notes?: string;
  /** Marker icon category (see MARKER_CATEGORIES). Ignored for non-markers. */
  category?: string;
  /** Hex color for line/trail/area stroke+fill, or a marker tint override. */
  color?: string;
  /** Relative image path served by /api/map/image?p=… */
  imageUrl?: string;
  /** One or more stored image names (served by /api/map/image?p=). */
  images?: string[];
  /** When set, feature is a parking area; color is automatic. */
  parking?: ParkingMeta;
  link?: string;
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

export function markerCategory(key: string | undefined) {
  return MARKER_CATEGORIES.find((c) => c.key === key) ?? MARKER_CATEGORIES[MARKER_CATEGORIES.length - 2]; // default "info"
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
