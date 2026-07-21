"use client";

// Reusable weekly-hours editor for the portals. Fully controlled: renders
// seven day rows (Mon..Sun) of open/close time spans and reports every change
// through onChange as a complete WeeklyHours object. Supports split shifts
// (up to two spans per day), past-midnight closes (close < open, per the
// DayHours convention in lib/types.ts), and one-click "copy Monday to
// weekdays" so nobody types the same hours five times.

import type { DayHours, WeeklyHours } from "@/lib/types";

const DAYS: { key: keyof WeeklyHours; label: string; full: string }[] = [
  { key: "mon", label: "Mon", full: "Monday" },
  { key: "tue", label: "Tue", full: "Tuesday" },
  { key: "wed", label: "Wed", full: "Wednesday" },
  { key: "thu", label: "Thu", full: "Thursday" },
  { key: "fri", label: "Fri", full: "Friday" },
  { key: "sat", label: "Sat", full: "Saturday" },
  { key: "sun", label: "Sun", full: "Sunday" },
];

const DEFAULT_SPAN: [string, string] = ["11:00", "20:00"];
const DEFAULT_SECOND_SPAN: [string, string] = ["17:00", "21:00"];

export function emptyWeeklyHours(): WeeklyHours {
  return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
}

function copySpans(spans: DayHours): DayHours {
  return spans.map(([open, close]) => [open, close] as [string, string]);
}

/**
 * Blocking problems only (missing or open===close). A close earlier than its
 * open is NOT an issue — that's the past-midnight convention.
 */
export function weeklyHoursIssues(weekly: WeeklyHours): string[] {
  const issues: string[] = [];
  for (const day of DAYS) {
    for (const [open, close] of weekly[day.key] ?? []) {
      if (!open || !close) {
        issues.push(`${day.full}: set both an open and a close time`);
      } else if (open === close) {
        issues.push(`${day.full}: open and close can't be the same time`);
      }
    }
  }
  return issues;
}

const timeInputClass =
  "rounded-lg border border-sand bg-white px-2 py-1.5 text-sm text-ink focus:border-tide focus:outline-none";

export function HoursEditor({
  value,
  onChange,
}: {
  value: WeeklyHours;
  onChange: (weekly: WeeklyHours) => void;
}) {
  function setDay(key: keyof WeeklyHours, spans: DayHours) {
    onChange({ ...value, [key]: spans });
  }

  function toggleDay(key: keyof WeeklyHours) {
    if ((value[key] ?? []).length > 0) {
      setDay(key, []);
      return;
    }
    // Opening a closed day: borrow the nearest earlier open day so the
    // defaults are usually already right.
    const index = DAYS.findIndex((d) => d.key === key);
    for (let i = index - 1; i >= 0; i--) {
      const donor = value[DAYS[i].key] ?? [];
      if (donor.length > 0) {
        setDay(key, copySpans(donor));
        return;
      }
    }
    setDay(key, [copySpans([DEFAULT_SPAN])[0]]);
  }

  function setTime(key: keyof WeeklyHours, spanIdx: number, pos: 0 | 1, time: string) {
    const spans = copySpans(value[key] ?? []);
    if (!spans[spanIdx]) return;
    spans[spanIdx][pos] = time;
    setDay(key, spans);
  }

  function addSpan(key: keyof WeeklyHours) {
    const spans = copySpans(value[key] ?? []);
    if (spans.length >= 2) return;
    spans.push([...DEFAULT_SECOND_SPAN]);
    setDay(key, spans);
  }

  function removeSpan(key: keyof WeeklyHours, spanIdx: number) {
    const spans = copySpans(value[key] ?? []).filter((_, i) => i !== spanIdx);
    setDay(key, spans);
  }

  function copyMondayToWeekdays() {
    const monday = copySpans(value.mon ?? []);
    onChange({
      ...value,
      tue: copySpans(monday),
      wed: copySpans(monday),
      thu: copySpans(monday),
      fri: copySpans(monday),
    });
  }

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-sand bg-white">
        {DAYS.map((day, i) => {
          const spans = value[day.key] ?? [];
          const isOpen = spans.length > 0;
          return (
            <div
              key={day.key}
              className={`flex flex-col gap-2 px-4 py-3 sm:flex-row ${i > 0 ? "border-t border-sand" : ""} ${isOpen ? "" : "bg-shell/50"}`}
            >
              <label className="flex w-32 shrink-0 cursor-pointer items-center gap-2 pt-1 select-none">
                <input
                  type="checkbox"
                  checked={isOpen}
                  onChange={() => toggleDay(day.key)}
                  className="h-4 w-4 accent-tide-deep"
                  aria-label={`${day.full} open`}
                />
                <span className={`font-semibold ${isOpen ? "text-sound-deep" : "text-ink-soft"}`}>
                  {day.label}
                </span>
              </label>

              {!isOpen ? (
                <p className="pt-1 text-sm text-ink-soft italic">Closed</p>
              ) : (
                <div className="flex flex-1 flex-col gap-2">
                  {spans.map(([open, close], spanIdx) => {
                    const bothSet = Boolean(open && close);
                    const sameTime = bothSet && open === close;
                    const pastMidnight = bothSet && close < open;
                    // E14: the coral text below was visible-only. These ids tie
                    // it to the two controls it is about, so a screen-reader
                    // user tabbing the day rows learns which span is invalid.
                    // (!bothSet and sameTime are mutually exclusive, so at most
                    // one element ever carries `errorId`.)
                    const prefix = `hours-${day.key}-${spanIdx}`;
                    const invalid = !bothSet || sameTime;
                    const errorId = invalid ? `${prefix}-error` : undefined;
                    const closeDescribedBy =
                      [errorId, pastMidnight ? `${prefix}-note` : null].filter(Boolean).join(" ") ||
                      undefined;
                    return (
                      <div key={spanIdx} className="flex flex-wrap items-center gap-2">
                        <input
                          type="time"
                          value={open}
                          onChange={(e) => setTime(day.key, spanIdx, 0, e.target.value)}
                          className={timeInputClass}
                          aria-label={`${day.full} span ${spanIdx + 1} opens`}
                          aria-invalid={invalid || undefined}
                          aria-describedby={errorId}
                        />
                        <span className="text-sm text-ink-soft">to</span>
                        <input
                          type="time"
                          value={close}
                          onChange={(e) => setTime(day.key, spanIdx, 1, e.target.value)}
                          className={timeInputClass}
                          aria-label={`${day.full} span ${spanIdx + 1} closes`}
                          aria-invalid={invalid || undefined}
                          aria-describedby={closeDescribedBy}
                        />
                        {spans.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeSpan(day.key, spanIdx)}
                            className="rounded-full px-2 py-0.5 text-sm font-semibold text-ink-soft hover:bg-sand hover:text-ink"
                            aria-label={`Remove ${day.full} span ${spanIdx + 1}`}
                          >
                            ×
                          </button>
                        )}
                        {!bothSet && (
                          <span id={errorId} className="text-xs font-medium text-coral-deep">
                            set both times
                          </span>
                        )}
                        {sameTime && (
                          <span id={errorId} className="text-xs font-medium text-coral-deep">
                            open and close can&apos;t match
                          </span>
                        )}
                        {pastMidnight && (
                          <span
                            id={`${prefix}-note`}
                            className="rounded-full bg-tide/10 px-2 py-0.5 text-xs font-medium text-tide-deep"
                          >
                            past midnight — closes the next morning
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {spans.length === 1 && (
                    <button
                      type="button"
                      onClick={() => addSpan(day.key)}
                      className="self-start text-xs font-medium text-tide-deep underline underline-offset-2 hover:text-sound"
                    >
                      + add a second span (split shift)
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={copyMondayToWeekdays}
        disabled={(value.mon ?? []).length === 0}
        className="mt-3 rounded-full border border-sand px-4 py-1.5 text-sm font-medium text-ink hover:border-tide disabled:opacity-40"
      >
        Copy Monday to all weekdays
      </button>
    </div>
  );
}
