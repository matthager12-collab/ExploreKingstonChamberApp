// The pure half of the schema-driven record editor: record → draft → record.
//
// SPLIT OUT OF record-editor.tsx so it can be tested without rendering a
// component. The repo's own rule (src/lib/privacy/consent.ts states it): logic
// that matters must not be trapped inside a component, because the test
// harness has no jsdom. What matters here is that a save cannot silently lose
// stored data — see `carried` on Draft.

import type { DomainDef, FieldDef, GenericRecord } from "@/lib/schemas/form";

/** The repeat control spans TWO record keys (`rrule` + `exdates`) while the
 *  draft model holds one value per field, so its draft value is the pair as
 *  JSON. Parsing and re-emitting both live here, next to the code that decides
 *  what reaches the record. */
export interface RepeatDraftValue {
  rrule?: string;
  exdates?: string[];
}

export const REPEAT_RECORD_KEYS = ["rrule", "exdates"] as const;

export function parseRepeatDraft(raw: unknown): RepeatDraftValue {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as RepeatDraftValue;
    const rrule = typeof parsed.rrule === "string" && parsed.rrule ? parsed.rrule : undefined;
    const exdates = Array.isArray(parsed.exdates)
      ? parsed.exdates.filter((x): x is string => typeof x === "string" && Boolean(x))
      : undefined;
    // Skipped dates without a rule to subtract from are meaningless, and
    // keeping them would let serialize/parse disagree: serialize already drops
    // the whole value when there is no rule.
    if (!rrule) return {};
    return { rrule, ...(exdates && exdates.length > 0 ? { exdates } : {}) };
  } catch {
    return {};
  }
}

export function serializeRepeatDraft(value: RepeatDraftValue): string {
  return value.rrule ? JSON.stringify(value) : "";
}

/** Record field → editable string/boolean per the field kind. */
export function toDraftValue(field: FieldDef, value: unknown): string | boolean {
  if (field.kind === "checkbox") return Boolean(value);
  if (field.kind === "csv-tags" || field.kind === "photos") {
    return Array.isArray(value) ? (value as unknown[]).map(String).join(", ") : "";
  }
  if (value == null) return field.defaultValue ?? "";
  return String(value);
}

export type Draft = {
  domain: string;
  id: string;
  idTouched: boolean;
  isNew: boolean;
  values: Record<string, string | boolean>;
  /** Stored keys this form does not render, carried through a save untouched.
   *
   *  A form can only express what it shows. Rebuilding the record from the
   *  field list alone means every key the domain gained without also gaining a
   *  control is silently deleted the next time an admin presses Save — which
   *  is how an event's repeat rule would vanish because someone fixed a typo
   *  in its title. Clearing a rendered field still clears it; that is the
   *  form speaking. Dropping an unrendered one is the form guessing. */
  carried: Record<string, unknown>;
};

export function recordToDraft(domain: DomainDef, record: GenericRecord): Draft {
  const values: Record<string, string | boolean> = {};
  for (const f of domain.fields) {
    // The repeat control reads two keys, so it is seeded from the record
    // rather than from record[f.key] alone.
    values[f.key] =
      f.kind === "repeat"
        ? serializeRepeatDraft({
            rrule: typeof record.rrule === "string" ? record.rrule : undefined,
            exdates: Array.isArray(record.exdates)
              ? (record.exdates as unknown[]).map(String)
              : undefined,
          })
        : toDraftValue(f, record[f.key]);
  }
  const rendered = new Set(domain.fields.map((f) => f.key));
  // Both of the repeat control's keys count as rendered, or `exdates` would be
  // carried through as untouched data AND written by the control.
  if (domain.fields.some((f) => f.kind === "repeat")) {
    for (const key of REPEAT_RECORD_KEYS) rendered.add(key);
  }
  const carried: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key !== "id" && !rendered.has(key)) carried[key] = value;
  }
  return { domain: domain.key, id: record.id, idTouched: true, isNew: false, values, carried };
}

export function newRecordDraft(domain: DomainDef): Draft {
  const values: Record<string, string | boolean> = {};
  for (const f of domain.fields) {
    values[f.key] = f.kind === "checkbox" ? false : (f.defaultValue ?? "");
  }
  return { domain: domain.key, id: "", idTouched: false, isNew: true, values, carried: {} };
}

/** The id control is synthesised by the editor rather than declared by the
 *  domain, so it needs a reserved key for the id/aria-describedby plumbing. */
export const ID_FIELD_KEY = "id";

export type BuildResult =
  | { ok: true; record: GenericRecord }
  /** `fieldKey` is "" when the failure can't be pinned to one control. */
  | { ok: false; fieldKey: string; text: string };

/** Draft → validated record via the domain schema. Returns the parsed record
 *  (canonical: trimmed strings, coerced numbers, empty optionals omitted) or
 *  the offending field plus its message. The schema is the same object the API
 *  route parses with, so the form now surfaces every server rule — numeric
 *  ranges included — before the round-trip.
 *
 *  E14: the failure keeps its `fieldKey` instead of collapsing to a flat
 *  string, so the editor can mark that control `aria-invalid`, describe it with
 *  the message, and move focus there. */
export function buildRecord(domain: DomainDef, draft: Draft): BuildResult {
  const id = draft.id.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(id)) {
    return {
      ok: false,
      fieldKey: ID_FIELD_KEY,
      text: "Id is required: letters, numbers, and dashes (e.g. point-casino-hotel).",
    };
  }
  // Unrendered keys first, so a rendered field always wins the collision.
  const record: GenericRecord = { ...draft.carried, id };
  for (const f of domain.fields) {
    const raw = draft.values[f.key];
    if (f.kind === "checkbox") {
      record[f.key] = Boolean(raw);
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (f.kind === "repeat") {
      const repeat = parseRepeatDraft(text);
      // Assign or DELETE, never just assign: `carried` may hold the previously
      // stored rule, and clearing the repeat has to actually clear it.
      if (repeat.rrule) record.rrule = repeat.rrule;
      else delete record.rrule;
      if (repeat.exdates?.length) record.exdates = repeat.exdates;
      else delete record.exdates;
      continue;
    }
    if (f.kind === "csv-tags" || f.kind === "photos") {
      record[f.key] = text
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    } else if (f.kind === "number") {
      // Pass the text through only when present — the schema coerces numeric
      // strings; an empty required number then fails with its range message.
      if (text !== "") record[f.key] = text;
    } else {
      record[f.key] = text;
    }
  }
  const parsed = domain.schema.safeParse(record);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const fieldKey = typeof issue?.path[0] === "string" ? issue.path[0] : "";
    const field = domain.fields.find((f) => f.key === fieldKey);
    const message = issue?.message ?? `Could not validate the ${domain.noun}.`;
    return {
      ok: false,
      fieldKey: field ? fieldKey : "",
      text: field ? `${field.label}: ${message}` : message,
    };
  }
  return { ok: true, record: parsed.data as GenericRecord };
}
