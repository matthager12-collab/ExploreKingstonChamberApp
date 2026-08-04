// E20 volunteer-signup substrate — the one PII-holding table this epic adds.
// Re-exported from schema.ts (the drizzle-kit source of truth) exactly like
// import-schema.ts (E17).
//
// PII posture (E11 registration contract — see privacy/pii-inventory.ts):
// `name` and `contact` are the ONLY personal fields, they are nullable ON
// PURPOSE (the retention sweep nulls them 45 days after the shift date,
// keeping `state` for aggregate no-show stats), and they must never appear
// in audit rows, logs, or any public response.
//
// `idempotency_key` is UNIQUE on the row rather than claimed in the shared
// E13 idempotency_keys table: a replayed signup must get back the ORIGINAL
// signupId/spotsLeft, which a seen-it marker cannot reproduce. Same header
// convention (X-Idempotency-Key), deliberately different dedupe store —
// documented in docs/SDD.md per the E20 charter.

import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const VOLUNTEER_SIGNUP_STATES = ["signed_up", "cancelled", "checked_in"] as const;
export type VolunteerSignupState = (typeof VOLUNTEER_SIGNUP_STATES)[number];

export const VOLUNTEER_CONTACT_KINDS = ["email", "phone"] as const;
export type VolunteerContactKind = (typeof VOLUNTEER_CONTACT_KINDS)[number];

export const volunteerSignup = pgTable(
  "volunteer_signup",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The VolunteerNeed.id this signup holds a slot on. */
    shiftId: text("shift_id").notNull(),
    /** Nullable for anonymization only — every insert provides a value. */
    name: text("name"),
    contact: text("contact"),
    contactKind: text("contact_kind").notNull(),
    state: text("state").notNull().default("signed_up"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    /** "self" or the checking-in coordinator's user id — never a name. */
    checkedInBy: text("checked_in_by"),
    reminder2dSentAt: timestamp("reminder_2d_sent_at", { withTimezone: true }),
    reminder2hSentAt: timestamp("reminder_2h_sent_at", { withTimezone: true }),
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("volunteer_signup_shift_state_idx").on(t.shiftId, t.state),
    check(
      "volunteer_signup_state_check",
      sql`${t.state} in ('signed_up', 'cancelled', 'checked_in')`,
    ),
    check(
      "volunteer_signup_contact_kind_check",
      sql`${t.contactKind} in ('email', 'phone')`,
    ),
  ],
);
