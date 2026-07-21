// Event domain: one schema for the portal event routes, the public suggest
// intake, and any future admin editor (E12, vk/event-schema). E07 shipped the
// pattern and helpers but deliberately not this module (events was an E07
// non-goal); docs/SCHEMAS.md "Adding a domain" is the recipe followed here.
//
// Validates the event DOCUMENT only. Record metadata (status/source/
// external_id) belongs to the Drizzle layer (E05); the moderation hold and
// status-gated rendering belong to E08/E12 route code. The write-gate entry in
// src/lib/db/store-schemas.ts stays the loose baseline on purpose — swapping
// it strict is ask-first (restore-safety, docs/SCHEMAS.md "Wiring the
// importer"). NormalizedEvent (external ingest) is a different shape with its
// own home in src/lib/events/types.ts; this schema is for in-app EventItem
// documents.

import { z } from "zod";
import type { FieldDef } from "./form";
import {
  httpUrlOptional,
  idSchema,
  optionalTrimmed,
  requiredTrimmed,
  trimOrEmpty,
  trimmedText,
} from "./shared";

/** The 7-category allowlist, in the EventCategory declaration order. Single
 *  source for the portal routes' category validation and the editor select. */
export const EVENT_CATEGORIES = [
  "festival",
  "market",
  "music",
  "community",
  "charity",
  "sports",
  "arts",
] as const;

/** ISO 8601 date-time prefix — the same rule the portal route has always
 *  enforced (naive `datetime-local` values pass; normalizeEventTimestamp
 *  attaches the Pacific offset at the route layer, never here, so parsing a
 *  stored record is a byte no-op either way). */
const EVENT_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function eventDateTime(label: string) {
  return z.preprocess(
    trimOrEmpty,
    z
      .string()
      .regex(EVENT_DATETIME_RE, `${label} must be an ISO date-time (YYYY-MM-DDTHH:mm)`),
  );
}

function eventDateTimeOptional(label: string) {
  return z.preprocess(
    (v) => trimOrEmpty(v) || undefined,
    z
      .string()
      .regex(EVENT_DATETIME_RE, `${label} must be an ISO date-time (YYYY-MM-DDTHH:mm)`)
      .optional(),
  );
}

/** Cap on artwork/flyer attachments per event (matches the suggest route). */
export const MAX_ATTACHMENTS = 5;

/** Attachment refs: a bounded array of non-empty strings; an absent or empty
 *  array becomes `undefined` so the key drops out after JSON.stringify (the
 *  omitted-not-empty convention every optional field here follows). */
const attachmentsSchema = z.preprocess(
  (v) => (Array.isArray(v) && v.length > 0 ? v : undefined),
  z
    .array(z.string().min(1), { message: "attachments must be a list of file references" })
    .max(MAX_ATTACHMENTS, `at most ${MAX_ATTACHMENTS} attachments`)
    .optional(),
);

export const eventSchema = z.object({
  id: idSchema,
  title: requiredTrimmed("title"),
  start: eventDateTime("start"),
  end: eventDateTimeOptional("end"),
  venue: requiredTrimmed("venue"),
  address: optionalTrimmed(),
  /** May be empty — the portal has always accepted a blank description. */
  description: trimmedText(),
  category: z.enum(
    EVENT_CATEGORIES,
    `category must be one of: ${EVENT_CATEGORIES.join(", ")}`,
  ),
  organizer: requiredTrimmed("organizer"),
  url: httpUrlOptional("url"),
  /** Public event contact (name + email/phone). Optional in the schema —
   *  seed/ingested events have none; the suggest route enforces presence for
   *  public submissions. Empty → omitted so the key is absent once stored. */
  eventContact: optionalTrimmed(),
  /** Uploaded artwork/flyer refs. The route builds these (blob URLs or
   *  .data/events paths), never free user text; the schema just bounds the
   *  count and drops an empty array to `undefined`. */
  attachments: attachmentsSchema,
  /** Nonprofit cross-listing reference; set by the org portal path only. */
  charityId: optionalTrimmed(),
  /** Portal ownership: the listing/org id whose account manages this event. */
  ownerId: optionalTrimmed(),
});

export const eventFields: FieldDef[] = [
  { key: "title", label: "Title", kind: "text", required: true, wide: true },
  {
    key: "start",
    label: "Starts",
    kind: "text",
    required: true,
    placeholder: "2026-08-01T15:00",
    help: "ISO date-time, Pacific wall clock (YYYY-MM-DDTHH:mm).",
  },
  {
    key: "end",
    label: "Ends",
    kind: "text",
    optional: true,
    placeholder: "2026-08-01T18:00",
  },
  { key: "venue", label: "Venue", kind: "text", required: true },
  { key: "address", label: "Address", kind: "text", optional: true, wide: true },
  { key: "description", label: "Description", kind: "textarea", wide: true },
  {
    key: "category",
    label: "Category",
    kind: "select",
    required: true,
    options: EVENT_CATEGORIES.map((c) => ({ value: c, label: c })),
  },
  { key: "organizer", label: "Organizer", kind: "text", required: true },
  {
    key: "url",
    label: "Link (details / tickets)",
    kind: "text",
    optional: true,
    wide: true,
    placeholder: "https://…",
  },
  {
    key: "eventContact",
    label: "Public contact for this event",
    kind: "text",
    optional: true,
    wide: true,
    placeholder: "Jane Doe · jane@example.org",
    help: "Shown publicly so attendees ask the organizer, not the Chamber.",
  },
];
