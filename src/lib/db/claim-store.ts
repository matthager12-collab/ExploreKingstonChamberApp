// SQL for the claim-signup slice (E17). Same layering as auth-store: the
// domain rules live in src/lib/claims/self-signup.ts; this module owns the
// queries and nothing else. No next/headers, no request scope — the seed and
// importer scripts drive it from plain Node.
//
// PRIVACY: claim_contact holds roster emails. Nothing here may be re-exported
// toward a client bundle, and no function returns email values for display —
// reads are an existence check (hasClaimContact) plus per-listing lists for
// ADMIN surfaces and the seed script's reset path only.

import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "./client";
import {
  claimContact,
  claimSignup,
  type ClaimContactRow,
  type ClaimSignupRow,
} from "./claim-schema";

export type { ClaimContactRow, ClaimSignupRow };

/** Canonical email form — the ONLY form stored or compared. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ---------- claim_contact ----------

export interface ClaimContactInput {
  subjectStore: string;
  subjectId: string;
  email: string;
  source: string;
  createdBy: string;
}

/** Idempotent bulk load: a re-import re-asserts rows, never duplicates them.
 *  Returns how many rows were actually new. */
export async function upsertClaimContacts(rows: ClaimContactInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  const values = rows
    .map((r) => ({
      subjectStore: r.subjectStore,
      subjectId: r.subjectId,
      emailLower: normalizeEmail(r.email),
      source: r.source,
      createdBy: r.createdBy,
    }))
    .filter((r) => r.emailLower.includes("@"));
  if (values.length === 0) return 0;
  const inserted = await getDb()
    .insert(claimContact)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: claimContact.subjectId });
  return inserted.length;
}

/** The auto-approval question: is THIS email on file for THIS listing? */
export async function hasClaimContact(
  subjectStore: string,
  subjectId: string,
  email: string,
): Promise<boolean> {
  const rows = await getDb()
    .select({ one: sql<number>`1` })
    .from(claimContact)
    .where(
      and(
        eq(claimContact.subjectStore, subjectStore),
        eq(claimContact.subjectId, subjectId),
        eq(claimContact.emailLower, normalizeEmail(email)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** ADMIN/script surface only — never serialize toward a public response. */
export async function listClaimContacts(
  subjectStore: string,
  subjectId: string,
): Promise<ClaimContactRow[]> {
  return getDb()
    .select()
    .from(claimContact)
    .where(
      and(
        eq(claimContact.subjectStore, subjectStore),
        eq(claimContact.subjectId, subjectId),
      ),
    );
}

/** Seed-reset / re-import hygiene. */
export async function deleteClaimContacts(
  subjectStore: string,
  subjectId: string,
): Promise<number> {
  const gone = await getDb()
    .delete(claimContact)
    .where(
      and(
        eq(claimContact.subjectStore, subjectStore),
        eq(claimContact.subjectId, subjectId),
      ),
    )
    .returning({ id: claimContact.subjectId });
  return gone.length;
}

// ---------- claim_signup ----------

export interface NewClaimSignup {
  id: string;
  subjectStore: string;
  subjectId: string;
  subjectLabel: string;
  name: string;
  email: string;
  passwordHash: string;
  codeHash: string;
  expiresAt: Date;
}

export async function insertClaimSignup(input: NewClaimSignup): Promise<ClaimSignupRow> {
  const [row] = await getDb()
    .insert(claimSignup)
    .values({
      id: input.id,
      subjectStore: input.subjectStore,
      subjectId: input.subjectId,
      subjectLabel: input.subjectLabel,
      name: input.name,
      emailLower: normalizeEmail(input.email),
      passwordHash: input.passwordHash,
      codeHash: input.codeHash,
      expiresAt: input.expiresAt,
    })
    .returning();
  return row;
}

export async function findClaimSignup(id: string): Promise<ClaimSignupRow | undefined> {
  const [row] = await getDb().select().from(claimSignup).where(eq(claimSignup.id, id));
  return row;
}

/** Count a verification attempt BEFORE checking the code, so a crash between
 *  the two can only ever under-report successes, never under-count guesses.
 *  Returns the fresh attempt total. */
export async function bumpClaimSignupAttempts(id: string): Promise<number> {
  const [row] = await getDb()
    .update(claimSignup)
    .set({ attempts: sql`${claimSignup.attempts} + 1` })
    .where(eq(claimSignup.id, id))
    .returning({ attempts: claimSignup.attempts });
  return row?.attempts ?? Number.MAX_SAFE_INTEGER;
}

/** Burn the row. Guarded on consumed_at IS NULL so two racing verifies can
 *  not both claim success — exactly one caller sees the row come back. */
export async function consumeClaimSignup(id: string): Promise<ClaimSignupRow | undefined> {
  const [row] = await getDb()
    .update(claimSignup)
    .set({ consumedAt: new Date() })
    .where(and(eq(claimSignup.id, id), sql`${claimSignup.consumedAt} IS NULL`))
    .returning();
  return row;
}

/** Opportunistic hygiene, called from the start route: dead rows carry a
 *  password hash for no one, so they should not linger. */
export async function reapExpiredClaimSignups(now: Date = new Date()): Promise<number> {
  const gone = await getDb()
    .delete(claimSignup)
    .where(lt(claimSignup.expiresAt, now))
    .returning({ id: claimSignup.id });
  return gone.length;
}

/** Seed-reset helper: drop pending signups for the given listings. */
export async function deleteClaimSignupsFor(
  subjectStore: string,
  subjectIds: string[],
): Promise<number> {
  if (subjectIds.length === 0) return 0;
  const gone = await getDb()
    .delete(claimSignup)
    .where(
      and(
        eq(claimSignup.subjectStore, subjectStore),
        inArray(claimSignup.subjectId, subjectIds),
      ),
    )
    .returning({ id: claimSignup.id });
  return gone.length;
}
