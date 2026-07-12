// importer (E05): runImport over the committed miniature DATA_DIR fixture
// (tests/fixtures/data-dir) against PGlite. Covers the dry-run diff, the
// apply path (tombstones, synthetic submission ids, the invite code→id
// mirror, quarantine, 'import' audit rows, append tables), re-run
// idempotence (0 writes, no new audit rows, append SKIP), the HaltError
// contract for unparseable files, and the confirm-abort path.
//
// runImport writes through the SAME injected db as the assertions (PGlite
// via __setDbForTests), so each describe that needs isolation gets its own
// fresh instance.

import { eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { audit, quarantine, record } from "@/lib/db/schema";
import {
  HaltError,
  runImport,
  submissionId,
  type ImportOptions,
  type ImportResult,
} from "../../scripts/import-core";
import { createTestDb, type TestDb } from "../setup/pglite-db";

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/data-dir", import.meta.url));
const CORRUPT_FIXTURE_DIR = fileURLToPath(
  new URL("../fixtures/data-dir-corrupt", import.meta.url),
);

function importOpts(overrides: Partial<ImportOptions> = {}): ImportOptions {
  return {
    dataDir: FIXTURE_DIR,
    apply: false,
    forceAppend: false,
    confirm: async () => true,
    host: "test-db",
    ...overrides,
  };
}

/** The legacy id-less submission exactly as it appears in submissions.jsonl. */
const LEGACY_SUBMISSION = {
  ts: "2026-05-02T11:30:00.000Z",
  huntId: "kingston-classic",
  stopId: "stop-2",
  photoPath: "photos/kingston-classic/stop-2/b.jpg",
};

describe("dry run (apply: false)", () => {
  let tdb: TestDb;
  let result: ImportResult;
  beforeAll(async () => {
    tdb = await createTestDb();
    result = await runImport(importOpts());
  });
  afterAll(async () => {
    await tdb.close();
  });

  it("exits 2: the invalid restaurant and the corrupt submissions line are quarantined", () => {
    expect(result.exitCode).toBe(2);
    expect(result.quarantined).toHaveLength(2);
    expect(result.quarantined).toContainEqual(
      expect.objectContaining({ store: "restaurants", id: "no-name-cafe" }),
    );
    expect(result.quarantined).toContainEqual(
      expect.objectContaining({
        store: "hunt-submissions",
        id: "line-3",
        where: "hunts/submissions.jsonl",
      }),
    );
  });

  it("reports per-store counts: quarantined rows count toward total, tombstones stay importable", () => {
    expect(result.perStore).toEqual({
      // 2 valid + 1 tombstone (importable) + 1 quarantined = 4
      restaurants: { total: 4, new: 3, changed: 0, unchanged: 0, tombstones: 1, quarantined: 1 },
      "site-copy": { total: 1, new: 1, changed: 0, unchanged: 0, tombstones: 0, quarantined: 0 },
      "auth-users": { total: 1, new: 1, changed: 0, unchanged: 0, tombstones: 0, quarantined: 0 },
      "auth-invites": { total: 1, new: 1, changed: 0, unchanged: 0, tombstones: 0, quarantined: 0 },
      "custom-hunts": { total: 1, new: 1, changed: 0, unchanged: 0, tombstones: 0, quarantined: 0 },
      // 1 with id + 1 legacy synthetic-id + 1 corrupt line = 3
      "hunt-submissions": {
        total: 3,
        new: 2,
        changed: 0,
        unchanged: 0,
        tombstones: 0,
        quarantined: 1,
      },
    });
  });

  it("writes NOTHING: record, audit, and quarantine tables all stay empty", async () => {
    expect(result.written).toBe(0);
    expect(await tdb.db.select().from(record)).toHaveLength(0);
    expect(await tdb.db.select().from(audit)).toHaveLength(0);
    expect(await tdb.db.select().from(quarantine)).toHaveLength(0);
  });

  it("reports append-table source counts with appended: false", () => {
    expect(result.appendTables).toEqual({
      analytics_event: { source: 3, target: 0, corrupt: 0, appended: false },
      survey_response: { source: 2, target: 0, corrupt: 0, appended: false },
      ferry_observation: { source: 3, target: 0, corrupt: 0, appended: false },
    });
  });
});

describe("apply, then a second apply (idempotence)", () => {
  let tdb: TestDb;
  let first: ImportResult;
  let second: ImportResult;
  let auditAfterFirst: number;
  let auditAfterSecond: number;
  beforeAll(async () => {
    tdb = await createTestDb();
    first = await runImport(importOpts({ apply: true }));
    auditAfterFirst = (await tdb.db.select().from(audit)).length;
    second = await runImport(importOpts({ apply: true }));
    auditAfterSecond = (await tdb.db.select().from(audit)).length;
  });
  afterAll(async () => {
    await tdb.close();
  });

  it("writes every valid record: 9 rows, exit 2 for the quarantines", () => {
    expect(first.exitCode).toBe(2);
    expect(first.written).toBe(9); // 3 restaurants + site-copy + user + invite + hunt + 2 submissions
  });

  it("lands the tombstone as deleted: true with its doc preserved", async () => {
    const [row] = await tdb.db
      .select()
      .from(record)
      .where(eq(record.id, "closed-diner"));
    expect(row.store).toBe("restaurants");
    expect(row.deleted).toBe(true);
    expect(row.doc).toMatchObject({ name: "Closed Diner" });
    expect(row.doc).not.toHaveProperty("_deleted"); // tombstone lives in the column
  });

  it("gives the legacy id-less submission the deterministic synthetic id", async () => {
    const expected = submissionId(LEGACY_SUBMISSION);
    const rows = await tdb.db.select().from(record).where(eq(record.store, "hunt-submissions"));
    expect(rows.map((r) => r.id).sort()).toEqual([expected, "sub-1"].sort());
    const legacy = rows.find((r) => r.id === expected);
    expect(legacy?.doc).toMatchObject({ ...LEGACY_SUBMISSION, id: expected });
  });

  it("keys the invite by its code with id === code (the code→id mirror)", async () => {
    const [row] = await tdb.db
      .select()
      .from(record)
      .where(eq(record.store, "auth-invites"));
    expect(row.id).toBe("abc123def456");
    expect(row.doc).toMatchObject({ id: "abc123def456", code: "abc123def456", role: "editor" });
  });

  it("parks the invalid record in quarantine and NOT in record", async () => {
    const qRows = await tdb.db.select().from(quarantine);
    expect(qRows).toHaveLength(2);
    const noName = qRows.find((q) => q.id === "no-name-cafe");
    expect(noName?.store).toBe("restaurants");
    expect(noName?.doc).toMatchObject({ id: "no-name-cafe" });
    const corruptLine = qRows.find((q) => q.id === "line-3");
    expect(corruptLine?.store).toBe("hunt-submissions");
    expect(corruptLine?.doc).toMatchObject({ raw: '{"broken' });

    const recordRows = await tdb.db.select().from(record);
    expect(recordRows).toHaveLength(9);
    expect(recordRows.some((r) => r.id === "no-name-cafe")).toBe(false);
  });

  it("audits every write as action 'import' by actor 'import:data-dir'", async () => {
    const rows = await tdb.db.select().from(audit);
    expect(rows).toHaveLength(9);
    expect(rows.every((r) => r.action === "import")).toBe(true);
    expect(rows.every((r) => r.actor === "import:data-dir")).toBe(true);
    expect(rows.every((r) => r.source === "import")).toBe(true);
  });

  it("appends the log fixtures and reports the corrupt JSONL line in quarantined", () => {
    expect(first.appendTables).toEqual({
      analytics_event: { source: 3, target: 0, corrupt: 0, appended: true },
      survey_response: { source: 2, target: 0, corrupt: 0, appended: true },
      ferry_observation: { source: 3, target: 0, corrupt: 0, appended: true },
    });
    expect(first.quarantined).toContainEqual(
      expect.objectContaining({
        store: "hunt-submissions",
        id: "line-3",
        where: "hunts/submissions.jsonl",
      }),
    );
  });

  it("second apply is a no-op: 0 writes, no new audit rows, everything unchanged", () => {
    expect(second.written).toBe(0);
    expect(auditAfterSecond).toBe(auditAfterFirst);
    expect(second.perStore.restaurants).toEqual({
      total: 4,
      new: 0,
      changed: 0,
      unchanged: 3,
      tombstones: 1,
      quarantined: 1,
    });
  });

  it("second apply SKIPs non-empty append tables (appended: false, target = first run's rows)", () => {
    expect(second.appendTables).toEqual({
      analytics_event: { source: 3, target: 3, corrupt: 0, appended: false },
      survey_response: { source: 2, target: 2, corrupt: 0, appended: false },
      ferry_observation: { source: 3, target: 3, corrupt: 0, appended: false },
    });
  });
});

describe("halt on unparseable file", () => {
  let tdb: TestDb;
  beforeAll(async () => {
    tdb = await createTestDb();
  });
  afterAll(async () => {
    await tdb.close();
  });

  it("rejects with HaltError whose message names the file", async () => {
    const err: unknown = await runImport(importOpts({ dataDir: CORRUPT_FIXTURE_DIR })).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HaltError);
    expect((err as HaltError).message).toContain("restaurants.json");
  });
});

describe("confirm returning false", () => {
  let tdb: TestDb;
  beforeAll(async () => {
    tdb = await createTestDb();
  });
  afterAll(async () => {
    await tdb.close();
  });

  it("aborts the apply with zero writes of any kind", async () => {
    const result = await runImport(importOpts({ apply: true, confirm: async () => false }));
    expect(result.aborted).toBe(true);
    expect(result.written).toBe(0);
    expect(await tdb.db.select().from(record)).toHaveLength(0);
    expect(await tdb.db.select().from(audit)).toHaveLength(0);
    expect(await tdb.db.select().from(quarantine)).toHaveLength(0);
  });
});
