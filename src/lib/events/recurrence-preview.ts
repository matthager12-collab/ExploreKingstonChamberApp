// "Show me the next few dates" — the one thing that makes a repeat form
// usable by someone who does not think in RRULEs.
//
// Split out of recurrence.ts so that module stays dependency-light enough for
// the event schema to import (see the note at the top of recurrence.ts). This
// file is where the `rrule` package enters, via the real expander.
//
// It calls expandEvents rather than reimplementing anything: a preview that
// computes dates its own way is a preview that can lie, and the case it would
// lie about first is DST — "every Saturday 9am" across the November flip is
// exactly the thing rrule-expand exists to get right.

import { expandEvents, MAX_OCCURRENCES_PER_SERIES } from "./rrule-expand";
import { pacificDateKey } from "./tz";
import type { NormalizedEvent } from "./types";

/** How far ahead to look. A year shows a monthly series meaningfully; the
 *  per-series cap in rrule-expand still bounds the work. */
const PREVIEW_WINDOW_DAYS = 365;

/**
 * The next `count` Pacific dates a rule produces, exdates already removed.
 * A null rule previews as the single start date.
 *
 * `now` is injected so the caller (and the tests) control the clock.
 */
export function previewOccurrences(
  rrule: string | null,
  startIso: string,
  exdates: string[] = [],
  count = 6,
  now: Date = new Date(),
): string[] {
  if (!rrule) return [pacificDateKey(startIso)];

  const series: NormalizedEvent = {
    title: "preview",
    startIso,
    allDay: false,
    venue: "",
    description: "",
    source: "in-app",
    externalId: "preview",
    occurrenceKey: `in-app:preview:${startIso}`,
    rrule,
    exdates,
  };

  // Window opens at the earlier of "now" and the series start, so previewing a
  // series that begins next month still shows its first date.
  const { events } = expandEvents([series], {
    windowStart: new Date(Math.min(now.getTime(), new Date(startIso).getTime())),
    windowEnd: new Date(now.getTime() + PREVIEW_WINDOW_DAYS * 86_400_000),
  });

  return events
    .slice(0, Math.min(count, MAX_OCCURRENCES_PER_SERIES))
    .map((e) => pacificDateKey(e.startIso));
}
