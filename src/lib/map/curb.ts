// E31 phase 6 — curb-side offset math for street parking strokes.
//
// MapLibre's `line-offset` shifts a line perpendicular to its direction:
// positive = the RIGHT of the direction of travel, negative = the left. A
// MapZone stores a compass curb side ("east"), so the renderer must work out
// which sign puts the stroke on that compass side for THIS polyline's
// direction. Pure and window-free so both the public map and tests share it.

import type { CurbSide } from "@/lib/data/parking";

/**
 * Offset SIGNS to draw for a street polyline with the given curb value, in
 * MapLibre line-offset convention (path in stored [lat, lng] order).
 *
 *   - undefined curb → [0]        (side unknown: one centre-line stroke)
 *   - "both"         → [1, -1]    (a stroke hugging each curb)
 *   - compass side   → [±1]       (the sign that lands on that side)
 *
 * A compass side that runs PARALLEL to the street (asking for the "east" curb
 * of an east–west street) does not name a curb at all — that is a data entry
 * error, and the honest fallback is the centre line, same as unknown.
 */
export function curbOffsetSigns(
  path: [number, number][],
  curb: CurbSide | undefined,
): number[] {
  if (!curb) return [0];
  if (curb === "both") return [1, -1];
  const sign = compassOffsetSign(path, curb);
  return sign === 0 ? [0] : [sign];
}

/** Unit vectors per compass side, in (east, north) axes. */
const COMPASS: Record<Exclude<CurbSide, "both">, [number, number]> = {
  east: [1, 0],
  west: [-1, 0],
  north: [0, 1],
  south: [0, -1],
};

/**
 * +1 / −1 line-offset sign that puts the stroke on the requested compass side
 * of the polyline, or 0 when the request is ill-defined (degenerate path, or
 * the side is within ~18° of parallel to the street's overall bearing).
 */
export function compassOffsetSign(
  path: [number, number][],
  side: Exclude<CurbSide, "both">,
): -1 | 0 | 1 {
  if (path.length < 2) return 0;
  const [aLat, aLng] = path[0];
  const [bLat, bLng] = path[path.length - 1];
  // Local planar direction of travel, in (east, north) axes. cos(lat) corrects
  // for meridian convergence; Kingston is a point, so first-point lat is fine.
  const dx = (bLng - aLng) * Math.cos((aLat * Math.PI) / 180);
  const dy = bLat - aLat;
  const len = Math.hypot(dx, dy);
  if (len === 0) return 0;
  // Right-hand normal of the direction of travel: north-bound → east, etc.
  const rx = dy / len;
  const ry = -dx / len;
  const [sx, sy] = COMPASS[side];
  const dot = rx * sx + ry * sy;
  // |dot| = |cos(angle between right-normal and requested side)|. Below ~0.3
  // (≳72° away, i.e. the side runs near-parallel to the street) the side does
  // not describe either curb — refuse rather than guess.
  if (Math.abs(dot) < 0.3) return 0;
  return dot > 0 ? 1 : -1;
}
