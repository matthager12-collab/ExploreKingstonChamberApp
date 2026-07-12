// PGlite-backed test database (E05): a real Postgres engine, in-memory, no
// server — migrated with the SAME checked-in db/migrations/ the production
// boot migrator applies, so the schema under test is the schema in prod
// (including the audit-immutability trigger).
//
// Usage (per test file):
//   let tdb: TestDb;
//   beforeAll(async () => { tdb = await createTestDb(); });
//   afterAll(() => tdb.close());
// createTestDb() wires the instance into the data layer via __setDbForTests.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { __setDbForTests, type Db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";

export type TestDb = {
  db: Db;
  close: () => Promise<void>;
};

export async function createTestDb(): Promise<TestDb> {
  const pglite = new PGlite(); // in-memory, per-suite isolation
  const db = drizzle(pglite, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: "db/migrations" });
  __setDbForTests(db);
  return {
    db,
    close: async () => {
      __setDbForTests(null);
      try {
        await pglite.close();
      } catch {
        // idempotent: suites may close mid-run to simulate a lost DB
      }
    },
  };
}
