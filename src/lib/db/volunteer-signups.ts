// E20 volunteer-signup store (db layer — drizzle handles live only under
// src/lib/db per the dependency-cruiser boundary; src/lib/stores/
// volunteer-signup-store.ts is the app-facing delegate).
//
// DISCIPLINE (charter "Always" block): every state change is a single
// conditional statement — never read-check-write across statements. The slot
// counter itself moves only through records.adjustVolunteerSlots (the record
// table stays records.ts's exclusive territory). The signup/claim pair runs
// SEQUENTIALLY with unique-violation compensation exactly as the charter
// specifies — the counter can never drift; a crash between claim and insert
// can strand at most one slot, which the audit trail makes reconcilable.
//
// PII: audit rows carry signup/shift IDS ONLY — never name or contact
// (pinned by the hygiene test). Anonymization nulls name/contact and keeps
// `state` for aggregate no-show stats.

import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import { getDb } from "./client";
import { audit } from "./schema";
import { adjustVolunteerSlots } from "./records";
import {
  volunteerSignup,
  type VolunteerContactKind,
} from "./volunteer-signup-schema";

export type SignupRow = typeof volunteerSignup.$inferSelect;

/** Public response shape — derived, never the raw row (no PII leak-by-spread).
 *  "full" is the only store-level refusal: the ROUTE pre-checks shift
 *  existence/liveness/date via the live-only getter (404/410 live there), so
 *  by the time this store runs, a null slot claim can only mean full. */
export type SignupResult =
  | { ok: true; signupId: string; spotsLeft: number; replayed: boolean }
  | { ok: false; reason: "full" };

const AUDIT_ACTOR = "volunteer-signup";

async function auditSignup(
  action: string,
  signupId: string,
  shiftId: string,
  actor: string = AUDIT_ACTOR,
): Promise<void> {
  await getDb()
    .insert(audit)
    .values({
      actor,
      action,
      store: "volunteer_signup",
      recordId: signupId,
      // IDs only — a volunteer's name/contact must never enter the trail.
      after: { shiftId },
      source: "public",
    });
}

async function findByIdempotencyKey(key: string): Promise<SignupRow | undefined> {
  const rows = await getDb()
    .select()
    .from(volunteerSignup)
    .where(eq(volunteerSignup.idempotencyKey, key))
    .limit(1);
  return rows[0];
}

async function findById(signupId: string): Promise<SignupRow | undefined> {
  const rows = await getDb()
    .select()
    .from(volunteerSignup)
    .where(eq(volunteerSignup.id, signupId))
    .limit(1);
  return rows[0];
}

export { findById as getSignup };

/** Spots left on a shift, from the shared counter — for replayed responses. */
async function spotsLeftOf(shiftId: string): Promise<number> {
  const res = await getDb().execute(sql`
    SELECT greatest(coalesce((doc->>'slotsTotal')::int, 0) - coalesce((doc->>'slotsFilled')::int, 0), 0) AS left
    FROM record WHERE store = 'volunteer-needs' AND id = ${shiftId}
  `);
  const rows = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  return Number((rows[0] as { left: unknown }).left ?? 0);
}

/**
 * The no-account signup write. `idempotencyKey` is the X-Idempotency-Key
 * HEADER value (E13 convention) — the route passes it in; it is never a
 * client body field. Flow per charter step 3:
 *   1. pre-check by key — hit ⇒ replay the ORIGINAL result, no increment;
 *   2. claim a slot atomically (guards live/deleted/full);
 *   3. insert; a concurrent unique-violation on the key ⇒ compensate the
 *      counter down and return the winner's row.
 */
export async function createSignup(input: {
  shiftId: string;
  name: string;
  contact: string;
  contactKind: VolunteerContactKind;
  idempotencyKey: string;
}): Promise<SignupResult> {
  const existing = await findByIdempotencyKey(input.idempotencyKey);
  if (existing) {
    return {
      ok: true,
      signupId: existing.id,
      spotsLeft: await spotsLeftOf(existing.shiftId),
      replayed: true,
    };
  }

  const claimed = await adjustVolunteerSlots(input.shiftId, 1, {
    actor: AUDIT_ACTOR,
    source: "public",
  });
  if (!claimed) return { ok: false, reason: "full" };

  try {
    const inserted = await getDb()
      .insert(volunteerSignup)
      .values({
        shiftId: input.shiftId,
        name: input.name,
        contact: input.contact,
        contactKind: input.contactKind,
        idempotencyKey: input.idempotencyKey,
      })
      .returning({ id: volunteerSignup.id });
    const signupId = inserted[0].id;
    await auditSignup("create", signupId, input.shiftId);
    return {
      ok: true,
      signupId,
      spotsLeft: Math.max(claimed.slotsTotal - claimed.slotsFilled, 0),
      replayed: false,
    };
  } catch (err) {
    // Concurrent replay raced us to the unique idempotency_key: give the slot
    // back and return the winner — the counter never drifts.
    if (err instanceof Error && /unique|duplicate key/i.test(err.message)) {
      await adjustVolunteerSlots(input.shiftId, -1, {
        actor: AUDIT_ACTOR,
        source: "public",
      });
      const winner = await findByIdempotencyKey(input.idempotencyKey);
      if (winner) {
        return {
          ok: true,
          signupId: winner.id,
          spotsLeft: await spotsLeftOf(winner.shiftId),
          replayed: true,
        };
      }
    }
    throw err;
  }
}

export type CancelResult =
  | { ok: true; alreadyCancelled: boolean; shiftId: string }
  | { ok: false; reason: "not-found" };

/** FR-VOL-04 auto-reopen: cancelling frees the slot (conditional decrement —
 *  the spot simply returns to public availability). Idempotent: re-cancel
 *  reports alreadyCancelled without touching the counter again. */
export async function cancelSignup(signupId: string): Promise<CancelResult> {
  const updated = await getDb()
    .update(volunteerSignup)
    .set({ state: "cancelled", cancelledAt: sql`now()` })
    .where(
      and(
        eq(volunteerSignup.id, signupId),
        inArray(volunteerSignup.state, ["signed_up", "checked_in"]),
      ),
    )
    .returning({ id: volunteerSignup.id, shiftId: volunteerSignup.shiftId });

  if (updated.length > 0) {
    const { shiftId } = updated[0];
    await adjustVolunteerSlots(shiftId, -1, { actor: AUDIT_ACTOR, source: "public" });
    await auditSignup("delete", signupId, shiftId);
    return { ok: true, alreadyCancelled: false, shiftId };
  }
  const row = await findById(signupId);
  if (!row) return { ok: false, reason: "not-found" };
  return { ok: true, alreadyCancelled: true, shiftId: row.shiftId };
}

export type CheckInResult =
  | { ok: true; alreadyCheckedIn: boolean; shiftId: string }
  | { ok: false; reason: "not-found" | "cancelled" };

/** Day-of check-in — the endpoint the outbox replays, so idempotency is by
 *  state machine: a second identical request reports alreadyCheckedIn with
 *  checked_in_at untouched. */
export async function checkInSignup(signupId: string, by: string): Promise<CheckInResult> {
  const updated = await getDb()
    .update(volunteerSignup)
    .set({ state: "checked_in", checkedInAt: sql`now()`, checkedInBy: by })
    .where(and(eq(volunteerSignup.id, signupId), eq(volunteerSignup.state, "signed_up")))
    .returning({ id: volunteerSignup.id, shiftId: volunteerSignup.shiftId });

  if (updated.length > 0) {
    await auditSignup("update", signupId, updated[0].shiftId, by === "self" ? AUDIT_ACTOR : by);
    return { ok: true, alreadyCheckedIn: false, shiftId: updated[0].shiftId };
  }
  const row = await findById(signupId);
  if (!row) return { ok: false, reason: "not-found" };
  if (row.state === "checked_in") return { ok: true, alreadyCheckedIn: true, shiftId: row.shiftId };
  return { ok: false, reason: "cancelled" };
}

/** "Still coming?" — idempotent by construction (setting confirmed_at twice
 *  is the same fact). Only signed-up rows confirm. */
export async function confirmSignup(signupId: string): Promise<boolean> {
  const updated = await getDb()
    .update(volunteerSignup)
    .set({ confirmedAt: sql`coalesce(${volunteerSignup.confirmedAt}, now())` })
    .where(and(eq(volunteerSignup.id, signupId), eq(volunteerSignup.state, "signed_up")))
    .returning({ id: volunteerSignup.id });
  return updated.length > 0;
}

/** Coordinator roster — the ONLY read that returns names/contacts; its route
 *  gates on canEdit against the stored shift's charity (slice 3). */
export async function listRoster(shiftId: string): Promise<SignupRow[]> {
  return getDb()
    .select()
    .from(volunteerSignup)
    .where(eq(volunteerSignup.shiftId, shiftId))
    .orderBy(volunteerSignup.createdAt);
}

/** Active (slot-holding) signups on a shift — the slice-3 stepper clamp. */
export async function activeSignupCount(shiftId: string): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(volunteerSignup)
    .where(
      and(
        eq(volunteerSignup.shiftId, shiftId),
        inArray(volunteerSignup.state, ["signed_up", "checked_in"]),
      ),
    );
  return rows[0]?.n ?? 0;
}

/** Claim-then-send (charter step 10): atomically stamp reminder_*_sent_at on
 *  the due rows and RETURN exactly the claimed set — a crashed run may skip
 *  a reminder but can never double-send. The caller (the sweep) computes the
 *  in-window shiftIds from the needs store; email-contact rows only. */
export async function claimDueReminders(
  kind: "2d" | "2h",
  shiftIds: string[],
): Promise<SignupRow[]> {
  if (shiftIds.length === 0) return [];
  const column = kind === "2d" ? volunteerSignup.reminder2dSentAt : volunteerSignup.reminder2hSentAt;
  return getDb()
    .update(volunteerSignup)
    .set(kind === "2d" ? { reminder2dSentAt: sql`now()` } : { reminder2hSentAt: sql`now()` })
    .where(
      and(
        inArray(volunteerSignup.shiftId, shiftIds),
        eq(volunteerSignup.state, "signed_up"),
        eq(volunteerSignup.contactKind, "email"),
        isNull(column),
        isNull(volunteerSignup.anonymizedAt),
      ),
    )
    .returning();
}

/** Retention (45 days after the shift date — the sweep computes which
 *  shiftIds are past-window and passes them in): null the PII, stamp
 *  anonymized_at, KEEP state for aggregate no-show stats. */
export async function anonymizeForShifts(shiftIds: string[]): Promise<number> {
  if (shiftIds.length === 0) return 0;
  const rows = await getDb()
    .update(volunteerSignup)
    .set({ name: null, contact: null, anonymizedAt: sql`now()` })
    .where(
      and(inArray(volunteerSignup.shiftId, shiftIds), isNull(volunteerSignup.anonymizedAt)),
    )
    .returning({ id: volunteerSignup.id });
  return rows.length;
}

/** Backstop for signups whose shift was tombstoned (a {id}-only tombstone
 *  keeps no date, so shift-relative retention can't see it): anonymize by
 *  row age once it is unambiguously past any plausible shift window. */
export async function anonymizeOlderThan(cutoff: Date): Promise<number> {
  const rows = await getDb()
    .update(volunteerSignup)
    .set({ name: null, contact: null, anonymizedAt: sql`now()` })
    .where(and(lt(volunteerSignup.createdAt, cutoff), isNull(volunteerSignup.anonymizedAt)))
    .returning({ id: volunteerSignup.id });
  return rows.length;
}

/* ------------------------- E11 PII-inventory handlers ------------------------- */

/** Email-identifier lookups for the consumer access/delete workflow. Phone
 *  contacts are unreachable by email lookup — documented in the inventory
 *  entry; the retention sweep is what bounds their lifetime. */
export async function findSignupsByEmail(email: string): Promise<SignupRow[]> {
  return getDb()
    .select()
    .from(volunteerSignup)
    .where(
      and(
        eq(volunteerSignup.contact, email),
        eq(volunteerSignup.contactKind, "email"),
        isNull(volunteerSignup.anonymizedAt),
      ),
    );
}

export async function anonymizeSignupsByEmail(email: string, actor: string): Promise<number> {
  const rows = await getDb()
    .update(volunteerSignup)
    .set({ name: null, contact: null, anonymizedAt: sql`now()` })
    .where(
      and(
        eq(volunteerSignup.contact, email),
        eq(volunteerSignup.contactKind, "email"),
        isNull(volunteerSignup.anonymizedAt),
      ),
    )
    .returning({ id: volunteerSignup.id, shiftId: volunteerSignup.shiftId });
  for (const row of rows) {
    await auditSignup("update", row.id, row.shiftId, actor);
  }
  return rows.length;
}
