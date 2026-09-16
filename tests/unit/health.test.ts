// health (E15 slice 3): /api/health gates on POSTGRES ONLY. The pre-E15
// filesystem write-probe is gone — the persistent disk is being removed, and a
// disk probe would 503 a healthy service the moment the disk is detached. The
// body is now { ok, db, storage, time }; storage is informational and never
// gates.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/health/route";
import { createTestDb, type TestDb } from "../setup/pglite-db";

type HealthBody = { ok: boolean; db: boolean; storage: string; time: string };

// dbHealthy memoizes its probe for 60s, healthy or failed alike — see
// src/lib/db/records.ts; fake timers step past that window between cases
// so every GET below re-probes.
const PAST_MEMO_MS = 61_000;
let tdb: TestDb;
beforeAll(async () => {
  vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});
afterEach(() => {
  vi.setSystemTime(Date.now() + PAST_MEMO_MS);
  vi.unstubAllEnvs();
});

describe("/api/health", () => {
  it("200 with db:true when Postgres answers", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthBody;
    expect(body).toMatchObject({ ok: true, db: true });
    expect(typeof body.time).toBe("string");
  });

  it("never write-probes the disk — no dataWritable key, and disk state is irrelevant", async () => {
    const res = await GET();
    const body = (await res.json()) as Record<string, unknown>;
    // The old shape leaked disk internals; the new shape must not.
    expect(body).not.toHaveProperty("dataWritable");
    expect(body).not.toHaveProperty("dbOk");
    // Health is 200 purely on DB health, with no filesystem access at all —
    // which is the property that lets the disk be removed safely.
    expect(res.status).toBe(200);
  });

  it("reports storage from config without probing it (never gates)", async () => {
    // unit-env sets a scratch DATA_DIR and no R2 -> filesystem mode.
    let body = (await GET().then((r) => r.json())) as HealthBody;
    expect(body.storage).toBe("fs");
    expect(body.ok).toBe(true); // storage mode does not affect ok

    vi.setSystemTime(Date.now() + PAST_MEMO_MS);
    vi.stubEnv("R2_IMAGES_ENDPOINT", "https://acct.r2.cloudflarestorage.com");
    vi.stubEnv("R2_IMAGES_BUCKET", "b");
    vi.stubEnv("R2_IMAGES_ACCESS_KEY_ID", "k");
    vi.stubEnv("R2_IMAGES_SECRET_ACCESS_KEY", "s");
    body = (await GET().then((r) => r.json())) as HealthBody;
    expect(body.storage).toBe("r2"); // R2 wins over the disk
    expect(body.ok).toBe(true);

    vi.setSystemTime(Date.now() + PAST_MEMO_MS);
    vi.unstubAllEnvs();
    vi.stubEnv("DATA_DIR", ""); // no disk, no R2 -> the red-flag state
    body = (await GET().then((r) => r.json())) as HealthBody;
    expect(body.storage).toBe("unconfigured");
    expect(body.ok).toBe(true); // STILL healthy — storage never gates
  });

  it("503 with db:false when no database is reachable", async () => {
    // Dropping the test DB leaves getDb() with nothing — the exact posture of a
    // substrate release deployed before DATABASE_URL is set.
    await tdb.close();
    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as HealthBody;
    expect(body).toMatchObject({ ok: false, db: false });
  });
});
