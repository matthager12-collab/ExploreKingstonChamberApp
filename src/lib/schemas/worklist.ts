// E08 worklist payload schemas — the queue-item side of the moderation floor.
//
// This module is deliberately NOT a content-domain schema and is NOT
// registered in DOMAIN_SCHEMAS: worklist items are operational queue rows
// (subject pointer + per-type payload), not editable content documents
// (docs/SCHEMAS.md draws that boundary). It lives here so both the API
// routes and the admin worklist UI validate with the same objects, per the
// E07 single-schema rule.
//
// The five payload shapes below are the contract the five consumers share.
// `sync_conflict` (producer E16) and `privacy_request` (producer E11) are
// schema + fixtures only in E08 — changing their shape later means updating
// those epics' producers, nothing here.

import { z } from "zod";

/** The five queue consumers. */
export const WORKLIST_TYPES = [
  "moderation",
  "sync_conflict",
  "staleness",
  "report_inaccurate",
  "privacy_request",
] as const;
export type WorklistType = (typeof WORKLIST_TYPES)[number];

/** Item lifecycle. At most ONE open/in_progress item exists per
 *  (type, subject) — enforced by a partial unique index in the DB. */
export const WORKLIST_STATES = [
  "open",
  "in_progress",
  "resolved",
  "dismissed",
] as const;
export type WorklistState = (typeof WORKLIST_STATES)[number];

/** ISO timestamp string (payloads are written by our own code, so strict). */
const isoDateTime = z.iso.datetime({ offset: true });

/** A proposed domain record riding inside a moderation payload. Shape rules
 *  belong to the store write-gate (validateRecord / STORE_SCHEMAS) and are
 *  re-checked at approval time — here we only require an id so the payload
 *  can be routed. */
const proposedRecord = z.looseObject({
  id: z.string().min(1, "proposed record needs an id"),
});

/** moderation — a member/public submission held for Chamber review.
 *  kind 'edit' carries the FULL proposed record in the payload; the live
 *  content record is never touched until approval. kind 'new' points at a
 *  status='pending' record already in the content store. kind 'takedown'
 *  records an admin pulling a live record pending re-review. */
export const moderationPayloadSchema = z
  .object({
    kind: z.enum(["new", "edit", "takedown"], { message: "unknown moderation kind" }),
    proposed: proposedRecord.optional(),
    submitterUserId: z.string().min(1).optional(),
    note: z.string().max(2000).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.kind === "edit" && !val.proposed) {
      ctx.addIssue({
        code: "custom",
        message: "an edit needs the proposed record in the payload",
        path: ["proposed"],
      });
    }
  });

/** sync_conflict — AMS sync found a field-level disagreement (shape agreed
 *  for E16; fixtures only in E08). */
export const syncConflictPayloadSchema = z.object({
  fields: z
    .array(
      z.object({
        name: z.string().min(1),
        localValue: z.unknown(),
        remoteValue: z.unknown(),
      }),
    )
    .min(1, "a sync conflict needs at least one disputed field"),
  remoteFetchedAt: isoDateTime,
});

/** staleness — a record's verify-by window has lapsed. */
export const stalenessPayloadSchema = z.object({
  lastVerifiedAt: isoDateTime.nullable(),
  intervalDays: z.number().int().positive(),
});

/** report_inaccurate — public "something is wrong here" feedback.
 *  PRIVACY INVARIANT (M-15-06): a message and an OPTIONAL free-text contact,
 *  nothing else — no location, no required identity. A schema test asserts
 *  this shape never grows lat/lng or a required contact/email field. */
export const reportInaccuratePayloadSchema = z.object({
  messages: z
    .array(
      z.object({
        message: z.string().min(1, "say what looks wrong").max(2000),
        contact: z.string().max(200).optional(),
        at: isoDateTime,
      }),
    )
    .min(1),
  count: z.number().int().min(1),
});

/** privacy_request — access/delete/records request (E11). Contact is required:
 *  there is no account to reply through. `records` is the FR-A92 public-records
 *  intake — humans fulfill it (retention/legal-hold reconciliation), so it
 *  shares the shape but not the automated access/delete tooling. The kind lives
 *  in the jsonb payload, so adding it here needs NO migration (the DB CHECK
 *  constraints cover type + state only). */
export const privacyRequestPayloadSchema = z.object({
  requestKind: z.enum(["access", "delete", "records"], { message: "unknown request kind" }),
  contact: z.string().min(1, "a way to reach you is required").max(200),
  scopeNote: z.string().max(2000).optional(),
});

export const WORKLIST_PAYLOAD_SCHEMAS: Record<WorklistType, z.ZodType> = {
  moderation: moderationPayloadSchema,
  sync_conflict: syncConflictPayloadSchema,
  staleness: stalenessPayloadSchema,
  report_inaccurate: reportInaccuratePayloadSchema,
  privacy_request: privacyRequestPayloadSchema,
};

/** Closed per-type resolution vocabularies. `dismissed` state (no resolution)
 *  is always available besides these. */
export const WORKLIST_RESOLUTIONS = {
  moderation: ["approved", "rejected", "taken_down"],
  sync_conflict: ["kept_local", "took_remote", "merged"],
  staleness: ["verified", "archived"],
  report_inaccurate: ["fixed", "dismissed"],
  privacy_request: ["fulfilled", "declined"],
} as const satisfies Record<WorklistType, readonly string[]>;

export type WorklistResolution = (typeof WORKLIST_RESOLUTIONS)[WorklistType][number];

export class WorklistValidationError extends Error {
  constructor(
    public readonly itemType: string,
    public readonly issues: z.ZodError["issues"],
  ) {
    super(
      `Invalid ${itemType} worklist payload: ` +
        issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
    );
    this.name = "WorklistValidationError";
  }
}

/** Parse a payload against its type's schema. Returns the canonical parsed
 *  value; throws WorklistValidationError (routes translate to 400). */
export function validateWorklistPayload(
  type: WorklistType,
  payload: unknown,
): Record<string, unknown> {
  const parsed = WORKLIST_PAYLOAD_SCHEMAS[type].safeParse(payload);
  if (!parsed.success) throw new WorklistValidationError(type, parsed.error.issues);
  return parsed.data as Record<string, unknown>;
}

/** Wire shape of a full worklist item as the admin API serves it (timestamps
 *  as ISO strings). The DB row type is WorklistItemRow in src/lib/db. */
export const worklistItemWireSchema = z.object({
  id: z.string().min(1),
  type: z.enum(WORKLIST_TYPES),
  subjectStore: z.string().min(1),
  subjectId: z.string().min(1),
  subjectLabel: z.string().min(1),
  state: z.enum(WORKLIST_STATES),
  assigneeUserId: z.string().nullable(),
  dueAt: isoDateTime.nullable(),
  payload: z.record(z.string(), z.unknown()),
  resolution: z.string().nullable(),
  resolutionNote: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  createdBy: z.string().nullable(),
  resolvedAt: isoDateTime.nullable(),
  resolvedBy: z.string().nullable(),
});
export type WorklistItemWire = z.infer<typeof worklistItemWireSchema>;
