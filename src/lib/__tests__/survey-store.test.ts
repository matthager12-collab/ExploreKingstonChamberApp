// E05: the JSONL file backend (and its corrupt-line crash guard) died with
// the Postgres substrate — survey responses are jsonb rows now, so a
// partially-written line can no longer exist. This suite covers the DB-era
// contract instead: save → summarize round-trips over PGlite.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { surveyStore } from "@/lib/survey-store";
import { createTestDb, type TestDb } from "../../../tests/setup/pglite-db";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

describe("survey-store round-trip", () => {
  it("summarize counts saved responses", async () => {
    await surveyStore.save({
      submittedAt: "2026-01-01T00:00:00Z",
      distanceBand: "local",
    } as Parameters<typeof surveyStore.save>[0]);
    await surveyStore.save({
      submittedAt: "2026-01-02T00:00:00Z",
      distanceBand: "10-50mi",
    } as Parameters<typeof surveyStore.save>[0]);

    const summary = await surveyStore.summarize();
    expect(summary.total).toBe(2);
  });
});
