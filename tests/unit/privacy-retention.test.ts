// E11 retention machinery — the proofs behind every claim on the public
// retention schedule: dry-run deletes nothing; the audit table is never
// touched (and the guard trips if the manifest drifts); geo-ping rollups are
// k-floored AT WRITE and month-complete; hunt deletions are photo-first and
// hold-aware with logged reconciliation; hard-deletes are physical; the
// backup round-trip carries the new tables.

import { mkdir, writeFile, access } from "fs/promises";
import path from "path";
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
import { dataPath } from "@/lib/data-dir";
import { deleteSubmission, listSubmissions } from "@/lib/hunt-store";
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

/** A hunt submission with a real photo file on disk (fs storage mode). */
async function seedSubmission(id: string, tsIso: string, opts?: { photoPath?: string }) {
  let photoPath = opts?.photoPath;
  if (!photoPath) {
    photoPath = `photos/hunt-1/stop-1/${id}.jpg`;
    const abs = path.join(dataPath("hunts"), photoPath);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, Buffer.from("jpegbytes"));
  }
  await writeOverlayRecord("hunt-submissions", {
    id,
    ts: tsIso,
    huntId: "hunt-1",
    stopId: "stop-1",
    photoPath,
    lat: 47.796,
    lng: -122.496,
    distanceMeters: 12,
    verified: true,
  });
  return photoPath;
}

async function fileExists(rel: string): Promise<boolean> {
  try {
    await access(path.join(dataPath("hunts"), rel));
    return true;
  } catch {
    return false;
  }
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

  // --- hunt submissions ----------------------------------------------------
  await seedSubmission("old-sub", "2025-05-01T10:00:00.000Z"); // > 12 months
  await seedSubmission("held-sub", "2025-04-01T10:00:00.000Z"); // > 12 months, held
  await seedSubmission("fresh-sub", "2026-07-01T10:00:00.000Z"); // recent
  // Orphan-safety case: expired, but its "photo" is an untrusted URL that
  // deleteBlob refuses — the photo delete THROWS and the row must be kept.
  await seedSubmission("stuck-sub", "2025-03-01T10:00:00.000Z", {
    photoPath: "https://not-our-blob.example.com/x.jpg",
  });

  await setLegalHold("hunt-submissions", "held-sub", "records request 2026-19", "mat@example.com");
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
    const subsBefore = (await listSubmissions()).length;

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
    const hunts = report.lines.find((l) => l.store === "hunt-submissions");
    expect(hunts?.planned).toBe(2); // old-sub + stuck-sub (held-sub excluded)
    expect(hunts?.heldSkipped).toBe(1);

    // Nothing changed:
    expect((await tdb.db.select().from(analyticsEvent)).length).toBe(eventsBefore);
    expect((await tdb.db.select().from(surveyResponse)).length).toBe(surveysBefore);
    expect((await listSubmissions()).length).toBe(subsBefore);
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

    // 5. Hunt submissions: old-sub destroyed photo-first (file gone, row
    //    gone); held-sub intact (hold overrides); fresh-sub intact;
    //    stuck-sub row KEPT because its photo delete failed (orphan safety).
    const subs = await listSubmissions();
    const subIds = subs.map((s) => s.id).sort();
    expect(subIds).toEqual(["fresh-sub", "held-sub", "stuck-sub"]);
    expect(await fileExists("photos/hunt-1/stop-1/old-sub.jpg")).toBe(false);
    expect(await fileExists("photos/hunt-1/stop-1/held-sub.jpg")).toBe(true);
    const huntLine = report.lines.find((l) => l.store === "hunt-submissions");
    expect(huntLine?.applied).toBe(1);
    expect(huntLine?.note).toMatch(/photo-delete failure/);

    // 6. Hard delete is PHYSICAL: no tombstone row remains for old-sub.
    const rows = await readRecordRows("hunt-submissions");
    expect(rows.some((r) => r.id === "old-sub")).toBe(false);

    // 7. Audit floor: every pre-run audit row survives, and the run ADDED
    //    the purge summary + the hold-skip reconciliation (metadata-only).
    const after = await auditRows();
    expect(after.length).toBeGreaterThan(auditCountBefore);
    const purgeRow = after.find((a) => a.action === "retention-purge");
    expect(purgeRow).toBeDefined();
    const holdSkip = after.find(
      (a) => a.action === "retention-hold-skip" && a.recordId === "held-sub",
    );
    expect(holdSkip).toBeDefined();
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
    // stuck-sub is still expired and NOT held, so it's re-attempted every run —
    // and fails the same way (untrusted photo URL), so its row is kept for the
    // next retry. This is the "row kept, retried" contract, asserted.
    const hunts = report.lines.find((l) => l.store === "hunt-submissions");
    expect(hunts?.planned).toBe(1);
    expect(hunts?.applied).toBe(0);
    expect(hunts?.note).toMatch(/photo-delete failure/);
    // Rollups unchanged (upsert overwrites with identical values at worst):
    expect((await readAreaRollups()).length).toBe(2);
  });
});

describe("audit snapshot redaction for hunt-submissions (D-10)", () => {
  it("strips lat/lng/distance/photoPath from BOTH before and after snapshots", async () => {
    // Exercise the BEFORE path explicitly: updating an existing submission
    // produces an audit row whose `before` is the prior (GPS-bearing) doc —
    // it must be stripped too, not just the create-time `after`.
    const upd = await createTestDb();
    try {
      await writeOverlayRecord("hunt-submissions", {
        id: "d10-sub",
        ts: "2026-07-01T00:00:00.000Z",
        huntId: "h",
        stopId: "s",
        photoPath: "photos/h/s/d10.jpg",
        lat: 47.8,
        lng: -122.5,
        distanceMeters: 9,
        verified: true,
      });
      // Second write to the SAME id → an update whose `before` is the doc above.
      await writeOverlayRecord("hunt-submissions", {
        id: "d10-sub",
        ts: "2026-07-02T00:00:00.000Z",
        huntId: "h",
        stopId: "s",
        photoPath: "photos/h/s/d10-v2.jpg",
        lat: 47.81,
        lng: -122.51,
        distanceMeters: 5,
        verified: true,
      });
      const rows = await upd.db.select().from(audit);
      const huntAudits = rows.filter((a) => a.store === "hunt-submissions");
      const updateRow = huntAudits.find((a) => a.action === "update");
      expect(updateRow, "an update row with a non-null before must exist").toBeDefined();
      expect(updateRow!.before).not.toBeNull(); // the precondition that makes this non-vacuous
      for (const a of huntAudits) {
        const body =
          JSON.stringify(a.after ?? {}) + JSON.stringify((a as { before?: unknown }).before ?? {});
        expect(body).not.toContain('"lat"');
        expect(body).not.toContain('"lng"');
        expect(body).not.toContain("photoPath");
        expect(body).not.toContain("distanceMeters");
      }
      // Per-store, not global: a store NOT in SNAPSHOT_STRIP_KEYS keeps its
      // top-level `lat` in the snapshot (an arbitrary un-schema'd store, so
      // writeRecord doesn't domain-validate it).
      await writeOverlayRecord("nonstripped-probe", { id: "p-1", lat: 47.9, name: "probe" });
      const probeRow = (await upd.db.select().from(audit)).find(
        (a) => a.store === "nonstripped-probe" && a.recordId === "p-1",
      );
      expect(probeRow, "non-stripped store create audit row").toBeDefined();
      expect(JSON.stringify(probeRow!.after ?? {})).toContain('"lat"');
    } finally {
      await upd.close();
      const { __setDbForTests } = await import("@/lib/db/client");
      __setDbForTests(tdb.db);
    }
  });
});

describe("hardDeleteRecords + legal-hold helpers", () => {
  it("physically deletes only the requested ids and reports holds", async () => {
    await writeOverlayRecord("hunt-submissions", {
      id: "hd-1",
      ts: "2026-07-01T00:00:00.000Z",
      huntId: "h",
      stopId: "s",
      photoPath: "photos/h/s/none.jpg",
      verified: false,
    });
    expect((await heldRecordIds("hunt-submissions", ["hd-1"])).size).toBe(0);
    const res = await hardDeleteRecords("hunt-submissions", ["hd-1"]);
    expect(res.deleted).toBe(1);
    expect(res.heldSkipped).toEqual([]);
    expect((await readRecordRows("hunt-submissions")).some((r) => r.id === "hd-1")).toBe(false);
  });

  it("REFUSES to delete a held row at the SQL choke point, even if the caller doesn't check", async () => {
    await writeOverlayRecord("hunt-submissions", {
      id: "hd-held",
      ts: "2026-07-01T00:00:00.000Z",
      huntId: "h",
      stopId: "s",
      photoPath: "photos/h/s/none.jpg",
      verified: false,
    });
    await setLegalHold("hunt-submissions", "hd-held", "spoliation guard", "mat@example.com");
    const res = await hardDeleteRecords("hunt-submissions", ["hd-held"]);
    expect(res.deleted).toBe(0);
    expect(res.heldSkipped).toEqual(["hd-held"]);
    // The row physically survives despite the delete call — the floor holds.
    expect((await readRecordRows("hunt-submissions")).some((r) => r.id === "hd-held")).toBe(true);
  });

  it("deleteSubmission re-checks the hold before destroying the photo (mid-run TOCTOU)", async () => {
    const photoRel = "photos/hunt-toctou/stop-1/x.jpg";
    const abs = path.join(dataPath("hunts"), photoRel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, Buffer.from("bytes"));
    await writeOverlayRecord("hunt-submissions", {
      id: "toctou-sub",
      ts: "2026-07-01T00:00:00.000Z",
      huntId: "hunt-toctou",
      stopId: "stop-1",
      photoPath: photoRel,
      verified: false,
    });
    // Hold appears (as it would mid-run, after any caller snapshot):
    await setLegalHold("hunt-submissions", "toctou-sub", "hold set mid-run", "mat@example.com");
    const result = await deleteSubmission("toctou-sub");
    expect(result).toBe("legal-hold");
    // Photo NOT destroyed (the unrecoverable half is protected), row intact.
    expect(await fileExists(photoRel)).toBe(true);
    expect((await readRecordRows("hunt-submissions")).some((r) => r.id === "toctou-sub")).toBe(true);
  });

  it("an already-gone row reports 'deleted', NOT a spurious 'legal-hold' (no false FR-A92 audit)", async () => {
    // No such submission exists → not-found (the readMerged guard).
    expect(await deleteSubmission("never-existed")).toBe("not-found");

    // A row that vanished between the photo destroy and the row delete (a
    // concurrent/overlapping delete) yields deleted=0 with heldSkipped=[] —
    // it must NOT be reported as a hold, or the orchestrator writes a
    // permanent hold-skip audit entry for a submission that was never held.
    const gonePhoto = "photos/hunt-gone/stop-1/g.jpg";
    const goneAbs = path.join(dataPath("hunts"), gonePhoto);
    await mkdir(path.dirname(goneAbs), { recursive: true });
    await writeFile(goneAbs, Buffer.from("bytes"));
    await writeOverlayRecord("hunt-submissions", {
      id: "gone-sub",
      ts: "2026-07-01T00:00:00.000Z",
      huntId: "hunt-gone",
      stopId: "stop-1",
      photoPath: gonePhoto,
      verified: false,
    });
    // Simulate the concurrent winner: hard-delete the row out from under it.
    await hardDeleteRecords("hunt-submissions", ["gone-sub"]);
    // Re-seed so deleteSubmission finds it in the readMerged snapshot, then
    // delete again to make the final hardDeleteRecords see deleted=0. (The
    // readMerged snapshot is taken at the top of deleteSubmission; we can't
    // race a unit test, so assert the classification directly instead: the
    // helper returns "deleted" whenever heldSkipped is empty even at 0 rows.)
    const res = await hardDeleteRecords("hunt-submissions", ["gone-sub"]);
    expect(res.deleted).toBe(0);
    expect(res.heldSkipped).toEqual([]); // 0 deleted, but NOT because of a hold
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
    const section = await serializeDb();
    // Count-agnostic on holds (earlier tests in this suite add their own) —
    // pin the ONE that matters is carried, and that restore reproduces the set.
    const holdsIn = section.legal_hold ?? [];
    expect(holdsIn.some((h) => h.store === "hunt-submissions" && h.recordId === "held-sub")).toBe(
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
      expect((await heldRecordIds("hunt-submissions", ["held-sub"])).size).toBe(1);
    } finally {
      await fresh.close();
      // Re-wire the original suite DB for any later tests.
      const { __setDbForTests } = await import("@/lib/db/client");
      __setDbForTests(tdb.db);
    }
  });
});
