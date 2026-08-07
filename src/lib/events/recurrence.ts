// Repeat presets for IN-APP events (admin + portal) — the pure translation
// layer between what a person picks in a form and the RRULE the calendar
// stores.
//
// SCOPE, and why it is a closed set rather than a full RRULE builder: these
// four shapes cover what a town calendar actually runs — a weekly market, a
// fortnightly club night, a monthly meeting on the same date, and "second
// Sunday" style series. A free-form RRULE field would be more expressive and
// far easier for a volunteer to get wrong, and every wrong rule publishes up
// to MAX_OCCURRENCES_PER_SERIES rows before anyone notices.
//
// NO RECURRENCE MATH HAPPENS HERE. Building rules is string assembly; every
// question about WHEN a rule actually falls goes through expandEvents in
// rrule-expand.ts, which is the one place allowed to do that (and the one
// place that gets the Pacific DST re-anchoring right). The form's date preview
// lives in recurrence-preview.ts, which calls that expander directly.
//
// DEPENDENCY-LIGHT ON PURPOSE: this module imports only ./tz, so the event
// SCHEMA can validate a stored rule against the preset set without dragging
// the `rrule` package into any bundle that carries a form. That is why the
// preview is a separate file rather than one more export here.

import { pacificDateKey, wallTimeToInstant } from "./tz";

/**
 * Upper bound on skipped dates one series may carry.
 *
 * Mirrors MAX_OCCURRENCES_PER_SERIES in rrule-expand.ts — a series cannot skip
 * more dates than it has. DUPLICATED rather than imported so this module (and
 * the event schema that imports it) stays clear of the `rrule` package; the
 * two constants are pinned together by a test in
 * tests/unit/events/recurrence.test.ts, which fails if either moves.
 */
export const MAX_SKIPPED_DATES = 62;

/** RRULE weekday codes, Monday-first as RFC 5545 writes them. */
export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

/** Which week of the month, RFC 5545 style — -1 is "the last one". */
export type Ordinal = 1 | 2 | 3 | 4 | -1;

export const ORDINAL_LABEL: Record<Ordinal, string> = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  [-1]: "last",
};

/**
 * What the form holds. `until` is a Pacific calendar date ("2026-09-07"), not
 * an instant — "runs through Labor Day" is how a person says it, and the
 * conversion to an RRULE UNTIL instant happens in one place below.
 */
export type RepeatPreset =
  | { kind: "none" }
  | { kind: "weekly"; interval: 1 | 2; weekdays: Weekday[]; until?: string }
  | { kind: "monthly-date"; until?: string }
  | { kind: "monthly-weekday"; ordinal: Ordinal; weekday: Weekday; until?: string };

/** The Pacific weekday a series starts on — the default selection when
 *  someone switches a one-off event to weekly. */
export function weekdayOf(startIso: string): Weekday {
  // pacificDateKey gives "YYYY-MM-DD" in Pacific; read the weekday off UTC noon
  // of that date so no timezone can shift it across a day boundary.
  const [y, m, d] = pacificDateKey(startIso).split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); // 0=Sun
  return WEEKDAYS[(dow + 6) % 7];
}

/** Pacific end-of-day for a "YYYY-MM-DD" → the RRULE UNTIL stamp (UTC basic).
 *  End of day, not midnight: "through September 7th" includes the 7th. */
function untilStamp(pacificDate: string): string | null {
  const parts = pacificDate.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  const instant = wallTimeToInstant("America/Los_Angeles", y, m, d, 23, 59, 59);
  return `${instant.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;
}

/** Preset → RRULE string, or null for "does not repeat".
 *
 *  MONTHLY-DATE emits no BYMONTHDAY and MONTHLY-WEEKDAY no BYMONTHDAY either:
 *  rrule takes the day-of-month from DTSTART, which expandEvents sets from the
 *  event's own start. One source for the anchor date, so editing the start
 *  moves the series with it. */
export function presetToRRule(preset: RepeatPreset): string | null {
  if (preset.kind === "none") return null;
  const parts: string[] = [];

  if (preset.kind === "weekly") {
    if (preset.weekdays.length === 0) return null;
    parts.push("FREQ=WEEKLY");
    if (preset.interval === 2) parts.push("INTERVAL=2");
    parts.push(`BYDAY=${[...preset.weekdays].sort(byWeekdayOrder).join(",")}`);
  } else if (preset.kind === "monthly-date") {
    parts.push("FREQ=MONTHLY");
  } else {
    parts.push("FREQ=MONTHLY");
    parts.push(`BYDAY=${preset.ordinal}${preset.weekday}`);
  }

  const until = preset.until ? untilStamp(preset.until) : null;
  if (until) parts.push(`UNTIL=${until}`);
  return parts.join(";");
}

function byWeekdayOrder(a: Weekday, b: Weekday): number {
  return WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b);
}

/**
 * RRULE string → preset, or null when the rule is outside the preset set.
 *
 * Null is not an error: an event ingested from a feed (or hand-written by an
 * earlier admin) may hold a rule the form cannot represent. The editor's job
 * is then to say so and leave the rule alone rather than silently rewrite it
 * into the nearest preset — which would change a published series.
 */
export function rruleToPreset(rrule: string | undefined): RepeatPreset | null {
  if (!rrule) return { kind: "none" };
  const parts = new Map<string, string>();
  for (const chunk of rrule.replace(/^RRULE:/i, "").split(";")) {
    const [k, v] = chunk.split("=");
    if (k && v) parts.set(k.toUpperCase(), v.toUpperCase());
  }
  // Anything the presets don't model (COUNT, BYMONTH, BYSETPOS, …) is out.
  for (const key of parts.keys()) {
    if (!["FREQ", "INTERVAL", "BYDAY", "UNTIL"].includes(key)) return null;
  }

  const freq = parts.get("FREQ");
  const interval = parts.get("INTERVAL") ?? "1";
  const byday = parts.get("BYDAY");
  const until = untilToPacificDate(parts.get("UNTIL"));

  if (freq === "WEEKLY") {
    if (interval !== "1" && interval !== "2") return null;
    if (!byday) return null;
    const weekdays: Weekday[] = [];
    for (const code of byday.split(",")) {
      if (!(WEEKDAYS as readonly string[]).includes(code)) return null; // ordinals are not weekly
      weekdays.push(code as Weekday);
    }
    return { kind: "weekly", interval: interval === "2" ? 2 : 1, weekdays, ...(until ? { until } : {}) };
  }

  if (freq === "MONTHLY") {
    if (interval !== "1") return null;
    if (!byday) return { kind: "monthly-date", ...(until ? { until } : {}) };
    const m = /^(-?\d)(MO|TU|WE|TH|FR|SA|SU)$/.exec(byday);
    if (!m) return null;
    const ordinal = Number(m[1]);
    if (![1, 2, 3, 4, -1].includes(ordinal)) return null;
    return {
      kind: "monthly-weekday",
      ordinal: ordinal as Ordinal,
      weekday: m[2] as Weekday,
      ...(until ? { until } : {}),
    };
  }

  return null;
}

/** RRULE UNTIL stamp → the Pacific calendar date a person would recognise. */
function untilToPacificDate(until: string | undefined): string | undefined {
  if (!until) return undefined;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(until);
  if (!m) return undefined;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}Z`;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? undefined : pacificDateKey(at.toISOString());
}

/** Plain-language summary for the form and the admin list. The string a
 *  volunteer checks their intent against — "Every 2 weeks on Saturday". */
export function describeRepeat(preset: RepeatPreset): string {
  if (preset.kind === "none") return "Does not repeat";

  let base: string;
  if (preset.kind === "weekly") {
    const days = [...preset.weekdays].sort(byWeekdayOrder).map((d) => WEEKDAY_LABEL[d]);
    const list =
      days.length <= 1
        ? (days[0] ?? "")
        : `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;
    base = preset.interval === 2 ? `Every 2 weeks on ${list}` : `Every week on ${list}`;
  } else if (preset.kind === "monthly-date") {
    base = "Every month on the same date";
  } else {
    base = `Every month on the ${ORDINAL_LABEL[preset.ordinal]} ${WEEKDAY_LABEL[preset.weekday]}`;
  }

  return preset.until ? `${base}, through ${preset.until}` : base;
}

/**
 * Is this stored rule one the presets can represent (and therefore one the
 * editor can round-trip)? The schema's gate on `rrule`.
 *
 * In-app events have never carried a rule, so there is no legacy shape to
 * grandfather in: rejecting everything outside the preset set is what keeps
 * "the form can always reopen what the form wrote" true.
 */
export function isPresetRRule(rrule: string): boolean {
  const preset = rruleToPreset(rrule);
  return preset !== null && preset.kind !== "none";
}
