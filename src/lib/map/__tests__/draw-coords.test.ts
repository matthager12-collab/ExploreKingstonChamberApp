import { describe, expect, it } from "vitest";
import {
  r6,
  toGeoJsonPath,
  toGeoJsonPosition,
  toGeoJsonRing,
  toStoredPath,
  toStoredPoint,
  toStoredRing,
} from "@/lib/map/draw-coords";

// Characterizes the editor↔store wire format (E32 FR-EDIT-06): stored geometry
// is [lat,lng], r6-rounded, rings OPEN; GeoJSON is [lng,lat], rings CLOSED.
// A drift here silently corrupts what every public map renders — if one of
// these expectations has to change, that is a data-model decision, not a
// refactor.

// A real downtown-Kingston ring, already wire-rounded (as stored data is).
const STORED_RING: [number, number][] = [
  [47.796812, -122.498321],
  [47.797245, -122.497562],
  [47.796501, -122.497104],
];

describe("r6", () => {
  it("rounds to 6 decimal places (the stored wire precision)", () => {
    expect(r6(47.79681249)).toBe(47.796812);
    expect(r6(-122.4983215)).toBe(-122.498321);
    expect(r6(47.5)).toBe(47.5);
  });
});

describe("axis order", () => {
  it("flips stored [lat,lng] to GeoJSON [lng,lat] and back", () => {
    expect(toGeoJsonPosition([47.796812, -122.498321])).toEqual([-122.498321, 47.796812]);
    expect(toStoredPoint([-122.498321, 47.796812])).toEqual([47.796812, -122.498321]);
  });

  it("wire-rounds on the way back in", () => {
    expect(toStoredPoint([-122.49832149, 47.79681251])).toEqual([47.796813, -122.498321]);
  });
});

describe("paths (LineString)", () => {
  it("round-trips without gaining or losing vertices", () => {
    const path: [number, number][] = [
      [47.7968, -122.4983],
      [47.7972, -122.4975],
    ];
    expect(toStoredPath(toGeoJsonPath(path))).toEqual(path);
  });
});

describe("rings (Polygon)", () => {
  it("closes the ring going out: GeoJSON repeats the first vertex last", () => {
    const ring = toGeoJsonRing(STORED_RING);
    expect(ring).toHaveLength(STORED_RING.length + 1);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring[ring.length - 1]).not.toBe(ring[0]); // a copy, not a shared ref
  });

  it("strips the closing vertex coming back: stored rings are open", () => {
    const back = toStoredRing(toGeoJsonRing(STORED_RING));
    expect(back).toEqual(STORED_RING);
  });

  it("round-trip is the identity for wire-rounded data — repeated saves cannot grow the ring", () => {
    let ring = STORED_RING;
    for (let i = 0; i < 3; i++) ring = toStoredRing(toGeoJsonRing(ring));
    expect(ring).toEqual(STORED_RING);
  });

  it("tolerates an already-open GeoJSON ring (no vertex is ever double-stripped)", () => {
    const open = STORED_RING.map((p) => [p[1], p[0]] as [number, number]);
    expect(toStoredRing(open)).toEqual(STORED_RING);
  });

  it("handles empty input", () => {
    expect(toGeoJsonRing([])).toEqual([]);
    expect(toStoredRing([])).toEqual([]);
  });
});
