import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../setup/pglite-db";
import { appendFerryObservation } from "@/lib/db/append";
import { latestObservationAt } from "@/lib/stores/ferry-observations";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(() => tdb.close());

describe("latestObservationAt (ops 'Scheduled jobs' freshness)", () => {
  it("returns null before the observe cron has ever run", async () => {
    expect(await latestObservationAt()).toBeNull();
  });

  it("returns the max payload ts across logged observations", async () => {
    const obs = (ts: string) => ({
      ts,
      dir: "from-kingston" as const,
      departs: ts,
      driveUp: 1,
      max: 10,
      delayMin: null,
    });
    await appendFerryObservation(obs("2026-07-19T10:00:00.000Z"));
    await appendFerryObservation(obs("2026-07-20T08:30:00.000Z")); // newest
    await appendFerryObservation(obs("2026-07-19T22:00:00.000Z"));
    expect(await latestObservationAt()).toBe("2026-07-20T08:30:00.000Z");
  });
});
