// E27 — verified place-level access facts (the M-14-05 APP slice).
//
// Declared ONCE here and spread into each place domain's schema + field list,
// so the admin editor field and the API validation both inherit from this one
// definition (E07's no-duplicate-sanitizer rule). Adding access facts to a new
// domain is `...accessFactsShape` plus `...accessFactsFields`.
//
// SHAPE NOTE: these are flat, prefixed fields rather than a nested
// `accessFacts: {...}` object. The E07 form engine renders flat FieldDefs only
// (text/textarea/number/select/checkbox/csv-tags) — a nested object would have
// been invisible to the admin editor, which would defeat the entire point of
// making these Chamber-editable. `readAccessFacts()` below re-assembles them
// into one object for display.
//
// HONESTY NOTE: every field defaults to absent/"unknown". The app asserts an
// access fact only when the Chamber has actually recorded one — a listing with
// no data says "not verified yet", never "accessible". Getting this backwards
// strands someone at a door they cannot get through.
//
// Out of scope here, by charter: the venue-audit PROGRAM that produces verified
// facts (who visits venues, how often). That is deferred in BACKLOG.md.

import { z } from "zod";
import type { FieldDef } from "./form";
import { isoDateSchema, optionalTrimmed, trimOrEmpty } from "./shared";

/** Deliberately four-valued: "partial" and "unknown" are different facts, and
 *  collapsing them into a boolean is how a half-accessible venue gets
 *  advertised as fully accessible. */
export const ACCESS_ANSWERS = ["yes", "no", "partial", "unknown"] as const;
export type AccessAnswer = (typeof ACCESS_ANSWERS)[number];

/** Visitor-facing wording per answer. Text, never colour alone. */
export const ACCESS_ANSWER_LABELS: Record<AccessAnswer, string> = {
  yes: "Yes",
  no: "No",
  partial: "Partly",
  unknown: "Not checked",
};

const answer = () =>
  z
    .preprocess(
      (v) => {
        const s = trimOrEmpty(v);
        return s === "" ? "unknown" : s;
      },
      z.enum(ACCESS_ANSWERS, `must be one of: ${ACCESS_ANSWERS.join(", ")}`),
    )
    .optional();

/** Spread into a place domain's z.object({...}). */
export const accessFactsShape = {
  stepFreeEntrance: answer(),
  accessibleRestroom: answer(),
  accessibleParking: answer(),
  accessNotes: optionalTrimmed(),
  /** ISO date the Chamber last checked these facts in person. */
  accessVerifiedOn: isoDateSchema.optional(),
  /** Who/what the facts came from, e.g. "Chamber walk-through, July 2026". */
  accessSource: optionalTrimmed(),
};

const ANSWER_OPTIONS = ACCESS_ANSWERS.map((v) => ({
  value: v,
  label: ACCESS_ANSWER_LABELS[v],
}));

/** Spread into a place domain's FieldDef[]. */
export const accessFactsFields: FieldDef[] = [
  {
    key: "stepFreeEntrance",
    label: "Step-free entrance",
    kind: "select",
    defaultValue: "unknown",
    options: ANSWER_OPTIONS,
    help: "Leave as “Not checked” unless someone has actually verified it.",
  },
  {
    key: "accessibleRestroom",
    label: "Accessible restroom",
    kind: "select",
    defaultValue: "unknown",
    options: ANSWER_OPTIONS,
  },
  {
    key: "accessibleParking",
    label: "Accessible parking",
    kind: "select",
    defaultValue: "unknown",
    options: ANSWER_OPTIONS,
  },
  {
    key: "accessNotes",
    label: "Access notes (optional)",
    kind: "textarea",
    optional: true,
    wide: true,
    placeholder: "e.g. Ramp at the side door on Washington Blvd; two steps at the front.",
  },
  {
    key: "accessVerifiedOn",
    label: "Access facts verified on (YYYY-MM-DD, optional)",
    kind: "text",
    optional: true,
    placeholder: "2026-07-21",
    help: "Shown to visitors as the freshness date. Leave blank if nobody has checked.",
  },
  {
    key: "accessSource",
    label: "Access facts source (optional)",
    kind: "text",
    optional: true,
    placeholder: "Chamber walk-through",
  },
];

/** The display-side view of the facts. */
export interface AccessFacts {
  stepFreeEntrance?: AccessAnswer;
  accessibleRestroom?: AccessAnswer;
  accessibleParking?: AccessAnswer;
  accessNotes?: string;
  accessVerifiedOn?: string;
  accessSource?: string;
}

function asAnswer(v: unknown): AccessAnswer | undefined {
  return typeof v === "string" && (ACCESS_ANSWERS as readonly string[]).includes(v)
    ? (v as AccessAnswer)
    : undefined;
}

function asText(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * Pull access facts off any place record, defensively.
 *
 * Reads from an unknown-shaped record on purpose: the fields live in the zod
 * schema and the stored document, and the interfaces in src/lib/types.ts are
 * ask-first to modify (E07 charter). Reading defensively keeps this epic out of
 * that file while staying type-safe at the call site.
 *
 * Returns null when the record asserts NOTHING — so a caller can render no
 * access block at all rather than a row of "Not checked".
 */
export function readAccessFacts(record: unknown): AccessFacts | null {
  if (!record || typeof record !== "object") return null;
  const r = record as Record<string, unknown>;
  const facts: AccessFacts = {
    stepFreeEntrance: asAnswer(r.stepFreeEntrance),
    accessibleRestroom: asAnswer(r.accessibleRestroom),
    accessibleParking: asAnswer(r.accessibleParking),
    accessNotes: asText(r.accessNotes),
    accessVerifiedOn: asText(r.accessVerifiedOn),
    accessSource: asText(r.accessSource),
  };
  return hasAnyAccessFact(facts) ? facts : null;
}

/** True when at least one fact says something beyond "unknown". */
export function hasAnyAccessFact(f: AccessFacts): boolean {
  const answered = [f.stepFreeEntrance, f.accessibleRestroom, f.accessibleParking].some(
    (a) => a !== undefined && a !== "unknown",
  );
  return answered || Boolean(f.accessNotes);
}
