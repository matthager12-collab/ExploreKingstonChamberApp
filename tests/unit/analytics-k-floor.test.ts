// E11 AC-4: the k-floor applied INSIDE summarize() — an area bucket with too
// few distinct sessions is absent from geoPingsByArea, collapsed into the
// below-threshold bucket with totals preserved; same for sessionsByGeo
// (collapsed row flagged, sessions unioned not summed). Every consumer of
// summarize() inherits this — there is no unfloored path.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { appendAnalyticsEvent } from "@/lib/db/append";
import { summarize } from "@/lib/analytics-store";
import { BELOW_K_BUCKET } from "@/lib/privacy/policy";
import { createTestDb, type TestDb } from "../setup/pglite-db";

const geoSeattle = { country: "US", region: "WA", city: "Seattle", source: "dbip" };
const geoPoulsbo = { country: "US", region: "WA", city: "Poulsbo", source: "dbip" };
const geoTacoma = { country: "US", region: "WA", city: "Tacoma", source: "dbip" };

function ping(area: string, sessionId: string, geo = geoSeattle) {
  return appendAnalyticsEvent({
    ts: new Date().toISOString(),
    type: "geo-ping",
    path: "/",
    sessionId,
    geo,
    area,
  });
}

describe("summarize() k-floor (mixed dataset)", () => {
  let tdb: TestDb;

  beforeAll(async () => {
    tdb = await createTestDb();
    // ferry-terminal: 6 distinct sessions (clears k=5), 10 pings total.
    for (let i = 0; i < 6; i++) await ping("ferry-terminal", `s-ferry-${i}`);
    for (let i = 0; i < 4; i++) await ping("ferry-terminal", `s-ferry-${i}`);
    // village-green: 9 pings but only 2 distinct sessions — LOTS of pings
    // cannot save a bucket that few people produced.
    for (let i = 0; i < 9; i++) await ping("village-green", `s-vg-${i % 2}`, geoPoulsbo);
    // marina-waterfront: a single session — the re-identifiable case.
    await ping("marina-waterfront", "s-lone", geoTacoma);
  });

  afterAll(async () => {
    await tdb.close();
  });

  it("collapses below-floor areas into the below-threshold bucket, totals preserved", async () => {
    const summary = await summarize();
    const areas = summary.geoPingsByArea.map((r) => r.area);

    // The 1-session and 2-session areas are ABSENT by name:
    expect(areas).not.toContain("marina-waterfront");
    expect(areas).not.toContain("village-green");
    expect(areas).toContain("ferry-terminal");
    expect(areas).toContain(BELOW_K_BUCKET);

    // Collapsed row is last, and totals are preserved (9 + 1 = 10):
    expect(areas[areas.length - 1]).toBe(BELOW_K_BUCKET);
    expect(summary.geoPingsByArea.find((r) => r.area === BELOW_K_BUCKET)?.count).toBe(10);
    const total = summary.geoPingsByArea.reduce((s, r) => s + r.count, 0);
    expect(total).toBe(summary.geoPings);
  });

  it("floors sessionsByGeo the same way, with the collapsed flag", async () => {
    const summary = await summarize();
    // Seattle bucket: 6 ferry sessions — clears the floor, keeps its name.
    const seattle = summary.sessionsByGeo.find((g) => g.city === "Seattle");
    expect(seattle).toBeDefined();
    expect(seattle?.collapsed).toBeUndefined();
    // Poulsbo (2 sessions) and Tacoma (1 session) are absent by name,
    // merged into one collapsed row with UNIONED distinct sessions (3):
    expect(summary.sessionsByGeo.some((g) => g.city === "Poulsbo")).toBe(false);
    expect(summary.sessionsByGeo.some((g) => g.city === "Tacoma")).toBe(false);
    const rollup = summary.sessionsByGeo.find((g) => g.collapsed);
    expect(rollup).toBeDefined();
    expect(rollup?.sessions).toBe(3);
    // And it renders no place name:
    expect(rollup?.city).toBe("");
    expect(rollup?.country).toBe("");
  });
});

describe("summarize() k-floor (everything clears the floor)", () => {
  it("emits no below-threshold row at all", async () => {
    const tdb = await createTestDb();
    try {
      for (let i = 0; i < 7; i++) await ping("ferry-terminal", `s-only-${i}`);
      const summary = await summarize();
      expect(summary.geoPingsByArea).toEqual([{ area: "ferry-terminal", count: 7 }]);
      expect(summary.geoPingsByArea.some((r) => r.area === BELOW_K_BUCKET)).toBe(false);
      expect(summary.sessionsByGeo.some((g) => g.collapsed)).toBe(false);
    } finally {
      await tdb.close();
    }
  });
});
