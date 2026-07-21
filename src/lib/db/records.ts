// THE write choke point (E05). Every structured-data write in the app funnels
// through writeRecord(): zod-validate → stamp metadata → upsert + append-only
// audit row, all in one transaction. Reads come back in the exact shape the
// old overlay contract promised: `doc` is stored WITHOUT `_deleted` (the
// tombstone lives in the `deleted` column) and readRecords re-attaches it.
//
// This module is the only one that queries the `record` table. The `audit`
// table has exactly three writers: this module, auth-store.ts (E06), and
// worklist.ts (E08). Append-only logs (analytics/survey/ferry observations)
// are NOT records — they bypass this module by design and write no audit rows.

import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "./client";
import {
  audit,
  quarantine,
  record,
  type RecordSource,
  type RecordStatus,
} from "./schema";
import { validateRecord } from "./store-schemas";

export type WithId = { id: string };
export type OverlayRow<T extends WithId> = T & { _deleted?: boolean };
export type { RecordStatus } from "./schema";

/** Cross-cutting metadata stamped onto a write. Everything is optional so
 *  the store modules' existing call sites keep compiling; routes thread
 *  { actor, source } where a session exists. */
export type WriteMeta = {
  /** email of the acting user, or "system" / "public" / "import:data-dir". */
  actor?: string;
  source?: RecordSource;
  /** E05 default is "live" (behavior-preserving); E08 flips submission
   *  surfaces to "pending". */
  status?: RecordStatus;
  ownerOrgId?: string;
  externalId?: string;
  /** Audit-action override — importer ('import') and the E09 restore route
   *  ('restore', so the trail records the undo) only. App writes leave this
   *  unset and get the derived create/update/delete. */
  action?: "create" | "update" | "delete" | "import" | "restore";
};

/** Keys whose values never reach an audit row (auth-users password hashes;
 *  applied defensively to every store). */
const SECRET_KEYS = new Set(["password", "passwordhash"]);

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.has(k.toLowerCase()) ? "[redacted]" : redactSecrets(v);
    }
    return out;
  }
  return value;
}

/** E11 (D-10): per-store keys stripped from audit SNAPSHOTS at write time.
 *  The audit table is never purged or edited, so anything written into a
 *  snapshot lives forever — hunt submissions must not immortalize the
 *  visitor's precise GPS fix or the (publicly fetchable) photo URL that the
 *  12-month retention promise says get destroyed. Top-level strip, not
 *  "[redacted]" markers: absence, not a breadcrumb. Consequence: these
 *  stores cannot offer snapshot-restore (delisted in
 *  src/lib/audit/restore-registry.ts). */
const SNAPSHOT_STRIP_KEYS: Record<string, ReadonlySet<string>> = {
  "hunt-submissions": new Set(["lat", "lng", "distanceMeters", "photoPath"]),
};

function stripSnapshotKeys(
  store: string,
  doc: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const strip = SNAPSHOT_STRIP_KEYS[store];
  if (!strip || !doc) return doc;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (!strip.has(k)) out[k] = v;
  }
  return out;
}

/** `next build` prerenders ISR pages in an environment that deliberately has
 *  no DATABASE_URL (Docker build stage, CI build step — builds must not need
 *  secrets). The old file backend read an empty scratch .data there and baked
 *  seed-only pages, which runtime revalidation then refreshed; this preserves
 *  that exact semantic. Anywhere else, no DATABASE_URL is a hard error. */
function buildingWithoutDb(): boolean {
  return (
    !process.env.DATABASE_URL &&
    process.env.NEXT_PHASE === "phase-production-build"
  );
}

/** Raw overlay read. Default: every status, tombstones included with
 *  `_deleted` re-attached — exactly today's readOverlay contract (auth and
 *  hunt-store depend on the any-status behavior; trap #8). */
export async function readRecords<T extends WithId>(
  store: string,
  opts?: { statuses?: RecordStatus[] },
): Promise<OverlayRow<T>[]> {
  if (buildingWithoutDb()) return [];
  const db = getDb();
  const rows = await db
    .select({ doc: record.doc, deleted: record.deleted })
    .from(record)
    .where(
      opts?.statuses?.length
        ? and(eq(record.store, store), inArray(record.status, opts.statuses))
        : eq(record.store, store),
    );
  return rows.map((r) =>
    r.deleted ? ({ ...(r.doc as T), _deleted: true } as OverlayRow<T>) : (r.doc as T),
  );
}

/** Seed + overlay merge, semantics identical to the old readMerged (overlay
 *  wins by id, tombstones hide, `_deleted` stripped from returns) PLUS the
 *  E05 status gate: only `live` overlay rows participate, so every render
 *  path is status-gated (decisions §2). Behavior-preserving today because
 *  every write and import lands as `live`. */
export async function readMergedRecords<T extends WithId>(
  store: string,
  seed: T[],
): Promise<T[]> {
  const overlay = await readRecords<T>(store, { statuses: ["live"] });
  const byId = new Map<string, OverlayRow<T>>();
  for (const s of seed) byId.set(s.id, s);
  for (const o of overlay) byId.set(o.id, o);
  return [...byId.values()]
    .filter((r) => !r._deleted)
    .map(({ _deleted: _ignored, ...rest }) => rest as unknown as T);
}

/** THE choke point: validate → upsert (doc stored without `_deleted`) →
 *  audit row, in one transaction. Throws RecordValidationError (from
 *  store-schemas) on invalid docs — API routes translate it to a 400. */
export async function writeRecord<T extends WithId>(
  store: string,
  rec: OverlayRow<T>,
  meta?: WriteMeta,
): Promise<void> {
  const { _deleted, ...doc } = rec as { _deleted?: boolean } & Record<string, unknown>;
  validateRecord(store, doc, { tombstone: Boolean(_deleted) });

  const db = getDb();
  const actor = meta?.actor ?? "system";
  const source = meta?.source ?? "admin";
  const status = meta?.status ?? "live";
  const now = new Date();

  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(record)
      .where(and(eq(record.store, store), eq(record.id, rec.id)));

    await tx
      .insert(record)
      .values({
        store,
        id: rec.id,
        doc,
        deleted: Boolean(_deleted),
        status,
        source,
        externalId: meta?.externalId,
        ownerOrgId: meta?.ownerOrgId,
        updatedAt: now,
        updatedBy: actor,
      })
      .onConflictDoUpdate({
        target: [record.store, record.id],
        set: {
          doc,
          deleted: Boolean(_deleted),
          status,
          source,
          updatedAt: now,
          updatedBy: actor,
          // external/owner ids only move when explicitly provided — an admin
          // edit must not wipe the AMS seam E16 will populate.
          ...(meta?.externalId !== undefined ? { externalId: meta.externalId } : {}),
          ...(meta?.ownerOrgId !== undefined ? { ownerOrgId: meta.ownerOrgId } : {}),
        },
      });

    await tx.insert(audit).values({
      actor,
      // Tombstones ALWAYS audit as 'delete', even under an action override —
      // a tombstone write labeled 'import'/'restore' is indistinguishable
      // from a live write in the trail (writeRecord strips `_deleted` from
      // the audited doc), and E09's restore would replay it as an un-delete.
      action: _deleted ? "delete" : (meta?.action ?? (before ? "update" : "create")),
      store,
      recordId: rec.id,
      before: stripSnapshotKeys(
        store,
        before ? (redactSecrets(before.doc) as Record<string, unknown>) : null,
      ),
      after: stripSnapshotKeys(store, redactSecrets(doc) as Record<string, unknown>),
      source,
    });
  });
}

/** A domain record with its lifecycle status surfaced (E08 admin reads). */
export type WithStatus<T> = T & { status: RecordStatus };

/** PRIVILEGED seed+overlay merge (E08): same semantics as readMergedRecords
 *  but overlay rows of EVERY status participate (narrow via opts.statuses,
 *  e.g. live+pending for owner-scoped portal reads) and each returned record
 *  carries its status — seed-only records read as 'live'. Explicitly named so
 *  a future agent adding a public page gets the fail-closed default getter,
 *  never this. */
export async function readMergedRecordsAdmin<T extends WithId>(
  store: string,
  seed: T[],
  opts?: { statuses?: RecordStatus[] },
): Promise<WithStatus<T>[]> {
  const byId = new Map<string, WithStatus<T> & { _deleted?: boolean }>();
  for (const s of seed) byId.set(s.id, { ...s, status: "live" as RecordStatus });
  if (!buildingWithoutDb()) {
    const db = getDb();
    const rows = await db
      .select({ doc: record.doc, deleted: record.deleted, status: record.status })
      .from(record)
      .where(
        opts?.statuses?.length
          ? and(eq(record.store, store), inArray(record.status, opts.statuses))
          : eq(record.store, store),
      );
    for (const r of rows) {
      byId.set((r.doc as T).id, {
        ...(r.doc as T),
        status: r.status,
        ...(r.deleted ? { _deleted: true as const } : {}),
      });
    }
  }
  return [...byId.values()]
    .filter((r) => !r._deleted)
    .map(({ _deleted: _ignored, ...rest }) => rest as WithStatus<T>);
}

/** Flip ONLY the lifecycle status of an overlay row, preserving its doc —
 *  the approve/takedown primitive. Audited as a status-change with the old
 *  and new status. Returns false when no overlay row exists (seed-only
 *  records have nothing to flip — take one down by overlaying it with its
 *  seed doc and the new status via writeRecord) or the row is a tombstone. */
export async function setRecordStatus(
  store: string,
  id: string,
  status: RecordStatus,
  meta?: WriteMeta,
): Promise<boolean> {
  const db = getDb();
  const actor = meta?.actor ?? "system";
  const source = meta?.source ?? "admin";
  const now = new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(record)
      .where(and(eq(record.store, store), eq(record.id, id)))
      .for("update");
    if (!row || row.deleted) return false;
    await tx
      .update(record)
      .set({ status, updatedAt: now, updatedBy: actor })
      .where(and(eq(record.store, store), eq(record.id, id)));
    await tx.insert(audit).values({
      actor,
      action: "status-change",
      store,
      recordId: id,
      before: { status: row.status },
      after: { status },
      source,
    });
    return true;
  });
}

/** Mark a record human-verified now (E08 staleness engine): stamps
 *  last_verified_at and audits it. Overlay rows only — a seed-only record
 *  has no row to stamp and returns false (it joins the staleness engine the
 *  first time any write overlays it; docs/OPERATIONS.md explains). */
export async function markRecordVerified(
  store: string,
  id: string,
  meta?: WriteMeta,
): Promise<boolean> {
  const db = getDb();
  const actor = meta?.actor ?? "system";
  const source = meta?.source ?? "admin";
  const now = new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(record)
      .where(and(eq(record.store, store), eq(record.id, id)))
      .for("update");
    if (!row || row.deleted) return false;
    await tx
      .update(record)
      .set({ lastVerifiedAt: now })
      .where(and(eq(record.store, store), eq(record.id, id)));
    await tx.insert(audit).values({
      actor,
      action: "verify",
      store,
      recordId: id,
      before: { lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null },
      after: { lastVerifiedAt: now.toISOString() },
      source,
    });
    return true;
  });
}

/** Live overlay rows past their verify-by date (E08 staleness sweep input).
 *  Interval precedence: the row's own verify_interval_days, else the store's
 *  entry in `defaults`. Clock anchor: last_verified_at, else updated_at (a
 *  row that has never been verified counts from its last write). Only stores
 *  named in `defaults` participate; seed-only records have no row and are
 *  out of scope until something overlays them. */
export async function listVerifyDue(
  defaults: Record<string, number>,
  now: Date = new Date(),
): Promise<
  {
    store: string;
    id: string;
    doc: Record<string, unknown>;
    lastVerifiedAt: Date | null;
    intervalDays: number;
  }[]
> {
  const stores = Object.keys(defaults);
  if (!stores.length) return [];
  const db = getDb();
  const rows = await db
    .select({
      store: record.store,
      id: record.id,
      doc: record.doc,
      lastVerifiedAt: record.lastVerifiedAt,
      verifyIntervalDays: record.verifyIntervalDays,
      updatedAt: record.updatedAt,
    })
    .from(record)
    .where(
      and(
        inArray(record.store, stores),
        eq(record.status, "live"),
        eq(record.deleted, false),
      ),
    );
  const due: Awaited<ReturnType<typeof listVerifyDue>> = [];
  for (const r of rows) {
    const intervalDays = r.verifyIntervalDays ?? defaults[r.store];
    const anchor = r.lastVerifiedAt ?? r.updatedAt;
    const dueAt = new Date(anchor.getTime() + intervalDays * 86_400_000);
    if (dueAt <= now) {
      due.push({
        store: r.store,
        id: r.id,
        doc: r.doc,
        lastVerifiedAt: r.lastVerifiedAt,
        intervalDays,
      });
    }
  }
  return due;
}

/** Full rows (docs + governance metadata) — the read the backup/export
 *  serializer and the importer's diff pass need. One store, or every store
 *  when omitted. */
export async function readRecordRows(store?: string) {
  const db = getDb();
  if (store) return db.select().from(record).where(eq(record.store, store));
  return db.select().from(record);
}

/** Importer-only: park a record that failed validation. Never written to
 *  `record`; the runbook's quarantine workflow resolves it. */
export async function insertQuarantineRow(row: {
  store: string;
  id: string;
  doc: Record<string, unknown> | null;
  errors: unknown;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(quarantine)
    .values(row)
    .onConflictDoUpdate({
      target: [quarantine.store, quarantine.id],
      set: { doc: row.doc, errors: row.errors, resolvedAt: null },
    });
}

// Health probe (SELECT 1), memoized ~60s so Render + UptimeRobot polling
// doesn't hammer Neon. Failure result is also cached for the window — the
// platform retries anyway.
let lastProbe: { at: number; ok: boolean } | null = null;

export async function dbHealthy(): Promise<boolean> {
  if (lastProbe && Date.now() - lastProbe.at < 60_000) return lastProbe.ok;
  let ok = false;
  try {
    await getDb().execute(sql`SELECT 1`);
    ok = true;
  } catch {
    ok = false;
  }
  lastProbe = { at: Date.now(), ok };
  return ok;
}

/** Tombstone a record (preserving its last doc content), audited as a
 *  delete. Callers that already hold the full record can equally pass
 *  `{ ...record, _deleted: true }` to writeRecord — same path. */
export async function deleteRecord(
  store: string,
  id: string,
  meta?: WriteMeta,
): Promise<void> {
  const existing = await readRecords<WithId>(store);
  const current = existing.find((r) => r.id === id);
  const { _deleted: _ignored, ...doc } = (current ?? { id }) as {
    _deleted?: boolean;
  } & WithId;
  await writeRecord(store, { ...doc, _deleted: true } as OverlayRow<WithId>, meta);
}
