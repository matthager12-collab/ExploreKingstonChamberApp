// Per-zone nudge for the generated Port bay geometry (public/geo/port-stalls.json).
//
// WHY THIS EXISTS. The bay layer is DERIVED, not drawn: scripts/gen-port-stalls.py
// reads the Port's schematic and seats each zone's rows inside that zone's polygon
// in src/lib/data/parking.ts. That fit is good — every row lands at 2–5 m per bay,
// and the 223 numbered bays match the ranges the Port prints — but it is a fit, and
// the schematic it derives from is a diagram. Somewhere it will be off, and the
// person who notices will be a Chamber admin standing in the lot, not someone who
// can re-run a Python script.
//
// So a zone's bays can be nudged at runtime: shifted, turned, and resized as one
// rigid group. Four numbers per zone, stored in the "port-bay-transforms" overlay
// (src/lib/stores/bay-transform-store.ts) exactly like every other admin edit —
// the generated file stays the seed and is never rewritten, so regenerating it
// after a Port revision does not throw away the corrections.
//
// WHOLE-ZONE ONLY, DELIBERATELY. There is no per-bay edit and there should not be.
// A bay's position is not independently known — bays are uniform subdivisions of a
// row, which is how the Port draws them and not how asphalt works. Letting an admin
// drag bay 47 on its own would manufacture a precision the source never had. What
// IS knowable on the ground is that a whole row sits a few metres north of where the
// map puts it, and that is exactly what these four numbers express.
//
// Pure and window-free — no React, no MapLibre — so the public map, the admin
// editor and the fast unit suite all share one implementation and cannot drift.

/** A rigid nudge applied to one zone's bays, about their own centre. */
export interface BayTransform {
  /** Metres east (+) or west (−). */
  dx: number;
  /** Metres north (+) or south (−). */
  dy: number;
  /** Degrees clockwise, about the zone's bay centroid. */
  rotateDeg: number;
  /** Multiplier about the same centroid. 1 = unchanged. */
  scale: number;
}

export const IDENTITY_BAY_TRANSFORM: BayTransform = {
  dx: 0,
  dy: 0,
  rotateDeg: 0,
  scale: 1,
};

/**
 * Bounds on what a nudge may do.
 *
 * These are not arbitrary. The whole point of the piecewise fit is that a zone's
 * bays inherit the position of a polygon a human snapped to aerial imagery, and
 * the measured worst-case error of the underlying schematic is 16 m. A correction
 * bigger than ±40 m is therefore not a correction — it means the bays were
 * attached to the wrong zone, or the zone polygon itself is wrong (as
 * port-pokhill's is: an axis-aligned box where the real strip runs diagonally).
 * Both are fixed upstream, not by dragging. The clamp keeps a slip of the finger
 * from putting a row of stalls in the harbour, and keeps a bad POST from doing
 * the same.
 */
export const BAY_TRANSFORM_LIMITS = {
  /** Metres, each axis. */
  offset: 40,
  /** Degrees, either direction. */
  rotate: 30,
  scaleMin: 0.6,
  scaleMax: 1.6,
} as const;

const M_PER_DEG_LAT = 111320;

function clampNum(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Wire rounding, matching draw-coords' r6 for coordinates. */
const r3 = (n: number): number => Math.round(n * 1e3) / 1e3;

/**
 * Coerce anything (an admin POST body, a store record written by an older build)
 * into a valid transform.
 *
 * Returns a complete object always — a partial or garbage input degrades to
 * identity field by field rather than throwing, because a single bad number in a
 * stored record must not be able to blank the entire bay layer on the public map.
 * Non-finite values (NaN, ±Infinity) are the important case: they survive JSON
 * round-trips as null and would otherwise propagate into every coordinate.
 */
export function clampBayTransform(raw: unknown): BayTransform {
  const o = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const { offset, rotate, scaleMin, scaleMax } = BAY_TRANSFORM_LIMITS;
  return {
    dx: r3(clampNum(num(o.dx, 0), -offset, offset)),
    dy: r3(clampNum(num(o.dy, 0), -offset, offset)),
    rotateDeg: r3(clampNum(num(o.rotateDeg, 0), -rotate, rotate)),
    scale: r3(clampNum(num(o.scale, 1), scaleMin, scaleMax)),
  };
}

/** Is this transform a no-op? Used to avoid persisting empty records. */
export function isIdentityBayTransform(t: BayTransform): boolean {
  return t.dx === 0 && t.dy === 0 && t.rotateDeg === 0 && t.scale === 1;
}

/**
 * Centroid of a set of GeoJSON [lng, lat] positions — the pivot a zone's nudge
 * turns and scales about.
 *
 * Deliberately the mean of the bay vertices rather than an area centroid or the
 * zone polygon's centre. It is derived from the same geometry being moved, so it
 * needs no storage and cannot fall out of sync; and because every bay in a zone
 * is the same size, vertex mean and area centroid agree to within centimetres.
 */
export function bayPivot(positions: readonly (readonly number[])[]): [number, number] {
  if (positions.length === 0) return [0, 0];
  let lng = 0;
  let lat = 0;
  for (const p of positions) {
    lng += p[0];
    lat += p[1];
  }
  return [lng / positions.length, lat / positions.length];
}

/**
 * Apply a nudge to one GeoJSON [lng, lat] position about `pivot`.
 *
 * Local tangent-plane maths: degrees → metres at the pivot's latitude, transform,
 * metres → degrees. Over a lot 230 m across the flat-earth error is millimetres,
 * far under the 11 cm wire rounding, and it keeps a metre input meaning a metre on
 * the ground in both axes — which a degree-space rotation would not, since a
 * degree of longitude here is only 0.67 of a degree of latitude.
 */
export function transformPosition(
  pos: readonly number[],
  pivot: readonly [number, number],
  t: BayTransform,
): [number, number] {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((pivot[1] * Math.PI) / 180);
  // Guard the pole case so a bad pivot can't divide by ~0 and emit Infinity.
  if (!Number.isFinite(mPerDegLng) || Math.abs(mPerDegLng) < 1) {
    return [pos[0], pos[1]];
  }
  let east = (pos[0] - pivot[0]) * mPerDegLng;
  let north = (pos[1] - pivot[1]) * M_PER_DEG_LAT;

  east *= t.scale;
  north *= t.scale;

  if (t.rotateDeg !== 0) {
    // Clockwise on a north-up map: +90° sends north to east.
    const th = (t.rotateDeg * Math.PI) / 180;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const e = east * c + north * s;
    const n = -east * s + north * c;
    east = e;
    north = n;
  }

  east += t.dx;
  north += t.dy;

  return [
    Math.round((pivot[0] + east / mPerDegLng) * 1e6) / 1e6,
    Math.round((pivot[1] + north / M_PER_DEG_LAT) * 1e6) / 1e6,
  ];
}

/** Apply a nudge to a closed GeoJSON polygon ring. */
export function transformRing(
  ring: readonly (readonly number[])[],
  pivot: readonly [number, number],
  t: BayTransform,
): [number, number][] {
  return ring.map((p) => transformPosition(p, pivot, t));
}
