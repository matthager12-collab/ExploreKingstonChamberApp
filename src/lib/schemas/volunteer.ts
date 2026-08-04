// Volunteer domain schemas (E20) — created here on purpose: E07 explicitly
// deferred the volunteer-need schema and E12 built only event.ts. Follows
// docs/SCHEMAS.md (strict objects, shared helpers, type parity in
// type-parity.ts).
//
// THE PII FLOOR IS A SCHEMA SHAPE, not a trimming step: the signup input is
// `.strict()` with exactly three keys — shiftId, name, one contact string.
// No address, no birthdate, no second contact, no account fields, and no
// idempotencyKey (that travels ONLY in the X-Idempotency-Key header per the
// E13 convention; a body carrying it is an unknown key and fails). The
// schema-invariant test in volunteer.test.ts pins all of this.

import { z } from "zod";
import type { FieldDef } from "./form";
import { idSchema, optionalTrimmed, requiredTrimmed, trimOrEmpty } from "./shared";

export const VOLUNTEER_NAME_MAX = 100;
export const VOLUNTEER_CONTACT_MAX = 200;

/** "HH:MM" 24-hour Pacific wall time — the machine-readable shift start the
 *  free-text `timeRange` never reliably gave us (E20 charter step 1). */
export const START_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ------------------------------ signup input ---------------------------- */

export const volunteerSignupInputSchema = z
  .object({
    shiftId: idSchema,
    name: z.preprocess(
      trimOrEmpty,
      z
        .string()
        .min(1, "name is required")
        .max(VOLUNTEER_NAME_MAX, `name must be ${VOLUNTEER_NAME_MAX} characters or fewer`),
    ),
    contact: z.preprocess(
      trimOrEmpty,
      z
        .string()
        .min(3, "contact is required — an email address or a phone number")
        .max(
          VOLUNTEER_CONTACT_MAX,
          `contact must be ${VOLUNTEER_CONTACT_MAX} characters or fewer`,
        ),
    ),
  })
  .strict();

export type VolunteerSignupInput = z.infer<typeof volunteerSignupInputSchema>;

/** Server-side contact classification — never a client field. `null` means
 *  the string is neither a plausible email nor a plausible phone number and
 *  the signup is rejected with a human message. */
export function deriveContactKind(contact: string): "email" | "phone" | null {
  const v = contact.trim();
  if (v.includes("@")) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? "email" : null;
  }
  const digits = v.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? "phone" : null;
}

/* ------------------------------ action inputs --------------------------- */

export const volunteerManageActionSchema = z
  .object({
    signupId: z.uuid(),
    token: z.string().min(1).max(500),
    action: z.enum(["cancel", "confirm"]),
  })
  .strict();

/** Check-in has two legal callers (charter step 6): a coordinator session
 *  (token absent — canEdit decides) or an anonymous self check-in carrying a
 *  checkin-purpose token. */
export const volunteerCheckinSchema = z
  .object({
    signupId: z.uuid(),
    token: z.string().min(1).max(500).optional(),
  })
  .strict();

/* ------------------------------ need schema ----------------------------- */

/** Mirrors VolunteerNeed in src/lib/types.ts (+ the E20 optional startTime).
 *  `date` accepts what the two real writers produce: seed records carry a
 *  full ISO instant with offset; the portal anchors bare YYYY-MM-DD at
 *  Pacific midnight — so the rule is "Date.parse must succeed", not one
 *  textual shape. slotsFilled ≤ slotsTotal is deliberately NOT enforced:
 *  the portal's walk-in stepper may legitimately hand-count past total, and
 *  a restore must never quarantine such a record. */
export const volunteerNeedSchema = z.object({
  id: idSchema,
  charityId: idSchema,
  eventId: optionalTrimmed(),
  title: requiredTrimmed("title"),
  date: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "date must be an ISO date"),
  timeRange: z.preprocess(trimOrEmpty, z.string()),
  slotsTotal: z.number().int().min(0).max(999),
  slotsFilled: z.number().int().min(0).max(9999),
  description: z.preprocess(trimOrEmpty, z.string()),
  startTime: z
    .string()
    .regex(START_TIME_RE, "startTime must be HH:MM (24-hour, Pacific)")
    .optional(),
});

export type VolunteerNeedParsed = z.infer<typeof volunteerNeedSchema>;

/** Editor-engine field defs (E07 pattern) — used by the nonprofit portal's
 *  shift form when slice 3 adds startTime there. */
export const volunteerNeedFields: FieldDef[] = [
  { key: "title", label: "Shift title", kind: "text", required: true },
  { key: "date", label: "Date", kind: "text", required: true },
  {
    key: "timeRange",
    label: "Time (as volunteers should read it)",
    kind: "text",
    placeholder: "9:00 AM – 1:00 PM",
  },
  {
    key: "startTime",
    label: "Start time (24h, for reminders)",
    kind: "text",
    optional: true,
    placeholder: "09:00",
  },
  { key: "slotsTotal", label: "Volunteers needed", kind: "text" },
  { key: "description", label: "Description", kind: "textarea", wide: true },
];
