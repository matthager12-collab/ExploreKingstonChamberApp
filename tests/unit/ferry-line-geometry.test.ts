// E33 slice 2 — the extracted SR-104 holding-line geometry.
//
// The polyline itself is display data (georeferenced from OSM — there is no
// truth to unit-test it against), so these tests pin the MATH and the
// STRUCTURE: distance-to-polyline correctness on synthetic geometry where the
// answer is known, endpoint clamping, the never-"0 min" walk floor, and the
// named-point invariants /line's honesty logic depends on (the dispenser
// really is a vertex, the west-of-dispenser slice really is the western tail).

import { describe, expect, it } from "vitest";
import {
  distanceToLineMeters,
  HOLDING_ROUTE,
  LINE_DISPENSER,
  LINE_FLASHING_SIGN,
  LINE_TERMINAL,
  LINE_WEST_OF_DISPENSER,
  walkMinutesFromLine,
  type LatLng,
} from "@/lib/ferry-line-geometry";
import { haversineMeters } from "@/lib/geo";

/** ~1113.2 m of equator-hugging line, west→east, where the math is by-hand
 *  checkable: 0.001° of latitude ≈ 111.32 m everywhere on it. */
const FLAT_ROUTE: readonly LatLng[] = [
  [0, 0],
  [0, 0.005],
  [0, 0.01],
];

describe("distanceToLineMeters", () => {
  it("is ~0 on every vertex of the real route", () => {
    for (const [lat, lng] of HOLDING_ROUTE) {
      expect(distanceToLineMeters(lat, lng)).toBeLessThan(0.5);
    }
  });

  it("is ~0 on the middle of a segment, not just on vertices", () => {
    const [a, b] = [HOLDING_ROUTE[3], HOLDING_ROUTE[4]];
    const mid: LatLng = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    expect(distanceToLineMeters(mid[0], mid[1])).toBeLessThan(1);
  });

  it("measures perpendicular offset from a mid-segment point", () => {
    // 0.001° north of the middle of the flat route ≈ 111.32 m.
    const d = distanceToLineMeters(0.001, 0.005, FLAT_ROUTE);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112.5);
  });

  it("clamps to the nearest ENDPOINT beyond the ends (no infinite-line math)", () => {
    // 0.01° east of the east end: nearest point is the end vertex itself.
    const d = distanceToLineMeters(0, 0.02, FLAT_ROUTE);
    const toEnd = haversineMeters(0, 0.02, 0, 0.01);
    expect(Math.abs(d - toEnd)).toBeLessThan(toEnd * 0.01);

    // Same off the real route's west end.
    const west = HOLDING_ROUTE[HOLDING_ROUTE.length - 1];
    const probe: LatLng = [west[0] + 0.002, west[1] - 0.004]; // further NW up SR 104
    const dReal = distanceToLineMeters(probe[0], probe[1]);
    const toWest = haversineMeters(probe[0], probe[1], west[0], west[1]);
    expect(Math.abs(dReal - toWest)).toBeLessThan(toWest * 0.02);
  });

  it("agrees with haversine within 1% for an off-line downtown point", () => {
    // The projection shortcut must not visibly disagree with the app's own
    // haversine at town scale. Nearest vertex distance is an upper bound on
    // the true distance to the polyline.
    const p: LatLng = [47.7962, -122.498]; // waterfront promenade area
    const nearestVertex = Math.min(
      ...HOLDING_ROUTE.map(([lat, lng]) => haversineMeters(p[0], p[1], lat, lng)),
    );
    const d = distanceToLineMeters(p[0], p[1]);
    expect(d).toBeLessThanOrEqual(nearestVertex * 1.01);
    expect(d).toBeGreaterThan(0);
  });
});

describe("walkMinutesFromLine", () => {
  it("never reports a bare 0 minutes, even standing on the line", () => {
    const [lat, lng] = HOLDING_ROUTE[0];
    expect(walkMinutesFromLine(lat, lng)).toBe(1);
  });

  it("rounds ~400 m to 5 minutes at the shared 80 m/min pace", () => {
    // 0.0036° north of the flat route ≈ 400.8 m → 5 min.
    expect(walkMinutesFromLine(0.0036, 0.005, FLAT_ROUTE)).toBe(5);
  });
});

describe("route structure (/line's honesty logic depends on these)", () => {
  it("names the dispenser, the flashing sign, and the terminal as actual vertices", () => {
    expect(HOLDING_ROUTE).toContain(LINE_DISPENSER);
    expect(HOLDING_ROUTE).toContain(LINE_FLASHING_SIGN);
    expect(HOLDING_ROUTE[0]).toBe(LINE_TERMINAL);
  });

  it("LINE_WEST_OF_DISPENSER is the western tail, starting AT the dispenser", () => {
    expect(LINE_WEST_OF_DISPENSER[0]).toBe(LINE_DISPENSER);
    expect(LINE_WEST_OF_DISPENSER.length).toBeGreaterThan(1);
    // A suffix of the full route, element for element.
    const offset = HOLDING_ROUTE.length - LINE_WEST_OF_DISPENSER.length;
    LINE_WEST_OF_DISPENSER.forEach((p, i) => {
      expect(HOLDING_ROUTE[offset + i]).toBe(p);
    });
    // And it genuinely excludes the terminal half: the terminal itself is far
    // from the waiting stretch.
    expect(
      distanceToLineMeters(LINE_TERMINAL[0], LINE_TERMINAL[1], LINE_WEST_OF_DISPENSER),
    ).toBeGreaterThan(500);
  });
});
