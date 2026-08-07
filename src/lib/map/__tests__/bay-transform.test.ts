import { describe, expect, it } from "vitest";
import {
  BAY_TRANSFORM_LIMITS,
  IDENTITY_BAY_TRANSFORM,
  bayPivot,
  clampBayTransform,
  isIdentityBayTransform,
  transformPosition,
  transformRing,
} from "@/lib/map/bay-transform";

const PIVOT: [number, number] = [-122.4984, 47.7966]; // middle of the Port lot
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((47.7966 * Math.PI) / 180);

/** Metres between two [lng, lat] positions, on the local tangent plane. */
function metres(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(
    (a[0] - b[0]) * M_PER_DEG_LNG,
    (a[1] - b[1]) * M_PER_DEG_LAT,
  );
}

/**
 * Output is rounded to 6 decimals, matching draw-coords' r6 and every other
 * stored coordinate in the app. At this latitude that quantises longitude to
 * ~7.4 cm and latitude to ~11 cm, so a single point can land ~7 cm from the
 * exact answer and a two-endpoint measurement ~15 cm. Assertions below are
 * budgeted against that; anything tighter would be testing the rounding, not
 * the maths.
 */
const WIRE_POINT_M = 0.08;
const WIRE_EDGE_M = 0.16;

describe("clampBayTransform", () => {
  it("passes a sane transform through", () => {
    expect(clampBayTransform({ dx: 3, dy: -4.5, rotateDeg: 2, scale: 1.05 })).toEqual({
      dx: 3,
      dy: -4.5,
      rotateDeg: 2,
      scale: 1.05,
    });
  });

  it("clamps each field to its limit rather than rejecting the record", () => {
    const t = clampBayTransform({ dx: 1e6, dy: -1e6, rotateDeg: 400, scale: 99 });
    expect(t.dx).toBe(BAY_TRANSFORM_LIMITS.offset);
    expect(t.dy).toBe(-BAY_TRANSFORM_LIMITS.offset);
    expect(t.rotateDeg).toBe(BAY_TRANSFORM_LIMITS.rotate);
    expect(t.scale).toBe(BAY_TRANSFORM_LIMITS.scaleMax);
  });

  // The whole reason clamp returns a complete object instead of throwing: one bad
  // number in a stored record must not be able to blank the public bay layer.
  it("degrades junk to identity field by field", () => {
    expect(clampBayTransform(undefined)).toEqual(IDENTITY_BAY_TRANSFORM);
    expect(clampBayTransform(null)).toEqual(IDENTITY_BAY_TRANSFORM);
    expect(clampBayTransform("nope")).toEqual(IDENTITY_BAY_TRANSFORM);
    expect(clampBayTransform({ dx: 5 })).toEqual({ ...IDENTITY_BAY_TRANSFORM, dx: 5 });
  });

  it("rejects non-finite numbers, which survive JSON as null", () => {
    const t = clampBayTransform({ dx: NaN, dy: Infinity, rotateDeg: -Infinity, scale: NaN });
    expect(t).toEqual(IDENTITY_BAY_TRANSFORM);
    expect(Number.isFinite(t.dx)).toBe(true);
    expect(Number.isFinite(t.scale)).toBe(true);
  });

  it("never yields a zero or negative scale, which would collapse every bay", () => {
    expect(clampBayTransform({ scale: 0 }).scale).toBe(BAY_TRANSFORM_LIMITS.scaleMin);
    expect(clampBayTransform({ scale: -3 }).scale).toBe(BAY_TRANSFORM_LIMITS.scaleMin);
  });
});

describe("isIdentityBayTransform", () => {
  it("recognises the no-op so empty records are never persisted", () => {
    expect(isIdentityBayTransform(IDENTITY_BAY_TRANSFORM)).toBe(true);
    expect(isIdentityBayTransform({ dx: 0, dy: 0, rotateDeg: 0, scale: 1.01 })).toBe(false);
    expect(isIdentityBayTransform({ dx: 0.5, dy: 0, rotateDeg: 0, scale: 1 })).toBe(false);
  });
});

describe("bayPivot", () => {
  it("returns the mean of the positions", () => {
    expect(bayPivot([[0, 0], [2, 4]])).toEqual([1, 2]);
  });

  it("survives an empty set rather than emitting NaN", () => {
    expect(bayPivot([])).toEqual([0, 0]);
  });
});

describe("transformPosition", () => {
  it("is a no-op under the identity transform", () => {
    const p: [number, number] = [-122.4979, 47.7969];
    expect(transformPosition(p, PIVOT, IDENTITY_BAY_TRANSFORM)).toEqual(p);
  });

  it("moves a point by the stated distance in metres, not degrees", () => {
    const moved = transformPosition(PIVOT, PIVOT, {
      ...IDENTITY_BAY_TRANSFORM,
      dx: 10,
      dy: 0,
    });
    expect(metres(moved, PIVOT)).toBeCloseTo(10, 1);
  });

  // A degree-space implementation would get this wrong: a degree of longitude
  // here is only ~0.67 of a degree of latitude, so equal dx/dy would not travel
  // equal ground distance.
  it("treats north and east as the same length on the ground", () => {
    const east = transformPosition(PIVOT, PIVOT, { ...IDENTITY_BAY_TRANSFORM, dx: 25 });
    const north = transformPosition(PIVOT, PIVOT, { ...IDENTITY_BAY_TRANSFORM, dy: 25 });
    expect(metres(east, PIVOT)).toBeCloseTo(25, 1);
    expect(metres(north, PIVOT)).toBeCloseTo(25, 1);
    expect(Math.abs(metres(east, PIVOT) - metres(north, PIVOT))).toBeLessThan(WIRE_POINT_M);
  });

  it("rotates clockwise, sending north to east at +90°", () => {
    // A point 20 m due north of the pivot.
    const north: [number, number] = [PIVOT[0], PIVOT[1] + 20 / M_PER_DEG_LAT];
    const spun = transformPosition(north, PIVOT, {
      ...IDENTITY_BAY_TRANSFORM,
      rotateDeg: 90,
    });
    expect((spun[0] - PIVOT[0]) * M_PER_DEG_LNG).toBeCloseTo(20, 1); // now due east
    expect((spun[1] - PIVOT[1]) * M_PER_DEG_LAT).toBeCloseTo(0, 1);
  });

  it("leaves the pivot itself fixed under rotation and scale", () => {
    const t = { dx: 0, dy: 0, rotateDeg: 20, scale: 1.4 };
    const out = transformPosition(PIVOT, PIVOT, t);
    expect(metres(out, PIVOT)).toBeCloseTo(0, 3);
  });

  it("scales distance from the pivot", () => {
    const p: [number, number] = [PIVOT[0], PIVOT[1] + 30 / M_PER_DEG_LAT];
    const out = transformPosition(p, PIVOT, { ...IDENTITY_BAY_TRANSFORM, scale: 1.5 });
    expect(metres(out, PIVOT)).toBeCloseTo(45, 1);
  });

  it("rounds to the 6-decimal wire precision the rest of the map uses", () => {
    const out = transformPosition(PIVOT, PIVOT, {
      ...IDENTITY_BAY_TRANSFORM,
      dx: 0.0001,
    });
    for (const n of out) {
      expect(Math.round(n * 1e6) / 1e6).toBe(n);
    }
  });
});

describe("transformRing", () => {
  const RING: [number, number][] = [
    [-122.49845, 47.79655],
    [-122.4984, 47.79655],
    [-122.4984, 47.7966],
    [-122.49845, 47.7966],
    [-122.49845, 47.79655],
  ];

  it("keeps the ring closed", () => {
    const out = transformRing(RING, PIVOT, { dx: 7, dy: -3, rotateDeg: 12, scale: 1.1 });
    expect(out).toHaveLength(RING.length);
    expect(out[0]).toEqual(out[out.length - 1]);
  });

  // A rigid nudge may move and turn a row, but it must not deform it — the bays
  // are a fixed group, and shearing them would invent geometry.
  it("preserves shape: every edge scales by exactly the scale factor", () => {
    const scale = 1.25;
    const out = transformRing(RING, PIVOT, {
      dx: 12,
      dy: 5,
      rotateDeg: 17,
      scale,
    });
    for (let i = 0; i < RING.length - 1; i += 1) {
      const before = metres(RING[i], RING[i + 1]);
      const after = metres(out[i], out[i + 1]);
      expect(Math.abs(after - before * scale)).toBeLessThan(WIRE_EDGE_M);
    }
  });

  it("is reversible: applying the inverse returns the original", () => {
    const t = { dx: 9, dy: -6, rotateDeg: 15, scale: 1.2 };
    const there = transformRing(RING, PIVOT, t);
    // Undo in reverse order: translate back, then unrotate and unscale.
    const back = there.map((p) => {
      const shifted: [number, number] = [
        p[0] - t.dx / M_PER_DEG_LNG,
        p[1] - t.dy / M_PER_DEG_LAT,
      ];
      return transformPosition(shifted, PIVOT, {
        dx: 0,
        dy: 0,
        rotateDeg: -t.rotateDeg,
        scale: 1 / t.scale,
      });
    });
    for (let i = 0; i < RING.length; i += 1) {
      expect(metres(back[i], RING[i])).toBeLessThan(0.05);
    }
  });
});
