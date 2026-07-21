// Idempotent-intake claims for the offline outbox (E13). A queued POST is
// replayed by the client until the server confirms delivery, so the same body
// can legitimately arrive several times — the key, not the body, is what makes
// the second arrival a no-op.
//
// Lives inside src/lib/db/** because only the data layer may touch the DB
// client (eslint no-restricted-imports + the dependency-cruiser rule
// `db-client-only-via-db-layer` both hard-fail otherwise) — same reason
// append.ts holds the append-log SQL for the store modules.
//
// Claims are operational metadata, not records: they bypass the writeRecord
// choke point and emit no audit rows (see the table comment in schema.ts).

import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "./client";
import { idempotencyKeys } from "./schema";

/** The client mints `crypto.randomUUID()`; the bound is the column width.
 *  Anything else is a malformed header, not a duplicate — callers must be able
 *  to tell those apart (a duplicate is success, a malformed key is a 400). */
const KEY_RE = /^[A-Za-z0-9-]{8,64}$/;

/** node-postgres reports rowCount; PGlite (the vitest engine) reports
 *  affectedRows and leaves rowCount undefined. Duplicated per house style —
 *  see src/lib/db/privacy-retention.ts:29-32. */
function mutated(res: unknown): number {
  const r = res as { rowCount?: number; affectedRows?: number };
  return r.rowCount ?? r.affectedRows ?? 0;
}

// Opportunistic prune, the repo's existing idiom
// (src/lib/stores/ferry-observations.ts:126-129): a deterministic counter, not
// Math.random(), so the trigger point is reachable from a test without
// stubbing the RNG. No cron entry — the table only grows when someone posts.
const SWEEP_EVERY = 50;
let claimsSinceSweep = 0;

/**
 * Claim `key` for `scope`. "claimed" = first time, caller should do the work;
 * "duplicate" = already claimed, caller should return success WITHOUT redoing
 * the work; "invalid" = malformed key, caller should 400.
 */
export async function claimIdempotencyKey(
  key: string,
  scope: string,
): Promise<"claimed" | "duplicate" | "invalid"> {
  // Validate before touching the DB: a 70-char key would blow the varchar(64)
  // bound and surface as a query error rather than a clean 400.
  if (!KEY_RE.test(key)) return "invalid";

  // Atomic by construction. SELECT-then-INSERT would race, and two tabs
  // flushing the same outbox entry is the normal case here, not the edge case.
  //
  // The verdict comes from `.returning()` + rows.length, NOT from an
  // affected-row count: see mutated()'s comment — the two drivers disagree on
  // which field they populate, and reading rowCount alone makes every claim
  // look like a duplicate under vitest. rows.length is the one signal both
  // agree on (1 on insert, 0 on conflict).
  const inserted = await getDb()
    .insert(idempotencyKeys)
    .values({ key, scope })
    .onConflictDoNothing({ target: idempotencyKeys.key })
    .returning({ key: idempotencyKeys.key });

  if (++claimsSinceSweep >= SWEEP_EVERY) {
    claimsSinceSweep = 0;
    void sweepIdempotencyKeys().catch(() => {});
  }

  return inserted.length === 1 ? "claimed" : "duplicate";
}

/**
 * Compensating release for a claim whose work then failed. Without it, a
 * transient DB outage during the save turns into PERMANENT data loss: the
 * caller still answers 200, the outbox drops its copy, and every replay is
 * answered "duplicate" for a body that was never persisted.
 *
 * Best-effort by contract — never throws. A stranded key costs one lost retry;
 * a throw here would mask the original failure.
 */
export async function releaseIdempotencyKey(key: string): Promise<void> {
  try {
    await getDb().execute(sql`DELETE FROM idempotency_keys WHERE key = ${key}`);
  } catch {
    // Swallowed on purpose — see the doc comment above.
  }
}

/**
 * Drop claims older than 30 days. Long past any plausible offline replay
 * window (the outbox itself drops entries after 7 days), so a swept key can
 * only ever be re-claimed by a client that had already given up.
 *
 * Raw SQL: the interval literal is not expressible in the query builder.
 * Returns the number of rows deleted. Documented in docs/PWA.md — deliberately
 * absent from RETENTION_POLICY, which is an ask-first human floor rendered
 * verbatim on the public /privacy page.
 */
export async function sweepIdempotencyKeys(): Promise<number> {
  const res = await getDb().execute(
    sql`DELETE FROM idempotency_keys WHERE created_at < now() - interval '30 days'`,
  );
  return mutated(res);
}
