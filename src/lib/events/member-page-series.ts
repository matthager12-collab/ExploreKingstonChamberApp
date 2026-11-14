// Turns the model's description of a repeating event into a preset rule and
// its first occurrence. Pure and clock-free: the caller passes today.
//
// The model only NAMES the pattern (weekday, ordinal). It never supplies the
// RRULE or the first date: the rule goes through presetToRRule +
// isPresetRRule, and the date is computed here from today.

import { WEEKDAYS, isPresetRRule, presetToRRule, type Ordinal, type RepeatPreset, type Weekday } from "./recurrence";

export interface ModelRepeat {
  kind: string;
  weekday: string;
  ordinal: string;
  /** The model's own date; only monthly-date reads it (day of month). */
  date: string;
}

export interface Series {
  rrule: string;
  /** First occurrence on or after today, YYYY-MM-DD. */
  date: string;
}

const MS_DAY = 86_400_000;
const ORDINALS: Record<string, Ordinal> = { "1": 1, "2": 2, "3": 3, "4": 4, "-1": -1 };

/** Days since the epoch for a real calendar date, else null (rejects 2026-02-31). */
export function dayNumber(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t / MS_DAY;
}

const iso = (n: number) => new Date(n * MS_DAY).toISOString().slice(0, 10);
/** JS weekday of a Weekday code: 0 = Sunday. */
const dow = (w: Weekday) => (WEEKDAYS.indexOf(w) + 1) % 7;
const daysIn = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

/** The Nth (or last, -1) weekday of a month, as a day number. */
function nthWeekday(y: number, mo: number, ord: Ordinal, w: Weekday): number {
  if (ord === -1) {
    const last = Date.UTC(y, mo - 1, daysIn(y, mo)) / MS_DAY;
    return last - ((new Date(last * MS_DAY).getUTCDay() - dow(w) + 7) % 7);
  }
  const first = Date.UTC(y, mo - 1, 1) / MS_DAY;
  return first + ((dow(w) - new Date(first * MS_DAY).getUTCDay() + 7) % 7) + (ord - 1) * 7;
}

/** First month-based occurrence on/after today; `pick` returns a day number or null for a month. */
function firstMonthly(todayN: number, pick: (y: number, mo: number) => number | null): number | null {
  const t = new Date(todayN * MS_DAY);
  for (let i = 0; i < 14; i++) {
    const idx = t.getUTCMonth() + i;
    const n = pick(t.getUTCFullYear() + Math.floor(idx / 12), (idx % 12) + 1);
    if (n !== null && n >= todayN) return n;
  }
  return null;
}

/** Null means "drop this item": unknown shape, missing fields, or not a preset. */
export function buildSeries(r: ModelRepeat, today: string): Series | null {
  const todayN = dayNumber(today);
  if (todayN === null) return null;
  const weekday = (WEEKDAYS as readonly string[]).includes(r.weekday) ? (r.weekday as Weekday) : null;
  let preset: RepeatPreset;
  let first: number | null;

  if (r.kind === "weekly" || r.kind === "biweekly") {
    if (!weekday) return null;
    preset = { kind: "weekly", interval: r.kind === "weekly" ? 1 : 2, weekdays: [weekday] };
    first = todayN + ((dow(weekday) - new Date(todayN * MS_DAY).getUTCDay() + 7) % 7);
  } else if (r.kind === "monthly-weekday") {
    const ordinal = ORDINALS[r.ordinal];
    if (!weekday || !ordinal) return null;
    preset = { kind: "monthly-weekday", ordinal, weekday };
    first = firstMonthly(todayN, (y, mo) => nthWeekday(y, mo, ordinal, weekday));
  } else if (r.kind === "monthly-date") {
    const modelN = dayNumber(r.date);
    if (modelN === null) return null;
    const day = new Date(modelN * MS_DAY).getUTCDate();
    preset = { kind: "monthly-date" };
    // A month too short for the day is skipped, which is what the rrule does too.
    first = firstMonthly(todayN, (y, mo) => (day <= daysIn(y, mo) ? Date.UTC(y, mo - 1, day) / MS_DAY : null));
  } else {
    return null;
  }

  const rrule = presetToRRule(preset);
  if (!rrule || !isPresetRRule(rrule) || first === null) return null;
  return { rrule, date: iso(first) };
}
