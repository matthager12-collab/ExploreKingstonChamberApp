// Regression: an overlay record written BEFORE `pay` existed must not mask the
// seeded payment hand-off.
//
// This shipped broken in #168. The seed gives every Port zone a `pay` hand-off,
// the /parking cards render from getParkingZones(), and the section still came
// up empty in production — because the seed+overlay merge is WHOLE-RECORD
// (records.ts `byId.set(o.id, o)`), and the Chamber had already edited those
// zones to attach lot photos. Every one of those overlay rows predates `pay`,
// so the merged zone had none and all four cards silently disappeared.
//
// It is the same trap withSeedStreetGeometry() was written for, and the same
// fix: heal on read rather than backfill the database.
//
// The wrinkle `pay` has and `streetPaths` does not: an admin can legitimately
// REMOVE the last hand-off, and that must keep persisting as removed. So the
// two states are distinguished explicitly — `undefined` means "this record
// predates the field, use the seed", `[]` means "an admin cleared it".
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { createTestDb, type TestDb } from "../setup/pglite-db";
import { parkingZones, type MapZone } from "@/lib/data/parking";
import { getParkingZones, saveParkingZone } from "@/lib/stores/parking-store";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(() => tdb.close());

const seedFor = (id: string): MapZone => {
  const z = parkingZones.find((x) => x.id === id);
  if (!z) throw new Error(`no seed zone ${id}`);
  return z;
};

describe("pay survives a pre-existing overlay record", () => {
  it("the seed itself has the hand-off", () => {
    expect(seedFor("port-pokhill").pay?.[0]?.code).toBe("POKHILL");
  });

  it("restores pay when an overlay row predates the field", async () => {
    // Exactly what production held: a real edit (a photo) saved by an admin
    // before `pay` existed, so the stored record simply has no such key.
    const { pay: _dropped, ...withoutPay } = seedFor("port-pokhill");
    await saveParkingZone({ ...withoutPay, images: ["abc123.jpg"] } as MapZone);

    const merged = (await getParkingZones()).find((z) => z.id === "port-pokhill")!;
    expect(merged.images).toEqual(["abc123.jpg"]); // the admin's edit is kept
    expect(merged.pay?.[0]?.code).toBe("POKHILL"); // and the seed's pay is back
  });

  it("leaves an admin's deliberate removal alone", async () => {
    // An empty ARRAY is the explicit "there is no way to pay for this lot"
    // that the editor writes when the last hand-off is deleted. Healing it
    // would resurrect a code the Chamber just took down.
    await saveParkingZone({ ...seedFor("port-poktt"), pay: [] });

    const merged = (await getParkingZones()).find((z) => z.id === "port-poktt")!;
    expect(merged.pay ?? []).toEqual([]);
  });

  it("does not overwrite a hand-off the admin actually changed", async () => {
    await saveParkingZone({
      ...seedFor("port-pokpark-89-103"),
      pay: [{ vendor: "t2", code: "NEWCODE", shortCode: "12345" }],
    });

    const merged = (await getParkingZones()).find(
      (z) => z.id === "port-pokpark-89-103",
    )!;
    expect(merged.pay?.[0]?.code).toBe("NEWCODE");
  });
});
