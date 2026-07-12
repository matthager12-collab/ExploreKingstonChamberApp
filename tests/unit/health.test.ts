// health (E05): /api/health now requires BOTH probes — disk writable AND
// Postgres answering. Without a database the route reports dbOk:false and
// 503s, which is what makes substrate deploys fail-closed on Render.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/health/route";
import { createTestDb, type TestDb } from "../setup/pglite-db";

// dbHealthy memoizes its probe for ~60s; fake timers let the suite step past
// the window between the healthy and unhealthy cases.
let tdb: TestDb;
beforeAll(async () => {
  vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});
afterEach(() => {
  vi.setSystemTime(Date.now() + 61_000);
});

describe("/api/health", () => {
  it("200 with dbOk:true when disk and DB probes both pass", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; dataWritable: boolean; dbOk: boolean };
    expect(body).toMatchObject({ ok: true, dataWritable: true, dbOk: true });
  });

  it("503 with dbOk:false when no database is reachable (DATABASE_URL unset)", async () => {
    // unit-env.ts guarantees DATABASE_URL is unset; dropping the test override
    // leaves getDb() with nothing — the exact posture of a substrate release
    // deployed before the operator sets DATABASE_URL.
    await tdb.close();
    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; dataWritable: boolean; dbOk: boolean };
    expect(body).toMatchObject({ ok: false, dataWritable: true, dbOk: false });
  });
});
