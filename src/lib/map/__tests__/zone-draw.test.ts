import { describe, expect, it } from "vitest";
import type { GeoJSONStoreFeatures } from "terra-draw";
import {
  isZoneFeature,
  PATH_SEP,
  pathFeatureId,
  pathIndexOfFeature,
  pathMidpoint,
  streetPathsFromFeatures,
  zoneDrawFeatures,
  zoneIdOfFeature,
} from "@/lib/map/zone-draw";
import { parkingZones } from "@/lib/data/parking";
import type { MapZone } from "@/lib/data/parking";

function zone(over: Partial<MapZone> & { id: string }): MapZone {
  return {
    name: "Zone",
    rule: "free-2hr",
    summary: "",
    details: "",
    confidence: "probable",
    overnight: "confirm-first",
    center: [47.797, -122.496],
    ...over,
  };
}

const PATH_A: [number, number][] = [
  [47.7965, -122.4975],
  [47.7968, -122.4955],
  [47.7969, -122.494],
];
const PATH_B: [number, number][] = [
  [47.798, -122.499],
  [47.7984, -122.4972],
];

describe("draw-store id encoding", () => {
  it("round-trips a zone id through a path feature id", () => {
    const fid = pathFeatureId("street-ne-1st", 2);
    expect(fid).toBe("street-ne-1st~2");
    expect(zoneIdOfFeature(fid)).toBe("street-ne-1st");
    expect(pathIndexOfFeature(fid)).toBe(2);
  });

  it("treats a bare polygon id as its own zone, with no path index", () => {
    expect(zoneIdOfFeature("port-free-2hr-row")).toBe("port-free-2hr-row");
    expect(pathIndexOfFeature("port-free-2hr-row")).toBe(-1);
  });

  it("the separator can never occur inside a real zone id", () => {
    // The admin API's gate (src/app/api/admin/parking/route.ts). If that regex
    // is ever widened to admit "~", this encoding silently starts mis-parsing
    // ids — so the two are pinned together here rather than by comment.
    const API_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;
    expect(API_ID_RE.test(PATH_SEP)).toBe(false);
    expect(API_ID_RE.test(`a${PATH_SEP}0`)).toBe(false);
    for (const z of parkingZones) {
      expect(API_ID_RE.test(z.id), z.id).toBe(true);
      expect(z.id.includes(PATH_SEP), z.id).toBe(false);
    }
  });
});

describe("zoneDrawFeatures", () => {
  it("emits one feature per street path, indexed in order", () => {
    const features = zoneDrawFeatures(zone({ id: "s1", streetPaths: [PATH_A, PATH_B] }));
    expect(features.map((f) => f.id)).toEqual(["s1~0", "s1~1"]);
    expect(features.every((f) => f.geometry.type === "LineString")).toBe(true);
    // Stored [lat,lng] → GeoJSON [lng,lat]; nothing here converts by hand.
    expect(features[0].geometry.coordinates[0]).toEqual([-122.4975, 47.7965]);
  });

  it("emits a single closed-ring polygon feature for a lot", () => {
    const ring: [number, number][] = [
      [47.796, -122.498],
      [47.796, -122.496],
      [47.797, -122.496],
    ];
    const [f] = zoneDrawFeatures(zone({ id: "lot1", polygon: ring }));
    expect(f.id).toBe("lot1");
    expect(f.geometry.type).toBe("Polygon");
    const coords = (f.geometry as GeoJSON.Polygon).coordinates[0];
    expect(coords).toHaveLength(4); // 3 stored points + the closing vertex
    expect(coords[0]).toEqual(coords[coords.length - 1]);
  });

  it("prefers STREET geometry when a zone somehow carries both", () => {
    // The editor must never draw a lot where the public map draws curb strokes.
    const features = zoneDrawFeatures(
      zone({
        id: "both",
        streetPaths: [PATH_A],
        polygon: [
          [47.796, -122.498],
          [47.796, -122.496],
          [47.797, -122.496],
        ],
      }),
    );
    expect(features).toHaveLength(1);
    expect(features[0].geometry.type).toBe("LineString");
  });

  it("drops a degenerate path rather than letting it shift later indices", () => {
    const features = zoneDrawFeatures(
      zone({ id: "s2", streetPaths: [[[47.79, -122.49]], PATH_A] }),
    );
    expect(features.map((f) => f.id)).toEqual(["s2~0"]);
  });

  it("emits nothing for a zone with no editable geometry (a bare pin)", () => {
    expect(zoneDrawFeatures(zone({ id: "pin" }))).toEqual([]);
  });
});

describe("streetPathsFromFeatures", () => {
  // Geometry is keyed off the id's ENCODED index, not the argument position —
  // otherwise the fixture and the function under test would disagree about what
  // "path 0" means, and the ordering assertion would prove nothing.
  const snapshot = (...ids: string[]): GeoJSONStoreFeatures[] =>
    ids.map(
      (id) =>
        ({
          id,
          type: "Feature",
          properties: { mode: "linestring" },
          geometry: {
            type: "LineString",
            coordinates: (pathIndexOfFeature(id) === 0 ? PATH_A : PATH_B).map((p) => [
              p[1],
              p[0],
            ]),
          },
        }) as GeoJSONStoreFeatures,
    );

  it("round-trips every path of a multi-path zone, in index order", () => {
    // THE bug this whole module exists to prevent: the API rebuilds the zone
    // from a whitelist, so returning only the edited path deletes the rest.
    const out = streetPathsFromFeatures("s1", snapshot("s1~1", "s1~0"));
    expect(out).toHaveLength(2);
    expect(out![0]).toEqual(PATH_A); // index 0 first, despite snapshot order
  });

  it("ignores features belonging to other zones", () => {
    const out = streetPathsFromFeatures("s1", snapshot("s1~0", "s2~0"));
    expect(out).toHaveLength(1);
  });

  it("returns NULL, not [], when the store holds nothing for the zone", () => {
    // The distinction is the safety net: [] reads as "this zone has no lines"
    // and would wipe them, whereas null tells the caller to keep what it had.
    expect(streetPathsFromFeatures("s1", [])).toBeNull();
    expect(streetPathsFromFeatures("s1", snapshot("other~0"))).toBeNull();
  });

  it("survives a full features → paths → features round trip unchanged", () => {
    const original = zone({ id: "s1", streetPaths: [PATH_A, PATH_B] });
    const back = streetPathsFromFeatures("s1", zoneDrawFeatures(original));
    expect(back).toEqual([PATH_A, PATH_B]);
  });

  it("round-trips the real multi-path seed zones byte-identically", () => {
    const multi = parkingZones.filter((z) => (z.streetPaths?.length ?? 0) > 1);
    expect(multi.length, "seed should still have multi-path streets").toBeGreaterThan(0);
    for (const z of multi) {
      expect(streetPathsFromFeatures(z.id, zoneDrawFeatures(z)), z.id).toEqual(z.streetPaths);
    }
  });
});

describe("isZoneFeature", () => {
  // Geometry is deliberately partial: isZoneFeature only reads `geometry.type`
  // and `properties.mode`, and spelling out coordinates would obscure that.
  const f = (type: string, mode: string) =>
    ({ id: "x", type: "Feature", properties: { mode }, geometry: { type } }) as unknown as
      GeoJSONStoreFeatures;

  it("accepts both zone shapes and rejects terra-draw's own handles", () => {
    expect(isZoneFeature(f("Polygon", "polygon"))).toBe(true);
    expect(isZoneFeature(f("LineString", "linestring"))).toBe(true);
    // Vertex handles, midpoints and closing points share the store.
    expect(isZoneFeature(f("Point", "point"))).toBe(false);
    expect(isZoneFeature(f("Point", "polygon"))).toBe(false);
  });
});

describe("pathMidpoint", () => {
  it("anchors a new street's label on the line itself", () => {
    expect(pathMidpoint(PATH_A)).toEqual([47.7968, -122.4955]);
  });

  it("handles a two-point line", () => {
    expect(pathMidpoint(PATH_B)).toEqual([47.7984, -122.4972]);
  });
});
