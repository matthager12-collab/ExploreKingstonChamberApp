// Self-serve claim tables (E17 claim-signup slice).
//
// Two tables, one flow: a business owner finds their listing, signs up on the
// spot, proves their email with a one-time code, and either walks straight
// into their portal (their email is on the Chamber's roster for that listing)
// or lands in the Chamber worklist for a human yes.
//
// claim_contact — which email(s) the Chamber has on file per listing. This
// table DELIBERATELY brings roster emails into the app database, reversing
// the importer's original "PII stays in the operator CSV" posture: Mat
// approved the reversal 2026-08-11 for auto-approval matching, and the app is
// becoming the membership SoR anyway (docs/ROLLOFF-GROWTHZONE.md §3). The
// containment rules that make that acceptable:
//   - rows are matched against, never listed to a browser — no API returns
//     email values to any non-admin surface;
//   - lookups are per-(store, id, email): the match endpoint can only confirm
//     an email its caller has ALREADY proven control of (code round-trip);
//   - provenance travels with every row (source + created_by) so a re-import
//     can be reasoned about later.
//
// claim_signup — a signup waiting on its emailed code. Holds the password
// HASH (never plaintext) so no account exists until the code round-trip
// proves the mailbox. Rows are short-lived (15 minutes), reaped
// opportunistically, and never rendered anywhere — the worklist item the
// Chamber sees is created only AFTER verification, and never carries the hash.

import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** An email the Chamber's roster associates with one claimable listing.
 *  Emails are stored lowercased (the only form ever compared). */
export const claimContact = pgTable(
  "claim_contact",
  {
    /** Store name in the record vocabulary ("directory", "restaurants", …). */
    subjectStore: text("subject_store").notNull(),
    subjectId: text("subject_id").notNull(),
    emailLower: text("email_lower").notNull(),
    /** Provenance: 'import:growthzone' | 'seed:claim-test' | 'admin'. */
    source: text("source").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Re-imports upsert; one row per (listing, email) no matter how often the
    // roster is reloaded.
    uniqueIndex("claim_contact_subject_email_uniq").on(
      t.subjectStore,
      t.subjectId,
      t.emailLower,
    ),
  ],
);

export type ClaimContactRow = typeof claimContact.$inferSelect;

/** A pending self-signup: everything needed to create the account once the
 *  emailed code comes back, and nothing usable before then. */
export const claimSignup = pgTable(
  "claim_signup",
  {
    /** Opaque handle (generateId()) — the client echoes it with the code. */
    id: text("id").primaryKey(),
    subjectStore: text("subject_store").notNull(),
    subjectId: text("subject_id").notNull(),
    /** Listing name at signup time, for the worklist item and the org name. */
    subjectLabel: text("subject_label").notNull(),
    name: text("name").notNull(),
    emailLower: text("email_lower").notNull(),
    /** scrypt$salt$hash — same format as users.password_hash. */
    passwordHash: text("password_hash").notNull(),
    /** scrypt hash of the 6-digit code; the plaintext code exists only in the
     *  email (and, in dev with email disabled, the server log). */
    codeHash: text("code_hash").notNull(),
    /** Failed verify attempts. The row dies at MAX_CODE_ATTEMPTS — a 6-digit
     *  space is only safe when guesses are counted server-side. */
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set when the code is redeemed; a consumed row refuses re-verification
     *  exactly like an expired one. */
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => [index("claim_signup_subject_idx").on(t.subjectStore, t.subjectId)],
);

export type ClaimSignupRow = typeof claimSignup.$inferSelect;
