// E31 phase 6 — curb-side offset math.
//
// MapLibre's line-offset is signed relative to the polyline's DIRECTION, but a
// MapZone stores a compass side ("east"). These tests pin the sign convention:
// get it backwards and every street stroke renders against the WRONG curb —
// visually plausible, factually inverted, exactly the class of error a
// reviewer cannot catch from the code alone.

import { describe, expect, it } from "vitest";
import { compassOffsetSign, curbOffsetSigns } from "@/lib/map/curb";

// Stored [lat, lng] order, like MapZone.streetPaths.
const NORTHBOUND: [number, number][] = [
  [47.796, -122.497],
  [47.798, -122.497],
];
const SOUTHBOUND: [number, number][] = [...NORTHBOUND].reverse() as [number, number][];
const EASTBOUND: [number, number][] = [
  [47.797, -122.499],
  [47.797, -122.495],
];
const WESTBOUND: [number, number][] = [...EASTBOUND].reverse() as [number, number][];

// Washington Blvd between the SR 104 legs runs WSW→ENE (the real seed shape).
const WASHINGTON_LOOP: [number, number][] = [
  [47.79704, -122.49693],
  [47.79755, -122.49563],
];

describe("compassOffsetSign", () => {
  it("puts east on the right of a northbound street (+1) and the left southbound (−1)", () => {
    expect(compassOffsetSign(NORTHBOUND, "east")).toBe(1);
    expect(compassOffsetSign(NORTHBOUND, "west")).toBe(-1);
    expect(compassOffsetSign(SOUTHBOUND, "east")).toBe(-1);
    expect(compassOffsetSign(SOUTHBOUND, "west")).toBe(1);
  });

  it("puts south on the right of an eastbound street", () => {
    expect(compassOffsetSign(EASTBOUND, "south")).toBe(1);
    expect(compassOffsetSign(EASTBOUND, "north")).toBe(-1);
    expect(compassOffsetSign(WESTBOUND, "south")).toBe(-1);
    expect(compassOffsetSign(WESTBOUND, "north")).toBe(1);
  });

  it("resolves north/south for the real ENE-running Washington Blvd block", () => {
    // Direction ≈ ENE → right side ≈ SSE: "south" is the right curb.
    expect(compassOffsetSign(WASHINGTON_LOOP, "south")).toBe(1);
    expect(compassOffsetSign(WASHINGTON_LOOP, "north")).toBe(-1);
  });

  it("refuses a side that runs parallel to the street (data-entry error → centre line)", () => {
    // "East curb" of an east–west street names no curb at all.
    expect(compassOffsetSign(EASTBOUND, "east")).toBe(0);
    expect(compassOffsetSign(EASTBOUND, "west")).toBe(0);
    expect(compassOffsetSign(NORTHBOUND, "north")).toBe(0);
  });

  it("refuses degenerate paths", () => {
    expect(compassOffsetSign([[47.797, -122.497]], "east")).toBe(0);
    expect(
      compassOffsetSign(
        [
          [47.797, -122.497],
          [47.797, -122.497],
        ],
        "east",
      ),
    ).toBe(0);
  });
});

describe("curbOffsetSigns", () => {
  it("unknown side draws exactly one centre-line stroke", () => {
    expect(curbOffsetSigns(NORTHBOUND, undefined)).toEqual([0]);
  });

  it("'both' draws a stroke against each curb", () => {
    expect(curbOffsetSigns(WASHINGTON_LOOP, "both")).toEqual([1, -1]);
  });

  it("a named side draws one signed stroke", () => {
    expect(curbOffsetSigns(NORTHBOUND, "east")).toEqual([1]);
    expect(curbOffsetSigns(SOUTHBOUND, "east")).toEqual([-1]);
  });

  it("an ill-defined side falls back to the centre line, never a guess", () => {
    expect(curbOffsetSigns(EASTBOUND, "east")).toEqual([0]);
  });
});
