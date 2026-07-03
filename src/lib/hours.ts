// Open/closed math for business hours, always in Kingston's timezone.
// Pure functions so they run identically on server and client; the live
// badge (components/open-badge.tsx) calls getOpenStatus in the browser.

import type { DayHours, WeeklyHours } from "./types";

const TZ = "America/Los_Angeles";
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
type DayKey = (typeof DAY_KEYS)[number];

const DAY_LABELS: Record<DayKey, string> = {
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
};

export interface OpenStatus {
  open: boolean;
  /** e.g. "Open · closes 8 pm" or "Closed · opens Fri 12 pm" */
  label: string;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** "20:00" -> "8 pm", "07:30" -> "7:30 am" */
function fmt(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12} ${suffix}` : `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Current weekday index (0=Sun) and minutes-since-midnight in Kingston. */
function nowInPacific(now: Date): { dayIndex: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { dayIndex, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** True when a span crosses midnight (close at or before open, e.g. 17:00–01:00). */
function crossesMidnight([open, close]: [string, string]): boolean {
  return toMinutes(close) <= toMinutes(open);
}

function spansForDay(weekly: WeeklyHours, dayIndex: number): DayHours {
  return weekly[DAY_KEYS[(dayIndex + 7) % 7]] ?? [];
}

export function getOpenStatus(weekly: WeeklyHours, now: Date = new Date()): OpenStatus {
  const { dayIndex, minutes } = nowInPacific(now);

  // Open via one of today's spans?
  for (const span of spansForDay(weekly, dayIndex)) {
    const [open, close] = span;
    if (crossesMidnight(span)) {
      if (minutes >= toMinutes(open)) {
        return { open: true, label: `Open · closes ${fmt(close)}` };
      }
    } else if (minutes >= toMinutes(open) && minutes < toMinutes(close)) {
      return { open: true, label: `Open · closes ${fmt(close)}` };
    }
  }

  // Open via yesterday's past-midnight tail?
  for (const span of spansForDay(weekly, dayIndex - 1)) {
    if (crossesMidnight(span) && minutes < toMinutes(span[1])) {
      return { open: true, label: `Open · closes ${fmt(span[1])}` };
    }
  }

  // Closed — find the next opening within a week.
  for (let ahead = 0; ahead < 7; ahead++) {
    const spans = spansForDay(weekly, dayIndex + ahead)
      .slice()
      .sort((a, b) => toMinutes(a[0]) - toMinutes(b[0]));
    for (const [open] of spans) {
      if (ahead === 0 && toMinutes(open) <= minutes) continue;
      const when =
        ahead === 0
          ? fmt(open)
          : ahead === 1
            ? `tomorrow ${fmt(open)}`
            : `${DAY_LABELS[DAY_KEYS[(dayIndex + ahead) % 7]]} ${fmt(open)}`;
      return { open: false, label: `Closed · opens ${when}` };
    }
  }

  return { open: false, label: "Closed" };
}
