// E33 — pure selection logic behind /line's "reachable from the line"
// sections, kept out of the components so the open-now filter and the amenity
// honesty split are unit-testable without rendering anything.
//
// Privacy note: everything here is arithmetic over PUBLIC seed/store data and
// the fixed line geometry. Nothing reads or receives a visitor position — the
// page ranks places against the LINE, not against the person (the
// transmit-nothing floor is satisfied by never transmitting because never
// collecting).

import {
  distanceToLineMeters,
  HOLDING_ROUTE,
  LINE_TERMINAL,
  LINE_WEST_OF_DISPENSER,
} from "./ferry-line-geometry";
import { haversineMeters, walkMinutes } from "./geo";
import { getOpenStatus } from "./hours";
import type { MapFeature } from "./map/types";
import type { Restaurant } from "./types";

/** One open-now restaurant, ranked by straight-line distance to the line. */
export interface LineFoodRow {
  restaurant: Restaurant;
  /** Straight-line meters to the nearest point of the SR-104 holding line. */
  lineMeters: number;
  /** ~walking minutes for that straight line (under-states a real walk). */
  lineWalkMinutes: number;
}

/**
 * Restaurants worth showing to someone parked in the line RIGHT NOW: public
 * (not hidden), verifiably open at `now` per their structured weeklyHours, and
 * sorted nearest-to-the-line first. Places without structured hours are
 * excluded rather than shown with a shrug — "order ahead from the line" is
 * only honest advice when the kitchen is provably open.
 */
export function openFoodFromLine(restaurants: Restaurant[], now: Date = new Date()): LineFoodRow[] {
  return restaurants
    .filter((r) => !r.hidden && r.weeklyHours && getOpenStatus(r.weeklyHours, now).open)
    .map((r) => {
      const lineMeters = distanceToLineMeters(r.lat, r.lng, HOLDING_ROUTE);
      return { restaurant: r, lineMeters, lineWalkMinutes: walkMinutes(lineMeters) };
    })
    .sort(
      (a, b) => a.lineMeters - b.lineMeters || a.restaurant.name.localeCompare(b.restaurant.name),
    );
}

/** One safety-critical amenity with its distance from the line's waiting stretch. */
export interface LineAmenityRow {
  feature: MapFeature;
  lat: number;
  lng: number;
  /** Straight-line meters from the WEST-OF-DISPENSER stretch — where the
   *  page's audience is actually parked, NOT the full route (whose terminal
   *  end would flatter everything at the dock). */
  lineMeters: number;
  lineWalkMinutes: number;
}

/** The only categories the truth block is about. Benches can wait; a restroom
 *  cannot (same split as nearest-amenity.tsx SAFETY_CRITICAL). */
const LINE_AMENITY_CATEGORIES = ["restroom", "water"] as const;

/**
 * The honesty threshold: an amenity counts as "walkable from the line" only
 * within this many ~minutes of the west-of-Lindvog stretch. Ten minutes of
 * STRAIGHT-LINE walking — which under-states the real walk (geo.ts) — is
 * already a rough round trip against a line that creeps; past it, telling a
 * stressed driver "there's a restroom near you" stops being help and starts
 * being a trap. With today's sourced data (two dock-area restrooms, M-19-03)
 * nothing qualifies, so the page renders the honest empty state.
 */
export const WALKABLE_FROM_LINE_MAX_MIN = 10;

export interface LineAmenitySplit {
  /** Within WALKABLE_FROM_LINE_MAX_MIN of the waiting stretch, nearest first. */
  walkable: LineAmenityRow[];
  /** Everything else — in practice the dock/terminal facilities — nearest the
   *  terminal end first (the order a driver will reach them). */
  atTerminal: LineAmenityRow[];
}

/**
 * Split the mapped safety-critical amenities into "genuinely walkable from the
 * waiting stretch" vs "waiting for you at the terminal".
 *
 * TODO(E33 Open question 2): the "nothing walkable from mid-line" claim still
 * needs Chamber ground-truth — someone who knows the highway confirming there
 * is truly nothing (a church lot? a business that tolerates line-sitters?)
 * west of Lindvog. Until then this stays purely data-driven over the sourced
 * amenity layer (M-19-03): if the Chamber maps a real one at /admin/maps it
 * appears here with no deploy, and nothing is invented in the meantime.
 */
export function splitAmenitiesFromLine(features: MapFeature[]): LineAmenitySplit {
  const rows: LineAmenityRow[] = features
    .filter(
      (f): f is MapFeature & { point: [number, number] } =>
        f.kind === "marker" &&
        Array.isArray(f.point) &&
        (LINE_AMENITY_CATEGORIES as readonly string[]).includes(f.category ?? ""),
    )
    .map((f) => {
      const [lat, lng] = f.point;
      const lineMeters = distanceToLineMeters(lat, lng, LINE_WEST_OF_DISPENSER);
      return { feature: f, lat, lng, lineMeters, lineWalkMinutes: walkMinutes(lineMeters) };
    });

  const walkable = rows
    .filter((r) => r.lineWalkMinutes <= WALKABLE_FROM_LINE_MAX_MIN)
    .sort((a, b) => a.lineMeters - b.lineMeters || a.feature.title.localeCompare(b.feature.title));
  const distToTerminal = (r: LineAmenityRow) =>
    haversineMeters(LINE_TERMINAL[0], LINE_TERMINAL[1], r.lat, r.lng);
  const atTerminal = rows
    .filter((r) => r.lineWalkMinutes > WALKABLE_FROM_LINE_MAX_MIN)
    .sort(
      (a, b) => distToTerminal(a) - distToTerminal(b) || a.feature.title.localeCompare(b.feature.title),
    );
  return { walkable, atTerminal };
}
