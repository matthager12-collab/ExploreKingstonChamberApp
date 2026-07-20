import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../setup/pglite-db";
import {
  recordMarker,
  getMarkers,
  getMarker,
} from "@/lib/stores/ops-markers-store";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(() => tdb.close());

describe("ops-markers store", () => {
  it("records and reads back a marker, stamping `at`", async () => {
    const before = Date.now();
    const m = await recordMarker("backup:last-success", {
      fileCount: 42,
      kind: "bundle-download",
    });
    expect(m.id).toBe("backup:last-success");
    expect(m.fileCount).toBe(42);
    expect(typeof m.at).toBe("string");
    expect(Date.parse(m.at)).toBeGreaterThanOrEqual(before);

    const got = await getMarker("backup:last-success");
    expect(got?.fileCount).toBe(42);
    expect(got?.kind).toBe("bundle-download");
    expect(got?.at).toBe(m.at);
  });

  it("overwrites the same id in place (heartbeat semantics, one row)", async () => {
    await recordMarker("job:ams-sync", { n: 1 });
    await recordMarker("job:ams-sync", { n: 2 });
    const rows = (await getMarkers()).filter((x) => x.id === "job:ams-sync");
    expect(rows).toHaveLength(1);
    expect(rows[0].n).toBe(2);
  });

  it("accepts colon-namespaced ids (the reserved backup + job convention)", async () => {
    await expect(recordMarker("job:geoip-refresh")).resolves.toMatchObject({
      id: "job:geoip-refresh",
    });
  });

  it("getMarker returns undefined for an id never written", async () => {
    expect(await getMarker("never:written")).toBeUndefined();
  });
});
