// Race registrant store (db layer — drizzle lives only under src/lib/db per
// the dependency-cruiser boundary). Mirrors volunteer-signups.ts.
//
// PII: audit rows carry registrant IDS only — never a name or email.
// Name/email are written once, on insert (the sync fetches a Zeffy contact
// only for a ticket it has not seen); an upsert on an existing row never
// touches them. The shirt answer IS refreshed on every sync — except on an
// anonymized row, where it stays null. Before 2026-09-22 it was refreshed
// there too, and since the retention sweep skips rows already marked
// anonymized, an erased answer came back for good.

import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";

import { getDb } from "./client";
import { importRun } from "./import-schema";
import { raceCheckinLink, raceRegistrant, type RaceRegistrantRow, type RaceRegistrantStatus } from "./race-schema";
import { audit } from "./schema";

export const RACE_SYNC_SOURCE = "zeffy";
export const RACE_AUDIT_STORE = "race_registrant";

export interface RegistrantInput {
  paymentId: string;
  itemId: string;
  contactId: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  rateTitle: string;
  shirtNote: string | null;
  waiverSigned: boolean | null;
  status: RaceRegistrantStatus;
  needsReviewReason: string | null;
  registeredAt: Date;
}

/** What the sync needs to know about rows already stored. */
export interface ExistingRegistrant {
  id: string;
  paymentId: string;
  itemId: string;
  contactId: string | null;
  status: RaceRegistrantStatus;
}

async function auditRows(
  action: string,
  ids: string[],
  actor: string,
  after?: Record<string, unknown>,
  db: Pick<ReturnType<typeof getDb>, "insert"> = getDb(),
): Promise<void> {
  if (ids.length === 0) return;
  await db
    .insert(audit)
    .values(
      ids.map((id) => ({
        actor,
        action,
        store: RACE_AUDIT_STORE,
        recordId: id,
        after: after ?? {},
        source: "sync" as const,
      })),
    );
}

export async function listExistingRegistrants(): Promise<ExistingRegistrant[]> {
  return getDb()
    .select({
      id: raceRegistrant.id,
      paymentId: raceRegistrant.paymentId,
      itemId: raceRegistrant.itemId,
      contactId: raceRegistrant.contactId,
      status: raceRegistrant.status,
    })
    .from(raceRegistrant);
}

/** Insert-or-update on (payment_id, item_id). Names/email only on insert. */
export async function upsertRegistrants(
  rows: RegistrantInput[],
  actor: string,
): Promise<{ inserted: string[] }> {
  if (rows.length === 0) return { inserted: [] };
  const before = new Set(
    (await listExistingRegistrants()).map((r) => `${r.paymentId}:${r.itemId}`),
  );
  const returned = await getDb()
    .insert(raceRegistrant)
    .values(rows)
    .onConflictDoUpdate({
      target: [raceRegistrant.paymentId, raceRegistrant.itemId],
      set: {
        contactId: sql`coalesce(${raceRegistrant.contactId}, excluded.contact_id)`,
        rateTitle: sql`excluded.rate_title`,
        shirtNote: sql`case when ${raceRegistrant.anonymizedAt} is null then excluded.shirt_note else null end`,
        waiverSigned: sql`excluded.waiver_signed`,
        status: sql`excluded.status`,
        needsReviewReason: sql`excluded.needs_review_reason`,
        registeredAt: sql`excluded.registered_at`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: raceRegistrant.id, paymentId: raceRegistrant.paymentId, itemId: raceRegistrant.itemId });
  const inserted = returned
    .filter((r) => !before.has(`${r.paymentId}:${r.itemId}`))
    .map((r) => r.id);
  await auditRows("create", inserted, actor);
  return { inserted };
}

/** A refunded or deleted payment cancels every ticket on it. Idempotent. */
export async function cancelRegistrantsForPayment(paymentId: string, actor: string): Promise<number> {
  const rows = await getDb()
    .update(raceRegistrant)
    .set({ status: "cancelled", updatedAt: sql`now()` })
    .where(and(eq(raceRegistrant.paymentId, paymentId), eq(raceRegistrant.status, "active")))
    .returning({ id: raceRegistrant.id });
  await auditRows("status-change", rows.map((r) => r.id), actor, { status: "cancelled" });
  return rows.length;
}

/** Removes rows that were never registrations — add-on items (the shirt)
 *  that the sync once mistook for runners. Physical delete; the audit row
 *  carries the id only, and lands in the same transaction. An anonymized row
 *  is left alone: deleting it would also delete the mark that keeps it
 *  erased. Returns how many went. */
export async function deleteRegistrantsForItems(
  items: { paymentId: string; itemId: string }[],
  actor: string,
): Promise<number> {
  if (items.length === 0) return 0;
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .delete(raceRegistrant)
      .where(
        and(
          isNull(raceRegistrant.anonymizedAt),
          or(...items.map((i) => and(eq(raceRegistrant.paymentId, i.paymentId), eq(raceRegistrant.itemId, i.itemId)))),
        ),
      )
      .returning({ id: raceRegistrant.id });
    await auditRows("delete", rows.map((r) => r.id), actor, { reason: "add-on, not a runner" }, tx);
    return rows.length;
  });
}

/** Everything the admin roster shows. The ONLY read that returns emails. */
export async function listRegistrants(): Promise<RaceRegistrantRow[]> {
  return getDb()
    .select()
    .from(raceRegistrant)
    .orderBy(raceRegistrant.lastName, raceRegistrant.firstName, raceRegistrant.registeredAt);
}

/** The volunteer check-in view: active runners, no email, no Zeffy ids. */
export interface CheckinRosterRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  rateTitle: string;
  shirtNote: string | null;
  waiverSigned: boolean | null;
  needsReviewReason: string | null;
  checkedInAt: Date | null;
}

export async function listCheckinRoster(): Promise<CheckinRosterRow[]> {
  return getDb()
    .select({
      id: raceRegistrant.id,
      firstName: raceRegistrant.firstName,
      lastName: raceRegistrant.lastName,
      rateTitle: raceRegistrant.rateTitle,
      shirtNote: raceRegistrant.shirtNote,
      waiverSigned: raceRegistrant.waiverSigned,
      needsReviewReason: raceRegistrant.needsReviewReason,
      checkedInAt: raceRegistrant.checkedInAt,
    })
    .from(raceRegistrant)
    .where(eq(raceRegistrant.status, "active"))
    .orderBy(raceRegistrant.lastName, raceRegistrant.firstName);
}

export type SetCheckedInResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "not-found" | "cancelled" };

/** Set-state, not toggle: a second identical request changes nothing, so a
 *  double tap or a replayed request is harmless. Cancelled runners refuse. */
export async function setCheckedIn(
  id: string,
  checkedIn: boolean,
  by: string,
): Promise<SetCheckedInResult> {
  const guard = checkedIn ? isNull(raceRegistrant.checkedInAt) : isNotNull(raceRegistrant.checkedInAt);
  const updated = await getDb()
    .update(raceRegistrant)
    .set(
      checkedIn
        ? { checkedInAt: sql`now()`, checkedInBy: by, updatedAt: sql`now()` }
        : { checkedInAt: null, checkedInBy: null, updatedAt: sql`now()` },
    )
    .where(and(eq(raceRegistrant.id, id), eq(raceRegistrant.status, "active"), guard))
    .returning({ id: raceRegistrant.id });
  if (updated.length > 0) {
    await auditRows("update", [id], by, { checkedIn });
    return { ok: true, changed: true };
  }
  const rows = await getDb()
    .select({ status: raceRegistrant.status })
    .from(raceRegistrant)
    .where(eq(raceRegistrant.id, id))
    .limit(1);
  if (rows.length === 0) return { ok: false, reason: "not-found" };
  if (rows[0].status !== "active") return { ok: false, reason: "cancelled" };
  return { ok: true, changed: false };
}

/* ------------------------------ check-in link ------------------------------ */

export async function getCheckinLink(raceId: string) {
  const rows = await getDb()
    .select()
    .from(raceCheckinLink)
    .where(eq(raceCheckinLink.raceId, raceId))
    .limit(1);
  return rows[0];
}

/** Minting bumps the version, so every earlier link stops working. */
export async function mintCheckinLink(raceId: string, expiresAt: Date, mintedBy: string) {
  const rows = await getDb()
    .insert(raceCheckinLink)
    .values({ raceId, version: 1, expiresAt, mintedBy })
    .onConflictDoUpdate({
      target: raceCheckinLink.raceId,
      set: {
        version: sql`${raceCheckinLink.version} + 1`,
        expiresAt,
        mintedBy,
        mintedAt: sql`now()`,
        revokedAt: null,
      },
    })
    .returning();
  return rows[0];
}

export async function revokeCheckinLink(raceId: string): Promise<boolean> {
  const rows = await getDb()
    .update(raceCheckinLink)
    .set({ version: sql`${raceCheckinLink.version} + 1`, revokedAt: sql`now()` })
    .where(eq(raceCheckinLink.raceId, raceId))
    .returning({ raceId: raceCheckinLink.raceId });
  return rows.length > 0;
}

/* -------------------------------- sync runs -------------------------------- */

export async function recordRaceSyncRun(input: {
  runBy: string;
  stats: Record<string, number>;
  report: Record<string, unknown>;
  startedAt: Date;
}) {
  const rows = await getDb()
    .insert(importRun)
    .values({
      source: RACE_SYNC_SOURCE,
      mode: "apply",
      startedAt: input.startedAt,
      finishedAt: sql`now()`,
      runBy: input.runBy,
      stats: input.stats,
      report: input.report,
    })
    .returning({ id: importRun.id });
  return rows[0].id;
}

export async function lastRaceSyncRun() {
  const rows = await getDb()
    .select()
    .from(importRun)
    .where(eq(importRun.source, RACE_SYNC_SOURCE))
    .orderBy(desc(importRun.startedAt))
    .limit(1);
  return rows[0];
}

/* ------------------------- E11 PII-inventory handlers ------------------------- */

export async function findRegistrantsByEmail(email: string): Promise<RaceRegistrantRow[]> {
  return getDb()
    .select()
    .from(raceRegistrant)
    .where(
      and(
        sql`lower(${raceRegistrant.email}) = lower(${email})`,
        isNull(raceRegistrant.anonymizedAt),
      ),
    );
}

export async function anonymizeRegistrantsByEmail(email: string, actor: string): Promise<number> {
  const rows = await getDb()
    .update(raceRegistrant)
    .set({ firstName: null, lastName: null, email: null, shirtNote: null, anonymizedAt: sql`now()` })
    .where(
      and(
        sql`lower(${raceRegistrant.email}) = lower(${email})`,
        isNull(raceRegistrant.anonymizedAt),
      ),
    )
    .returning({ id: raceRegistrant.id });
  await auditRows("update", rows.map((r) => r.id), actor, { anonymized: true });
  return rows.length;
}

export async function countUnanonymizedRegistrants(): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(raceRegistrant)
    .where(isNull(raceRegistrant.anonymizedAt));
  return rows[0]?.n ?? 0;
}

/** Retention: null every runner's name/email/shirt note once the race is
 *  past its window. Keeps status, ticket type and check-in for counts. */
export async function anonymizeAllRegistrants(actor: string): Promise<number> {
  const rows = await getDb()
    .update(raceRegistrant)
    .set({ firstName: null, lastName: null, email: null, shirtNote: null, anonymizedAt: sql`now()` })
    .where(isNull(raceRegistrant.anonymizedAt))
    .returning({ id: raceRegistrant.id });
  await auditRows("update", rows.map((r) => r.id), actor, { anonymized: true });
  return rows.length;
}
