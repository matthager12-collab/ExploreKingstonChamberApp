// audit-immutable (E05): the audit table is append-only AT THE DATABASE — the
// trigger shipped in db/migrations/0001 raises on UPDATE and DELETE no matter
// which client issues it. PGlite runs the same migrations, so this exercises
// the real trigger, not a mock.

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { writeRecord } from "@/lib/db/records";
import { validRestaurant } from "../setup/domain-docs";
import { createTestDb, type TestDb } from "../setup/pglite-db";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
  await writeRecord("restaurants", validRestaurant({ id: "row-under-test", name: "Immutable Cafe" }));
});
afterAll(async () => {
  await tdb.close();
});

/** Drizzle wraps the Postgres error ("Failed query: …") and chains the
 *  trigger's RAISE message via error.cause — assert down the chain. */
async function expectAppendOnlyRejection(run: Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await run;
  } catch (e) {
    caught = e;
  }
  expect(caught, "statement should have been rejected").toBeTruthy();
  const messages: string[] = [];
  for (let e = caught; e; e = (e as { cause?: unknown }).cause) {
    messages.push(String((e as Error).message ?? e));
  }
  expect(messages.join(" | ")).toMatch(/append-only/);
}

describe("audit table immutability", () => {
  it("raw UPDATE on audit raises", async () => {
    await expectAppendOnlyRejection(
      tdb.db.execute(sql`UPDATE audit SET actor = 'tamper'`),
    );
  });

  it("raw DELETE on audit raises", async () => {
    await expectAppendOnlyRejection(tdb.db.execute(sql`DELETE FROM audit`));
  });
});
