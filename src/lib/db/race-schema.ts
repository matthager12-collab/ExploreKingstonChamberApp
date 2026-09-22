// Race registrants synced from Zeffy (the Chamber's ticketing provider) plus
// the one-row table behind the race-day check-in link. Re-exported from
// schema.ts like volunteer-signup-schema.ts, whose PII posture this copies:
// a dedicated table rather than the `record` store, because writeRecord
// snapshots whole docs into the immortal audit table and a runner's email
// must not be copied there on every check-in tap. Audit rows for this table
// carry ids only; `first_name`, `last_name` and `email` are nullable on
// purpose — the retention sweep nulls them after the race.
//
// No bib column: the timing company assigns bibs. If its list is ever
// wanted here, that is one ALTER and a CSV step.

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const RACE_REGISTRANT_STATUSES = ["active", "cancelled"] as const;
export type RaceRegistrantStatus = (typeof RACE_REGISTRANT_STATUSES)[number];

export const raceRegistrant = pgTable(
  "race_registrant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Zeffy payment + line item: one ticket = one row, upserted on this pair. */
    paymentId: text("payment_id").notNull(),
    itemId: text("item_id").notNull(),
    /** Zeffy attendee contact; null when the form did not ask per-attendee details. */
    contactId: text("contact_id"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    email: text("email"),
    /** Ticket type, e.g. "Early Bird Runner Registration". */
    rateTitle: text("rate_title").notNull(),
    /** The buyer's free-text t-shirt answer, copied to each ticket of the order. */
    shirtNote: text("shirt_note"),
    /** Null until a waiver question exists on the form. */
    waiverSigned: boolean("waiver_signed"),
    status: text("status").$type<RaceRegistrantStatus>().notNull().default("active"),
    /** "no-contact-id" | "partial-refund" — orthogonal to status. */
    needsReviewReason: text("needs_review_reason"),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    /** An admin's opaque user id or "volunteer-link" — never a name. */
    checkedInBy: text("checked_in_by"),
    /** Zeffy's payment.created. */
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull(),
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("race_registrant_payment_item_uniq").on(t.paymentId, t.itemId),
    index("race_registrant_status_idx").on(t.status),
    check("race_registrant_status_check", sql`${t.status} in ('active', 'cancelled')`),
  ],
);

export type RaceRegistrantRow = typeof raceRegistrant.$inferSelect;

/** One row per race: the version the race-day link token must match. Revoke
 *  = bump the version (the sessionVersion pattern in auth). */
export const raceCheckinLink = pgTable("race_checkin_link", {
  raceId: text("race_id").primaryKey(),
  version: integer("version").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  /** The minting admin's opaque user id — never an email. */
  mintedBy: text("minted_by").notNull(),
  mintedAt: timestamp("minted_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type RaceCheckinLinkRow = typeof raceCheckinLink.$inferSelect;
