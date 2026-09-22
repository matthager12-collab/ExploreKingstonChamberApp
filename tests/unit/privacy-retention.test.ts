// E11 retention machinery — the proofs behind every claim on the public
// retention schedule: dry-run deletes nothing; the audit table is never
// touched (and the guard trips if the manifest drifts); geo-ping rollups are
// k-floored AT WRITE and month-complete; hard-deletes are physical; the
// backup round-trip carries the new tables.
//
// The scavenger hunt was removed on 2026-09-22. Its executor was the only
// one that deleted a file before its row and the only one that consulted a
// legal hold, so those two proofs left with it.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { appendAnalyticsEvent } from "@/lib/db/append";
import { analyticsEvent, audit, surveyResponse } from "@/lib/db/schema";
import {
  appendPrivacyAudit,
  hardDeleteRecords,
  heldRecordIds,
  setLegalHold,
} from "@/lib/db/privacy-delete";
import { readAreaRollups } from "@/lib/db/privacy-retention";
import { readRecordRows } from "@/lib/db/records";
import { serializeDb, restoreDb } from "@/lib/db/export";
import { writeOverlayRecord } from "@/lib/stores/json-store";
import { assertAuditNeverPurged, runRetention } from "@/lib/privacy/retention";
import { RETENTION_POLICY } from "@/lib/privacy/policy";
import { createTestDb, type TestDb } from "../setup/pglite-db";

// Fixed clock: everything below is relative to this "today".
const NOW = new Date("2026-07-20T12:00:00.000Z");

let tdb: TestDb;

/** Seed an analytics event with an EXPLICIT table timestamp (the append
 *  helper stamps defaultNow(), which age-based tests can't use). */
async function seedEvent(tsIso: string, event: Record<string, unknown>) {
  await tdb.db.insert(analyticsEvent).values({ ts: new Date(tsIso), event });
}

async function seedSurvey(tsIso: string, response: Record<string, unknown>) {
  await tdb.db.insert(surveyResponse).values({ ts: new Date(tsIso), response });
}


async function auditRows(): Promise<{ action: string; store: string; recordId: string; after: unknown }[]> {
  return tdb.db.select().from(audit);
}

beforeAll(async () => {
  tdb = await createTestDb();

  // --- analytics: a complete old month (Jan 2026, > 90d before NOW) -------
  // ferry-terminal: 6 distinct sessions (clears k=5); marina: 2 (below).
  for (let i = 0; i < 6; i++) {
    await seedEvent(`2026-01-1${i}T10:00:00.000Z`, {
      ts: `2026-01-1${i}T10:00:00.000Z`,
      type: "geo-ping",
      path: "/",
      sessionId: `jan-ferry-${i}`,
      geo: { source: "unknown" },
      area: "ferry-terminal",
    });
  }
  for (let i = 0; i < 3; i++) {
    await seedEvent(`2026-01-2${i}T10:00:00.000Z`, {
      ts: `2026-01-2${i}T10:00:00.000Z`,
      type: "geo-ping",
      path: "/",
      sessionId: `jan-marina-${i % 2}`,
      geo: { source: "unknown" },
      area: "marina-waterfront",
    });
  }
  // A CURRENT-month geo-ping (incomplete month — must survive every run).
  await seedEvent("2026-07-19T10:00:00.000Z", {
    ts: "2026-07-19T10:00:00.000Z",
    type: "geo-ping",
    path: "/",
    sessionId: "july-current",
    geo: { source: "unknown" },
    area: "ferry-terminal",
  });
  // Non-geo: one ancient pageview (> 25 months), one recent outbound.
  await seedEvent("2024-01-01T10:00:00.000Z", {
    ts: "2024-01-01T10:00:00.000Z",
    type: "pageview",
    path: "/eat",
    sessionId: "ancient-pv",
    geo: { source: "unknown" },
  });
  await seedEvent("2026-07-01T10:00:00.000Z", {
    ts: "2026-07-01T10:00:00.000Z",
    type: "outbound",
    path: "/eat",
    sessionId: "recent-ob",
    geo: { source: "unknown" },
    href: "https://example-restaurant.com/menu",
    label: "Menu",
  });

  // --- survey: one ancient (> 36 months), one recent -----------------------
  await seedSurvey("2023-01-01T10:00:00.000Z", { submittedAt: "2023-01-01", distanceBand: "local", overnight: false });
  await seedSurvey("2026-07-01T10:00:00.000Z", { submittedAt: "2026-07-01", distanceBand: "10-50mi", overnight: true });

});

afterAll(async () => {
  await tdb.close();
});

describe("assertAuditNeverPurged", () => {
  it("passes on the real manifest and throws when audit drifts", () => {
    expect(() => assertAuditNeverPurged()).not.toThrow();
    expect(() =>
      assertAuditNeverPurged(RETENTION_POLICY.filter((r) => r.store !== "audit")),
    ).toThrow(/never-purge/);
    expect(() =>
      assertAuditNeverPurged(
        RETENTION_POLICY.map((r) => (r.store === "audit" ? { ...r, action: "delete" as const } : r)),
      ),
    ).toThrow(/never-purge/);
  });
});

describe("runRetention dry-run", () => {
  it("reports one line per RETENTION_POLICY entry and deletes NOTHING", async () => {
    const eventsBefore = (await tdb.db.select().from(analyticsEvent)).length;
    const surveysBefore = (await tdb.db.select().from(surveyResponse)).length;

    const report = await runRetention({ apply: false, now: NOW });

    expect(report.mode).toBe("dry-run");
    expect(report.lines.map((l) => l.store).sort()).toEqual(
      RETENTION_POLICY.map((r) => r.store).sort(),
    );
    // Audit line is the hardcoded refusal:
    expect(report.lines.find((l) => l.store === "audit")?.note).toMatch(/NEVER PURGED/);
    // Planned counts see the seeded data:
    expect(report.lines.find((l) => l.store === "analytics-geo-pings")?.planned).toBe(9);
    expect(report.lines.find((l) => l.store === "analytics-events")?.planned).toBe(1);
    expect(report.lines.find((l) => l.store === "survey-responses")?.planned).toBe(1);
    // Nothing changed:
    expect((await tdb.db.select().from(analyticsEvent)).length).toBe(eventsBefore);
    expect((await tdb.db.select().from(surveyResponse)).length).toBe(surveysBefore);
    expect(await readAreaRollups()).toEqual([]);
  });
});

describe("runRetention --apply", () => {
  it("executes every window, k-floors the rollup at write, honors holds, keeps audit rows", async () => {
    const auditCountBefore = (await auditRows()).length;

    const report = await runRetention({ apply: true, now: NOW });
    expect(report.mode).toBe("apply");

    // 1. Geo-pings: January fully rolled up + deleted; July's ping survives.
    const remainingGeo = (await tdb.db.select().from(analyticsEvent))
      .map((r) => r.event as Record<string, unknown>)
      .filter((e) => e.type === "geo-ping");
    expect(remainingGeo).toHaveLength(1);
    expect(remainingGeo[0].sessionId).toBe("july-current");

    // 2. Rollup rows are k-floored AT WRITE: marina (2 sessions) is absent
    //    by name; ferry-terminal row + below-threshold row carry the totals.
    const rollups = await readAreaRollups();
    expect(rollups).toEqual([
      { month: "2026-01", area: "below-threshold", pings: 3, sessions: 2 },
      { month: "2026-01", area: "ferry-terminal", pings: 6, sessions: 6 },
    ]);

    // 3. Non-geo events: ancient pageview gone, recent outbound survives.
    const remainingOther = (await tdb.db.select().from(analyticsEvent))
      .map((r) => r.event as Record<string, unknown>)
      .filter((e) => e.type !== "geo-ping");
    expect(remainingOther.map((e) => e.sessionId)).toEqual(["recent-ob"]);

    // 4. Survey: ancient row gone, the RECENT one survives (pin identity, not
    //    just count — an inverted cutoff that deletes the recent row and keeps
    //    the ancient one would also pass a bare length check).
    const remainingSurveys = await tdb.db.select().from(surveyResponse);
    expect(
      remainingSurveys.map((r) => (r.response as { submittedAt: string }).submittedAt),
    ).toEqual(["2026-07-01"]);


    // 7. Audit floor: every pre-run audit row survives, and the run ADDED
    //    the purge summary + the hold-skip reconciliation (metadata-only).
    const after = await auditRows();
    expect(after.length).toBeGreaterThan(auditCountBefore);
    const purgeRow = after.find((a) => a.action === "retention-purge");
    expect(purgeRow).toBeDefined();
    // The hold-skip reconciliation used to be asserted here against a held
    // hunt submission. The scavenger hunt was removed on 2026-09-22, and its
    // executor was the only one that consulted a legal hold, so no retention
    // sweep produces a retention-hold-skip row any more. Holds still bind the
    // E11 access/delete path — hardDeleteRecords — which is asserted below.
    expect(after.some((a) => a.action === "retention-hold-skip")).toBe(false);
    // Metadata-only contract: no coordinates or photo pointers in the bodies.
    for (const row of after) {
      const body = JSON.stringify(row.after ?? {});
      expect(body).not.toContain('"lat"');
      expect(body).not.toContain("photoPath");
    }
  });

  it("is idempotent: a second apply run has nothing left to do", async () => {
    const report = await runRetention({ apply: true, now: NOW });
    expect(report.lines.find((l) => l.store === "analytics-geo-pings")?.applied).toBe(0);
    expect(report.lines.find((l) => l.store === "analytics-events")?.applied).toBe(0);
    expect(report.lines.find((l) => l.store === "survey-responses")?.applied).toBe(0);
    // The "row kept, retried" contract used to be asserted here against a hunt
    // submission whose photo delete always failed. That store went with the
    // scavenger hunt on 2026-09-22. Nothing left in RETENTION_POLICY deletes a
    // file alongside its row, so there is no retry case to assert.
    // Rollups unchanged (upsert overwrites with identical values at worst):
    expect((await readAreaRollups()).length).toBe(2);
  });
});

describe("hardDeleteRecords + legal-hold helpers", () => {
  it("physically deletes only the requested ids and reports holds", async () => {
    await writeOverlayRecord("test-overlay", {
      id: "hd-1",
      ts: "2026-07-01T00:00:00.000Z",
      huntId: "h",
      stopId: "s",
      photoPath: "photos/h/s/none.jpg",
      verified: false,
    });
    expect((await heldRecordIds("test-overlay", ["hd-1"])).size).toBe(0);
    const res = await hardDeleteRecords("test-overlay", ["hd-1"]);
    expect(res.deleted).toBe(1);
    expect(res.heldSkipped).toEqual([]);
    expect((await readRecordRows("test-overlay")).some((r) => r.id === "hd-1")).toBe(false);
  });

  it("REFUSES to delete a held row at the SQL choke point, even if the caller doesn't check", async () => {
    await writeOverlayRecord("test-overlay", {
      id: "hd-held",
      ts: "2026-07-01T00:00:00.000Z",
      huntId: "h",
      stopId: "s",
      photoPath: "photos/h/s/none.jpg",
      verified: false,
    });
    await setLegalHold("test-overlay", "hd-held", "spoliation guard", "mat@example.com");
    const res = await hardDeleteRecords("test-overlay", ["hd-held"]);
    expect(res.deleted).toBe(0);
    expect(res.heldSkipped).toEqual(["hd-held"]);
    // The row physically survives despite the delete call — the floor holds.
    expect((await readRecordRows("test-overlay")).some((r) => r.id === "hd-held")).toBe(true);
  });
});

describe("backup round-trip carries the E11 tables", () => {
  it("serializeDb includes rollups + legal holds; restoreDb reinstates them", async () => {
    await appendPrivacyAudit({
      actor: "test",
      action: "noop",
      store: "privacy",
      recordId: "rt",
      detail: {},
    });
    // This used to lean on a held hunt submission seeded in beforeAll. The
    // hunt went on 2026-09-22, so the hold this test needs is seeded here —
    // which also stops it depending on the order of the tests above it.
    await setLegalHold("test-overlay", "rt-held", "backup round-trip", "mat@example.com");
    const section = await serializeDb();
    // Count-agnostic on holds (earlier tests in this suite add their own) —
    // pin the ONE that matters is carried, and that restore reproduces the set.
    const holdsIn = section.legal_hold ?? [];
    expect(holdsIn.some((h) => h.store === "test-overlay" && h.recordId === "rt-held")).toBe(
      true,
    );
    expect(section.analytics_area_rollup).toHaveLength(2);

    // Restore into a FRESH database and verify both tables landed.
    const fresh = await createTestDb();
    try {
      const counts = await restoreDb(section, { force: false });
      expect(counts.analytics_area_rollup).toBe(2);
      expect(counts.legal_hold).toBe(holdsIn.length);
      expect(await readAreaRollups()).toHaveLength(2);
      expect((await heldRecordIds("test-overlay", ["rt-held"])).size).toBe(1);
    } finally {
      await fresh.close();
      // Re-wire the original suite DB for any later tests.
      const { __setDbForTests } = await import("@/lib/db/client");
      __setDbForTests(tdb.db);
    }
  });
});
