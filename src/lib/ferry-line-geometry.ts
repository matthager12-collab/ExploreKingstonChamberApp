// E33 — the SR-104 ferry holding-line geometry, extracted from
// src/components/sr104-traffic-map.tsx so server pages can do distance math
// against the line without importing a MapLibre client component.
// Owns `vk/ferry-line-geometry`.
//
// Pure module: imports only the pure walking-math in ./geo, so it is safe from
// client OR server code (same rule as geo.ts).
//
// PROVENANCE. The polyline is georeferenced from OpenStreetMap SR 104 geometry
// and the Barber Cutoff / Lindvog Rd junctions (see the map component's header
// comment); the operational step locations come from WSDOT's April 2026
// announcement. It is a display/estimate geometry, good to roughly a lane's
// width — fine for "how far is that restaurant from the line", not for legal
// or engineering use.
//
// E25 NOTE (composition contract): E25 Phase 0 moves the canonical queue
// geometry into the map-features store. When that lands, this hardcoded
// polyline becomes the fallback and the store copy is canonical — swap the
// constants below for the store read there, do not fork a third copy.

import { haversineMeters, walkMinutes } from "./geo";

/** [lat, lng] — same order as the map component and map-features. */
export type LatLng = readonly [number, number];

/** The automated boarding-pass dispenser, just west of Lindvog Rd NE. */
export const LINE_DISPENSER: LatLng = [47.8033, -122.5045];

/** The flashing advisory sign at SR 104 & Barber Cutoff Rd. */
export const LINE_FLASHING_SIGN: LatLng = [47.8085, -122.518];

/** The Kingston terminal / tollbooths end of the line. */
export const LINE_TERMINAL: LatLng = [47.7959, -122.4961];

// The ferry holding-lane path along SR 104, ordered terminal → Barber Cutoff
// (traffic flows the other way: in from the west, down to the dock).
export const HOLDING_ROUTE: readonly LatLng[] = [
  LINE_TERMINAL, // terminal / tollbooths
  [47.7967, -122.4966],
  [47.797, -122.4969],
  [47.7976, -122.4974],
  [47.7985, -122.498],
  [47.799, -122.4983],
  [47.7996, -122.4984],
  [47.8003, -122.4986],
  [47.8012, -122.4998],
  [47.8014, -122.5004],
  [47.802, -122.5017],
  [47.8027, -122.5034],
  [47.8029, -122.504],
  LINE_DISPENSER, // pass dispenser (Lindvog Rd)
  [47.8039, -122.5064],
  [47.8049, -122.5091],
  [47.8079, -122.5166],
  LINE_FLASHING_SIGN, // flashing sign (Barber Cutoff Rd)
  [47.809, -122.5192],
];

/**
 * The stretch of line WEST of the boarding-pass dispenser — where /line's
 * audience actually sits (a car east of the dispenser has already passed it
 * and is minutes from the tollbooths). Distance-from-the-line honesty checks
 * (the amenity truth block) anchor here rather than on the full route, because
 * the full route's terminal end would make everything at the dock look "close
 * to the line" to a driver parked two miles from it.
 */
export const LINE_WEST_OF_DISPENSER: readonly LatLng[] = HOLDING_ROUTE.slice(
  HOLDING_ROUTE.indexOf(LINE_DISPENSER),
);

const METERS_PER_DEG_LAT = 111_320;

/**
 * Straight-line meters from a point to the nearest point ON the polyline
 * (vertices AND the segments between them, endpoints clamped).
 *
 * Method: local equirectangular projection around the point, then plain 2-D
 * point-to-segment math. Over the line's ~3 km extent the projection error is
 * well under a meter — noise next to the "straight-line understates a real
 * walk" honesty caveat every rendering of this number must carry (see geo.ts).
 */
export function distanceToLineMeters(
  lat: number,
  lng: number,
  route: readonly LatLng[] = HOLDING_ROUTE,
): number {
  if (route.length === 0) return Infinity;
  if (route.length === 1) return haversineMeters(lat, lng, route[0][0], route[0][1]);

  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const toXY = ([pLat, pLng]: LatLng): [number, number] => [
    (pLng - lng) * metersPerDegLng,
    (pLat - lat) * METERS_PER_DEG_LAT,
  ];

  let best = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const [ax, ay] = toXY(route[i]);
    const [bx, by] = toXY(route[i + 1]);
    const abx = bx - ax;
    const aby = by - ay;
    const lenSq = abx * abx + aby * aby;
    // The point is the origin, so the projection of P onto AB is -A·AB / |AB|².
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * abx + ay * aby) / lenSq));
    const nx = ax + t * abx;
    const ny = ay + t * aby;
    best = Math.min(best, Math.hypot(nx, ny));
  }
  return best;
}

/**
 * Whole walking minutes from the nearest point of the line, casual pace,
 * never "0 min" (same floor as geo.ts walkMinutes). Straight-line, so it
 * UNDER-states the real walk — render it with a "~".
 */
export function walkMinutesFromLine(
  lat: number,
  lng: number,
  route: readonly LatLng[] = HOLDING_ROUTE,
): number {
  return walkMinutes(distanceToLineMeters(lat, lng, route));
}
