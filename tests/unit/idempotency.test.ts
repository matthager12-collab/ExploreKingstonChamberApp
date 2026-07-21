// Idempotent-intake claims (E13). The offline outbox replays a queued POST
// until the server confirms delivery, so the invariant under test is: the same
// key is claimable exactly ONCE, and the verdict is decided by the database,
// not by a read-then-write in application code.
//
// This runs against real PGlite via createTestDb() — the same checked-in
// db/migrations/ the boot migrator applies, so 0007 is live here automatically.
// createTestDb() is also what makes getDb() work at all: tests/setup/unit-env.ts
// deletes DATABASE_URL for every unit file, so calling claimIdempotencyKey
// without it throws "DATABASE_URL is not set" rather than failing an assertion.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  claimIdempotencyKey,
  releaseIdempotencyKey,
  sweepIdempotencyKeys,
} from "@/lib/db/idempotency";
import { idempotencyKeys } from "@/lib/db/schema";
import { createTestDb, type TestDb } from "../setup/pglite-db";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

async function storedKeys(): Promise<string[]> {
  const rows = await tdb.db.select({ key: idempotencyKeys.key }).from(idempotencyKeys);
  return rows.map((r) => r.key);
}

describe("claimIdempotencyKey key validation", () => {
  // A malformed key is a client bug (400), NOT a duplicate (success) — the two
  // verdicts must never collapse into one. Rejection also happens before the
  // DB is touched, so an over-long key can't surface as a varchar(64) error.
  const invalid: [label: string, key: string][] = [
    ["empty", ""],
    ["too short (7 chars)", "abc1234"],
    ["too long (65 chars)", "a".repeat(65)],
    ["underscore", "valid_key_with_underscore"],
    ["space", "key with spaces"],
    ["dot", "key.with.dots"],
    ["slash (path-ish)", "../../etc/passwd"],
    ["percent-encoded", "abcd%20efgh"],
    ["unicode", "ключ-идентификатор"],
  ];

  for (const [label, key] of invalid) {
    it(`rejects a key with ${label}`, async () => {
      expect(await claimIdempotencyKey(key, "survey")).toBe("invalid");
    });
  }

  it("writes no row for an invalid key", async () => {
    const before = await storedKeys();
    await claimIdempotencyKey("bad key!", "survey");
    expect(await storedKeys()).toEqual(before);
  });

  it("accepts the client's UUID shape and the 8-char lower bound", async () => {
    expect(await claimIdempotencyKey(crypto.randomUUID(), "survey")).toBe("claimed");
    expect(await claimIdempotencyKey("abcd-123", "survey")).toBe("claimed");
    expect(await claimIdempotencyKey("A".repeat(64), "survey")).toBe("claimed");
  });
});

describe("claimIdempotencyKey claim/duplicate round-trip", () => {
  it("claims a fresh key once and calls every replay a duplicate", async () => {
    const key = crypto.randomUUID();
    expect(await claimIdempotencyKey(key, "survey")).toBe("claimed");
    expect(await claimIdempotencyKey(key, "survey")).toBe("duplicate");
    expect(await claimIdempotencyKey(key, "survey")).toBe("duplicate");
    expect((await storedKeys()).filter((k) => k === key)).toHaveLength(1);
  });

  it("does not let a different scope re-claim the same key", async () => {
    // The key is the primary key on its own: scope is metadata for operators,
    // not part of the uniqueness contract. A collision across scopes is a
    // client bug, and answering "duplicate" is the safe direction.
    const key = crypto.randomUUID();
    expect(await claimIdempotencyKey(key, "survey")).toBe("claimed");
    expect(await claimIdempotencyKey(key, "other")).toBe("duplicate");
  });

  it("re-claims a key after release — the compensating path for a failed save", async () => {
    const key = crypto.randomUUID();
    expect(await claimIdempotencyKey(key, "survey")).toBe("claimed");
    await releaseIdempotencyKey(key);
    expect(await storedKeys()).not.toContain(key);
    expect(await claimIdempotencyKey(key, "survey")).toBe("claimed");
  });

  it("releasing a key that was never claimed is a no-op, not a throw", async () => {
    await expect(releaseIdempotencyKey(crypto.randomUUID())).resolves.toBeUndefined();
  });
});

describe("sweepIdempotencyKeys", () => {
  it("drops claims past 30 days and keeps fresh ones", async () => {
    const stale = crypto.randomUUID();
    const fresh = crypto.randomUUID();
    await tdb.db.insert(idempotencyKeys).values({
      key: stale,
      scope: "survey",
      createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    });
    expect(await claimIdempotencyKey(fresh, "survey")).toBe("claimed");

    expect(await sweepIdempotencyKeys()).toBeGreaterThanOrEqual(1);

    const keys = await storedKeys();
    expect(keys).not.toContain(stale);
    expect(keys).toContain(fresh);
  });

  it("lets a swept key be claimed again", async () => {
    // Deliberate: 30 days is far past the outbox's own 7-day drop bound, so
    // anything replaying a swept key had already given up on that submission.
    const key = crypto.randomUUID();
    await tdb.db.insert(idempotencyKeys).values({
      key,
      scope: "survey",
      createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
    });
    await sweepIdempotencyKeys();
    expect(await claimIdempotencyKey(key, "survey")).toBe("claimed");
  });
});
