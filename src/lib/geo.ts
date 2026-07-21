// Pure walking-distance math, safe to import from client OR server.
//
// Extracted for E27's amenity finder because the existing copies aren't
// reachable: src/lib/hunt-store.ts exports haversineMeters but is server-only
// (it touches the filesystem), and src/components/near-me.tsx keeps a private
// copy inside a client component. Nothing here imports anything, so both sides
// can use it.
//
// HONESTY NOTE on the walk-time estimate: this is straight-line distance at a
// casual pace, so it UNDER-states a real walk (you can't walk through the
// marina). Surfaces render it as "~N min" for that reason. It is deliberately
// the same math src/components/near-me.tsx already ships publicly, so two
// surfaces never disagree about the same walk. It is NOT the method behind the
// hand-calibrated `walkMinutesFromFerry` figures in src/lib/data/restaurants.ts,
// which are street-distance estimates — don't mix the two on one screen.

/** Kingston ferry walk-off point. Documented in src/lib/data/restaurants.ts
 *  and src/lib/data/map-views.ts; the anchor for "from the dock" ordering. */
export const KINGSTON_FERRY_DOCK: readonly [number, number] = [47.7966, -122.4958];

/** Casual walking pace: ~80 m per minute (matches near-me.tsx). */
export const WALK_METERS_PER_MINUTE = 80;

/** Great-circle distance in meters. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth radius, meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Meters → whole minutes on foot, never rounding down to a bare "0 min". */
export function walkMinutes(meters: number): number {
  return Math.max(1, Math.round(meters / WALK_METERS_PER_MINUTE));
}

/** Walking minutes from the ferry dock — the fallback ordering when a visitor
 *  hasn't shared (or has declined) their location. */
export function walkMinutesFromDock(lat: number, lng: number): number {
  return walkMinutes(haversineMeters(KINGSTON_FERRY_DOCK[0], KINGSTON_FERRY_DOCK[1], lat, lng));
}
