// E11 privacy deletion + legal-hold data layer.
//
// THE HARD-DELETE CARVE-OUT (D-10): the record store's normal deletion is a
// tombstone (deleteRecord/writeRecord — doc preserved, full-doc audit
// snapshot). That idiom is exactly wrong for privacy purges: a "deleted"
// hunt submission would keep its GPS in record.doc forever and mint another
// snapshot into the immortal audit table. hardDeleteRecords is the ONLY
// physical delete for record rows, reserved for privacy retention and
// MHMDA-delete fulfillment — everything else keeps using tombstones. (Same
// posture as the append-table DELETEs in append.ts: a documented, narrow
// exception to the choke point, not a general-purpose API.)
//
// LEGAL HOLD (FR-A92): a (store, record_id) row here overrides BOTH the
// retention purge and consumer deletion; callers must check before any
// destructive action and log a refusal instead (the MHMDA-delete vs
// records-retention reconciliation). Generic table so E16 membership records
// and E30 applications inherit it (re-charter Delta 3).

import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "./client";
import { audit, legalHold, record } from "./schema";

export type HardDeleteResult = {
  /** Rows physically removed. */
  deleted: number;
  /** Ids skipped because a legal hold overrides deletion (for logging). */
  heldSkipped: string[];
};

/**
 * Physically delete record rows — privacy purges + MHMDA fulfillment ONLY
 * (the carve-out note above). LEGAL HOLD IS ENFORCED HERE, in one atomic
 * statement (NOT EXISTS against legal_hold), not by caller discipline: a
 * held row can never be deleted through this function even if a caller
 * forgets to check, and even if the hold is set concurrently — the SQL sees
 * a consistent snapshot. Returns the deleted count and the held-skipped ids
 * so callers can log the FR-A92 reconciliation. Callers still destroy any
 * external artifact (photo) FIRST — and must re-check the hold before doing
 * so, since this backstop protects the row but not an already-deleted photo.
 */
export async function hardDeleteRecords(
  store: string,
  ids: string[],
): Promise<HardDeleteResult> {
  if (ids.length === 0) return { deleted: 0, heldSkipped: [] };
  const db = getDb();
  const held = await heldRecordIds(store, ids);
  const res = await db.delete(record).where(
    and(
      eq(record.store, store),
      inArray(record.id, ids),
      sql`NOT EXISTS (SELECT 1 FROM legal_hold h WHERE h.store = ${record.store} AND h.record_id = ${record.id})`,
    ),
  );
  const r = res as unknown as { rowCount?: number; affectedRows?: number };
  const deleted = r.rowCount ?? r.affectedRows ?? ids.length - held.size;
  return { deleted, heldSkipped: [...held] };
}

export type LegalHoldRow = {
  store: string;
  recordId: string;
  reason: string;
  setBy: string;
  setAt: Date;
};

/** The held ids among `ids` for a store — retention filters purges through
 *  this; fulfillment checks single ids the same way. */
export async function heldRecordIds(store: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await getDb()
    .select({ recordId: legalHold.recordId })
    .from(legalHold)
    .where(and(eq(legalHold.store, store), inArray(legalHold.recordId, ids)));
  return new Set(rows.map((r) => r.recordId));
}

export async function isUnderLegalHold(store: string, recordId: string): Promise<boolean> {
  return (await heldRecordIds(store, [recordId])).has(recordId);
}

/**
 * E11 MHMDA-delete (D-11): re-point every `record.updated_by` that holds a
 * departing user's EMAIL to their opaque, non-identifying user id. These
 * columns are mutable operational metadata (who last touched a record), not
 * the audit trail — so the email leaves the queryable stores while referential
 * integrity is preserved. (The append-only `audit.actor` keeps the email as a
 * records-floor exception, documented in docs/PRIVACY.md.) Returns the count
 * re-keyed. */
export async function rekeyRecordActor(oldActor: string, newActor: string): Promise<number> {
  if (!oldActor || oldActor === newActor) return 0;
  const res = await getDb()
    .update(record)
    .set({ updatedBy: newActor })
    .where(eq(record.updatedBy, oldActor));
  const r = res as unknown as { rowCount?: number; affectedRows?: number };
  return r.rowCount ?? r.affectedRows ?? 0;
}

export async function listLegalHolds(): Promise<LegalHoldRow[]> {
  return getDb().select().from(legalHold);
}

/** Set a hold (idempotent upsert — reason/setter refresh). Audited. */
export async function setLegalHold(
  store: string,
  recordId: string,
  reason: string,
  setBy: string,
): Promise<void> {
  await getDb()
    .insert(legalHold)
    .values({ store, recordId, reason, setBy })
    .onConflictDoUpdate({
      target: [legalHold.store, legalHold.recordId],
      set: { reason, setBy, setAt: new Date() },
    });
  await appendPrivacyAudit({
    actor: setBy,
    action: "legal-hold-set",
    store,
    recordId,
    detail: { reason },
  });
}

/** Clear a hold. Audited. Returns false when no hold existed. */
export async function clearLegalHold(
  store: string,
  recordId: string,
  clearedBy: string,
): Promise<boolean> {
  const res = await getDb()
    .delete(legalHold)
    .where(and(eq(legalHold.store, store), eq(legalHold.recordId, recordId)));
  const r = res as unknown as { rowCount?: number; affectedRows?: number };
  const existed = (r.rowCount ?? r.affectedRows ?? 0) > 0;
  if (existed) {
    await appendPrivacyAudit({
      actor: clearedBy,
      action: "legal-hold-clear",
      store,
      recordId,
      detail: {},
    });
  }
  return existed;
}

/**
 * Append a privacy-event audit row: purge summaries, legal-hold set/clear,
 * privacy-request transitions, hold-refusals. METADATA-ONLY by contract —
 * `detail` carries counts, reasons, and state names, never document bodies
 * and never a requester's contact (the audit table is immortal; E11's own
 * machinery must not create the PII trail it exists to prevent). Rows land
 * in the same append-only audit table and surface in the E09 admin browser.
 */
export async function appendPrivacyAudit(entry: {
  actor: string;
  action: string;
  store: string;
  recordId: string;
  detail: Record<string, unknown>;
}): Promise<void> {
  await getDb().insert(audit).values({
    actor: entry.actor,
    action: entry.action,
    store: entry.store,
    recordId: entry.recordId,
    before: null,
    after: entry.detail,
    source: "privacy",
  });
}

/**
 * E11 MHMDA-delete: remove specific top-level fields from a record-backed
 * store's doc, writing a METADATA-ONLY audit row (the field NAMES, never the
 * values). Bypasses writeRecord deliberately — the normal path snapshots the
 * prior doc into the immortal audit table, which for a privacy erasure would
 * re-immortalize the very value being erased (the charity contact-email case;
 * charities are restore-registered, so a blanket snapshot strip is not an
 * option). A documented privacy carve-out from the choke point, like
 * hardDeleteRecords. Returns true if any field was present and removed. */
export async function scrubRecordDocFields(
  store: string,
  id: string,
  fields: string[],
  actor: string,
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ doc: record.doc })
    .from(record)
    .where(and(eq(record.store, store), eq(record.id, id)));
  if (!row) return false;
  const doc = { ...(row.doc as Record<string, unknown>) };
  let changed = false;
  for (const f of fields) {
    if (f in doc) {
      delete doc[f];
      changed = true;
    }
  }
  if (!changed) return false;
  await db
    .update(record)
    .set({ doc, updatedAt: new Date(), updatedBy: actor })
    .where(and(eq(record.store, store), eq(record.id, id)));
  await appendPrivacyAudit({
    actor,
    action: "privacy-field-scrub",
    store,
    recordId: id,
    detail: { fields }, // names only — never the scrubbed values
  });
  return true;
}
