// backup-restore-roundtrip (E05): serializeDb() captures the FULL substrate
// (record rows with governance metadata, tombstones, auth-users password
// hashes; audit verbatim with ids; quarantine; append logs) and restoreDb()
// reproduces it in a fresh database without minting fresh audit rows.
//
// Two PGlite instances live in this file. __setDbForTests is a single global
// slot, so the data layer (getDb()) points at whichever createTestDb() ran
// LAST — the source db is populated + serialized BEFORE the target exists,
// and per-db assertions afterwards go through the tdb.db handles directly.

import { and, asc, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  appendAnalyticsEvent,
  appendFerryObservation,
  appendSurveyResponse,
} from "@/lib/db/append";
import { restoreDb, serializeDb, type DbSection } from "@/lib/db/export";
import { deleteRecord, insertQuarantineRow, writeRecord } from "@/lib/db/records";
import {
  analyticsEvent,
  audit,
  ferryObservation,
  quarantine,
  record,
  surveyResponse,
} from "@/lib/db/schema";
import { createTestDb, type TestDb } from "../setup/pglite-db";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const HASH = "scrypt$deadbeef$cafebabe";

let source: TestDb;
let target: TestDb | undefined;
let section: DbSection;

beforeAll(async () => {
  source = await createTestDb(); // getDb() → source until target is created

  await writeRecord(
    "restaurants",
    { id: "cafe", name: "Café Roundtrip" },
    { actor: "mat@example.test", source: "admin" },
  );
  await writeRecord("restaurants", { id: "gone", name: "Short-Lived" });
  await deleteRecord("restaurants", "gone", { actor: "mat@example.test" }); // tombstone
  await writeRecord("charities", { id: "helpers", name: "The Helpers" });
  await writeRecord(
    "auth-users",
    { id: "u1", email: "u1@example.test", passwordHash: HASH } as {
      id: string;
      email: string;
      passwordHash: string;
    },
    { actor: "u1@example.test", source: "portal" },
  );
  await insertQuarantineRow({
    store: "restaurants",
    id: "bad-row",
    doc: { id: "bad-row" },
    errors: [{ message: "missing name" }],
  });
  await appendAnalyticsEvent({ type: "pageview", path: "/ferry" });
  await appendSurveyResponse({ q1: "came for the ferry" });
  await appendFerryObservation({ vessel: "Spokane", pct: 42 });

  section = await serializeDb();
});

afterAll(async () => {
  await target?.close();
  await source.close();
});

async function tableCounts(tdb: TestDb) {
  const one = async (t: typeof record | typeof audit | typeof quarantine | typeof analyticsEvent | typeof surveyResponse | typeof ferryObservation) => {
    const [{ n }] = await tdb.db.select({ n: count() }).from(t);
    return n;
  };
  return {
    record: await one(record),
    audit: await one(audit),
    quarantine: await one(quarantine),
    analytics_event: await one(analyticsEvent),
    survey_response: await one(surveyResponse),
    ferry_observation: await one(ferryObservation),
  };
}

describe("backup/restore roundtrip", () => {
  it("serializeDb returns records keyed by store, full metadata, and a version-agnostic section", () => {
    // Version-agnostic: exactly the six table keys, no version field of its own.
    expect(Object.keys(section).sort()).toEqual([
      "analytics_event",
      "audit",
      "ferry_observation",
      "quarantine",
      "records",
      "survey_response",
    ]);

    expect(Object.keys(section.records).sort()).toEqual([
      "auth-users",
      "charities",
      "restaurants",
    ]);
    expect(section.records.restaurants.map((r) => r.id)).toEqual(["cafe", "gone"]);

    // Full rows WITH metadata columns, timestamps as ISO strings.
    const cafe = section.records.restaurants.find((r) => r.id === "cafe")!;
    expect(cafe.doc).toMatchObject({ id: "cafe", name: "Café Roundtrip" });
    expect(cafe.deleted).toBe(false);
    expect(cafe.status).toBe("live");
    expect(cafe.source).toBe("admin");
    expect(cafe.updatedBy).toBe("mat@example.test");
    expect(cafe.createdAt).toMatch(ISO);
    expect(cafe.updatedAt).toMatch(ISO);

    // The tombstone survives as a row, not a hole.
    expect(section.records.restaurants.find((r) => r.id === "gone")!.deleted).toBe(true);

    // Record rows keep the password hash (the backup IS the sensitive copy)…
    const u1 = section.records["auth-users"][0];
    expect((u1.doc as { passwordHash: string }).passwordHash).toBe(HASH);
    // …while audit rows were redacted at write time and stay that way.
    expect(section.audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(section.audit)).not.toContain("deadbeef");
    for (const a of section.audit) {
      expect(typeof a.id).toBe("number");
      expect(a.ts).toMatch(ISO);
    }

    expect(section.quarantine).toHaveLength(1);
    expect(section.analytics_event).toHaveLength(1);
    expect(section.survey_response).toHaveLength(1);
    expect(section.ferry_observation).toHaveLength(1);
  });

  it("restoreDb into a fresh database reproduces every per-table count and the docs byte-for-byte", async () => {
    target = await createTestDb(); // getDb() → target from here on

    const restored = await restoreDb(section, { force: false });

    const src = await tableCounts(source);
    const tgt = await tableCounts(target);
    expect(tgt).toEqual(src);
    expect(restored).toEqual(src);

    // Spot check: the cafe doc is byte-identical across databases.
    const cafeIn = async (tdb: TestDb) => {
      const [row] = await tdb.db
        .select()
        .from(record)
        .where(and(eq(record.store, "restaurants"), eq(record.id, "cafe")));
      return row;
    };
    const srcCafe = await cafeIn(source);
    const tgtCafe = await cafeIn(target);
    expect(JSON.stringify(tgtCafe.doc)).toBe(JSON.stringify(srcCafe.doc));
    // …and its governance metadata came back verbatim, not re-stamped.
    expect(tgtCafe.status).toBe(srcCafe.status);
    expect(tgtCafe.source).toBe(srcCafe.source);
    expect(tgtCafe.updatedBy).toBe(srcCafe.updatedBy);
    expect(tgtCafe.createdAt.getTime()).toBe(srcCafe.createdAt.getTime());
    expect(tgtCafe.updatedAt.getTime()).toBe(srcCafe.updatedAt.getTime());

    // Audit rows kept their original ids (restore mints NO fresh audit rows).
    const auditIds = async (tdb: TestDb) =>
      (await tdb.db.select({ id: audit.id }).from(audit).orderBy(asc(audit.id))).map(
        (r) => r.id,
      );
    expect(await auditIds(target)).toEqual(await auditIds(source));
  });

  it("REFUSES a non-empty target without force, naming --force", async () => {
    // target is now populated; a second restore must refuse and write nothing.
    await expect(restoreDb(section, { force: false })).rejects.toThrow(/--force/);
    expect((await tableCounts(target!)).audit).toBe(section.audit.length);
  });

  it("post-restore writes still work: the audit id sequence was bumped past the restored ids", async () => {
    // Without the setval in restoreDb, this insert would collide with id 1.
    await writeRecord("restaurants", { id: "post-restore", name: "After the flood" });
    const tgt = await tableCounts(target!);
    expect(tgt.audit).toBe(section.audit.length + 1);
  });
});
