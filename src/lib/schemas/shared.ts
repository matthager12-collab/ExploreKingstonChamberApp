// Shared building blocks for the per-domain content schemas (E07, vk/domain-schemas).
//
// One rule, one place: every regex, coercion, and operator-facing message that
// used to live twice — in the admin API's hand-written sanitizers AND the
// client editors' buildRecord functions — lives here now. The helpers
// deliberately reproduce the old coercion semantics (numeric strings convert,
// text trims, empty optionals end up ABSENT rather than "", stray keys strip)
// so swapping the sanitizers for these schemas changes no persisted bytes.
//
// Two deliberate behavior changes, documented in docs/SCHEMAS.md:
//   1. the admin form now enforces the server's numeric ranges client-side;
//   2. invalid optional URLs return a 400 with a friendly message instead of
//      being silently dropped (the old silent drop lost operator input).

import { z } from "zod";
import type { WeeklyHours } from "@/lib/types";

/** Record ids: 1–64 chars of [a-zA-Z0-9-], starting alphanumeric. */
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;
/** URL slugs: the id rule, lowercase only. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Old `str()` coercion: non-strings become "", strings trim. */
export function trimOrEmpty(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Old `num()` coercion: numbers pass, non-empty numeric strings convert, everything else NaN. */
export function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

export const idSchema = z.preprocess(
  trimOrEmpty,
  z.string().regex(ID_RE, "id required: letters, numbers, and dashes (max 64 chars)"),
);

/** Slugs lowercase on the way in, then follow the strict slug rule. */
export const slugSchema = z.preprocess(
  (v) => trimOrEmpty(v).toLowerCase(),
  z
    .string()
    .regex(SLUG_RE, "slug required: lowercase letters, numbers, and dashes (e.g. beach-day)"),
);

/** Required free text: trimmed, non-empty. */
export function requiredTrimmed(label: string) {
  return z.preprocess(trimOrEmpty, z.string().min(1, `${label} required`));
}

/** Free text that may be empty: trimmed, "" when missing (old `str()` fields). */
export function trimmedText() {
  return z.preprocess(trimOrEmpty, z.string());
}

/** Optional free text: trimmed; empty → undefined, so the key is absent once serialized. */
export function optionalTrimmed() {
  return z.preprocess((v) => trimOrEmpty(v) || undefined, z.string().optional());
}

const HTTP_RE = /^https?:\/\//;

/** Optional URL. Empty → omitted; a non-empty non-URL is a 400 (behavior change #2). */
export function httpUrlOptional(label: string) {
  return z.preprocess(
    (v) => trimOrEmpty(v) || undefined,
    z.string().regex(HTTP_RE, `${label} must be an http(s) URL`).optional(),
  );
}

/** Required URL; callers supply the full message (the old ones carry per-field hints). */
export function httpUrlRequired(message: string) {
  return z.preprocess(trimOrEmpty, z.string().regex(HTTP_RE, message));
}

/** Parity with the old server `strArray`: a non-array coerces to [] rather than
 *  erroring — both shipped clients always send arrays, so that path is only
 *  reachable by direct API calls, and rejecting it would be a third,
 *  undocumented behavior change. Non-string entries drop, strings trim,
 *  empties drop. */
export const tagsSchema = z.preprocess(
  (v) =>
    Array.isArray(v)
      ? v
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim())
          .filter(Boolean)
      : [],
  z.array(z.string()),
);

/** Rounded integer with bounds — parity with the old `Math.round(num(v))` checks. */
export function roundedInt(min: number, max: number, label: string) {
  const message = `${label} must be a number between ${min} and ${max}`;
  return z.preprocess(
    (v) => Math.round(toNumber(v)),
    z.number(message).min(min, message).max(max, message),
  );
}

/** Un-rounded number with bounds (lat/lng keep their decimals). */
export function numberInRange(label: string, min: number, max: number) {
  const message = `${label} must be between ${min} and ${max}`;
  return z.preprocess(toNumber, z.number(message).min(min, message).max(max, message));
}

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Strict WeeklyHours shape check, ported verbatim from the portal listing
 *  route: 7 day keys, ≤2 spans/day, "HH:mm" pairs, open ≠ close. Extra keys
 *  on the input object drop (the result is rebuilt from the 7 day keys). */
export function parseWeeklyHours(v: unknown): WeeklyHours | null {
  if (!v || typeof v !== "object") return null;
  const out = {} as WeeklyHours;
  for (const key of DAY_KEYS) {
    const day = (v as Record<string, unknown>)[key];
    if (!Array.isArray(day) || day.length > 2) return null;
    const spans: [string, string][] = [];
    for (const span of day) {
      if (!Array.isArray(span) || span.length !== 2) return null;
      const [open, close] = span as unknown[];
      if (typeof open !== "string" || typeof close !== "string") return null;
      if (!TIME_RE.test(open) || !TIME_RE.test(close) || open === close) return null;
      spans.push([open, close]);
    }
    out[key] = spans;
  }
  return out;
}

export const weeklyHoursSchema = z.any().transform((v, ctx): WeeklyHours => {
  const parsed = parseWeeklyHours(v);
  if (!parsed) {
    ctx.addIssue({ code: "custom", message: "weeklyHours is malformed" });
    return z.NEVER;
  }
  return parsed;
});

export const isoDateSchema = z.preprocess(
  trimOrEmpty,
  z.string().regex(ISO_DATE_RE, "must be a date in YYYY-MM-DD format"),
);

/** First issue as one plain-English string — the `{ error }` the admin UI shows. */
export function firstZodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid record";
}
