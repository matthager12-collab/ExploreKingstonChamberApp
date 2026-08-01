// E31 phase 6 — seed invariants for the street-parking curb model.
//
// The honesty rules these tests hold:
//   1. Street geometry is LIFTED from the app's OSM-derived overlay
//      (public/geo/street-parking.json), never invented — every seeded path
//      vertex must exist verbatim in that file.
//   2. A curb side is seeded ONLY where a source names the side. Today that is
//      exactly one zone: Washington Blvd between the SR 104 legs ("both
//      sides", Chamber field-verified July 2026, PR #78's documented extent).
//   3. The two park & rides keep their rule — the map's P&R badge and the
//      /parking "Leave the car here" callout both key off it.
//   4. The dead legacy `parkingAreas` array (PR #78's finding) stays deleted.

import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { CURB_SIDES, parkingZones, type MapZone } from "@/lib/data/parking";
import { withSeedStreetGeometry } from "@/lib/stores/parking-store";

const streetZones = parkingZones.filter((z) => z.streetPaths?.length);

// Greater Kingston bbox, same limits the admin API enforces.
const inKingston = (p: [number, number]) =>
  p[0] >= 47.5 && p[0] <= 48.1 && p[1] >= -123 && p[1] <= -122.2;

describe("street zones (curb model seed)", () => {
  it("every street-rule zone carries centre-line geometry", () => {
    const streetIds = parkingZones
      .filter((z) => z.id.startsWith("street-"))
      .map((z) => z.id);
    const missing = streetIds.filter(
      (id) => !streetZones.some((z) => z.id === id),
    );
    expect(
      missing,
      `street zone(s) without streetPaths — they would fall back to an anonymous circle: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("every path is a real polyline inside the Kingston box", () => {
    for (const z of streetZones) {
      for (const path of z.streetPaths!) {
        expect(path.length, `${z.id}: a path needs ≥2 points`).toBeGreaterThanOrEqual(2);
        for (const p of path) {
          expect(inKingston(p), `${z.id}: point ${JSON.stringify(p)} outside Kingston`).toBe(true);
        }
      }
    }
  });

  it("every seeded vertex exists verbatim in the OSM-derived street overlay (nothing invented)", () => {
    const overlay = JSON.parse(
      readFileSync(path.join(process.cwd(), "public", "geo", "street-parking.json"), "utf8"),
    ) as { segments: { coords: [number, number][] }[] };
    const known = new Set(
      overlay.segments.flatMap((s) => s.coords.map((c) => `${c[0]},${c[1]}`)),
    );
    for (const z of streetZones) {
      for (const path of z.streetPaths!) {
        for (const p of path) {
          expect(
            known.has(`${p[0]},${p[1]}`),
            `${z.id}: vertex ${JSON.stringify(p)} is not in public/geo/street-parking.json — street geometry must come from the overlay, not be drawn by hand`,
          ).toBe(true);
        }
      }
    }
  });

  it("curb sides are valid and only set on zones that have street geometry", () => {
    for (const z of parkingZones) {
      if (z.curb === undefined) continue;
      expect(CURB_SIDES.includes(z.curb), `${z.id}: unknown curb "${z.curb}"`).toBe(true);
      expect(
        Boolean(z.streetPaths?.length),
        `${z.id}: curb without streetPaths is meaningless`,
      ).toBe(true);
    }
  });

  it("seeds a curb ONLY where the source names the side (today: the Washington Blvd loop block)", () => {
    const withCurb = parkingZones.filter((z) => z.curb !== undefined).map((z) => z.id);
    expect(withCurb).toEqual(["street-washington-blvd-104-loop"]);
    const loop = parkingZones.find((z) => z.id === "street-washington-blvd-104-loop")!;
    expect(loop.curb).toBe("both");
    // PR #78's documented extent: bounded by an SR 104 junction at each end.
    const [pathA] = loop.streetPaths!;
    expect(pathA[0]).toEqual([47.79704, -122.49693]);
    expect(pathA[pathA.length - 1]).toEqual([47.79755, -122.49563]);
  });

  it("the offload-route zone stops short of the loop block (the PR #78 carve-out)", () => {
    const offload = parkingZones.find((z) => z.id === "street-washington-blvd")!;
    // No vertex of the prohibited stretch may sit INSIDE the free-2hr block
    // (its endpoints are shared junction nodes and may touch).
    for (const path of offload.streetPaths!) {
      for (const [lat, lng] of path) {
        const insideLoop =
          lat < 47.79755 && lat > 47.79704 && lng > -122.49693 && lng < -122.49563;
        expect(insideLoop, `street-washington-blvd claims [${lat}, ${lng}] inside the 2-hr loop block`).toBe(false);
      }
    }
  });
});

describe("park & rides", () => {
  it("both Kitsap Transit lots keep the park-and-ride rule (badge + callout key off it)", () => {
    for (const id of ["georges-corner-pr", "bayside-pr"]) {
      const z = parkingZones.find((zone) => zone.id === id);
      expect(z, `${id} missing from the seed`).toBeDefined();
      expect(z!.rule).toBe("park-and-ride-24h");
      // The callout renders the bus routes from the summary — keep them there.
      expect(z!.summary).toMatch(/\b(30[27]|391)\b/);
    }
  });
});

describe("legacy parkingAreas stays retired", () => {
  it("the dead array PR #78 identified does not come back", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src", "lib", "data", "parking.ts"),
      "utf8",
    );
    expect(src).not.toContain("parkingAreas");
    const types = readFileSync(
      path.join(process.cwd(), "src", "lib", "types.ts"),
      "utf8",
    );
    expect(types).not.toContain("interface ParkingArea");
  });
});

describe("overlay-record migration (withSeedStreetGeometry)", () => {
  // The whole-record overlay merge means a zone saved BEFORE phase 6 has no
  // streetPaths/curb and would mask the seeded geometry forever (the editor
  // can't put paths back; delete is a tombstone, not reset-to-seed). The
  // store migrates such records at read time — these pin the rules.
  const loopSeed = parkingZones.find((z) => z.id === "street-washington-blvd-104-loop")!;

  /** An overlay record the pre-phase-6 admin API produced: the whitelist
   *  rebuild without the street fields, with an admin edit on top. */
  const legacyRecord = (id: string): MapZone => {
    const { streetPaths: _p, curb: _c, ...rest } = parkingZones.find((z) => z.id === id)!;
    return { ...rest, name: "Edited by admin" };
  };

  it("backfills seed streetPaths AND curb into a pre-phase-6 record, keeping the admin edits", () => {
    const migrated = withSeedStreetGeometry(legacyRecord(loopSeed.id));
    expect(migrated.streetPaths).toEqual(loopSeed.streetPaths);
    expect(migrated.curb).toBe("both");
    expect(migrated.name).toBe("Edited by admin");
  });

  it("leaves a post-phase-6 record with a deliberately cleared curb alone (paths present, no curb)", () => {
    const cleared: MapZone = { ...legacyRecord(loopSeed.id), streetPaths: loopSeed.streetPaths };
    const out = withSeedStreetGeometry(cleared);
    expect(out.curb).toBeUndefined();
    expect(out.streetPaths).toBe(loopSeed.streetPaths); // untouched
  });

  it("never overwrites a record's own street geometry", () => {
    const ownPaths: [number, number][][] = [[[47.797, -122.496], [47.798, -122.495]]];
    const out = withSeedStreetGeometry({ ...legacyRecord(loopSeed.id), streetPaths: ownPaths });
    expect(out.streetPaths).toBe(ownPaths);
  });

  it("is a no-op for lot zones and unknown ids", () => {
    const lot = parkingZones.find((z) => z.id === "georges-corner-pr")!;
    expect(withSeedStreetGeometry(lot)).toEqual(lot);
    const custom: MapZone = { ...legacyRecord(loopSeed.id), id: "admin-made-zone" };
    expect(withSeedStreetGeometry(custom)).toEqual(custom);
  });

  it("migrates every seeded street zone, not just the flagship", () => {
    for (const z of streetZones) {
      const migrated = withSeedStreetGeometry(legacyRecord(z.id));
      expect(migrated.streetPaths, z.id).toEqual(z.streetPaths);
    }
  });
});

describe("renderer wiring (text-level, the parking-labels pattern)", () => {
  it("feature-map draws street zones through the curb layer, offset by curbOffsetSigns", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src", "components", "feature-map.tsx"),
      "utf8",
    );
    expect(src).toContain('"fm-curbs"');
    expect(src).toContain('"line-offset"');
    expect(src).toContain("curbOffsetSigns(");
  });
});
