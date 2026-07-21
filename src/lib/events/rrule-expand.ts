// Recurrence expansion (E12 pure core): the thin wrapper over the `rrule`
// package — the ONE place recurrence math happens (hand-rolling RRULE logic
// anywhere else is charter-forbidden).
//
// ── The DST trap this file exists for ─────────────────────────────────────
// `rrule` does naive UTC arithmetic and mishandles zoned datetimes: expanding
// "weekly at 18:30 Pacific" as real instants drifts an hour when DST flips.
// Strategy (per the epic): expand in FLOATING time — the series start's
// Pacific wall-clock components faked as UTC — then re-anchor every
// occurrence's wall time to America/Los_Angeles with the Intl helper. A
// weekly 18:30 event stays 18:30 local on both sides of 2026-11-01 (fall
// back) and 2027-03-14 (spring forward); the unit tests cross both.

import { RRule } from "rrule";
import { instantToWallTime, pacificDateKey, toUtcBasic, wallTimeToInstant } from "./tz";
import type { NormalizedEvent } from "./types";

const ZONE = "America/Los_Angeles";

/** Hard cap per series (epic constraint): a runaway RRULE (missing UNTIL or
 *  COUNT on a daily rule) may not flood the calendar. */
export const MAX_OCCURRENCES_PER_SERIES = 62;

export interface ExpandOptions {
  /** Window start/end as real instants; the epic's read path passes
   *  [today − 1 day, today + 180 days]. Pure: the caller supplies `now`. */
  windowStart: Date;
  windowEnd: Date;
}

export interface ExpandResult {
  events: NormalizedEvent[];
  warnings: string[];
}

/** Real instant → the same wall-clock reading faked as UTC (floating time). */
function toFloating(iso: string): Date {
  const w = instantToWallTime(ZONE, new Date(iso));
  return new Date(Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s));
}

/** Floating (faked-UTC) date → the real Pacific instant it denotes. */
function fromFloating(floating: Date): Date {
  return wallTimeToInstant(
    ZONE,
    floating.getUTCFullYear(),
    floating.getUTCMonth() + 1,
    floating.getUTCDate(),
    floating.getUTCHours(),
    floating.getUTCMinutes(),
    floating.getUTCSeconds(),
  );
}

function occurrenceKeyFor(e: NormalizedEvent, originalStartIso: string): string {
  return `${e.source}:${e.externalId}:${toUtcBasic(originalStartIso)}`;
}

/**
 * Expand every recurring series in `events` over the window; pass
 * non-recurring events through unchanged. RECURRENCE-ID override events
 * (same source+externalId as a series) replace the occurrence whose ORIGINAL
 * start matches their recurrenceId — and keep that occurrence's key, so an
 * override changing the time does not orphan admin dedupe verdicts. EXDATEs
 * remove occurrences. Orphan overrides (no series or no matching occurrence)
 * degrade to standalone events rather than vanishing.
 */
export function expandEvents(
  events: NormalizedEvent[],
  opts: ExpandOptions,
): ExpandResult {
  const warnings: string[] = [];
  const out: NormalizedEvent[] = [];

  // Overrides indexed by series identity, then by original-start instant (ms).
  const overrides = new Map<string, Map<number, NormalizedEvent>>();
  const consumedOverrides = new Set<NormalizedEvent>();
  for (const e of events) {
    if (!e.recurrenceId) continue;
    const seriesKey = `${e.source}:${e.externalId}`;
    const byStart = overrides.get(seriesKey) ?? new Map<number, NormalizedEvent>();
    byStart.set(new Date(e.recurrenceId).getTime(), e);
    overrides.set(seriesKey, byStart);
  }

  for (const e of events) {
    if (e.recurrenceId) continue; // emitted (or degraded) via its series below

    if (!e.rrule) {
      out.push({ ...e, occurrenceKey: e.occurrenceKey || occurrenceKeyFor(e, e.startIso) });
      continue;
    }

    // ---- recurring series ----
    let rule: RRule;
    try {
      const parsed = RRule.parseString(e.rrule);
      // UNTIL arrives as a real instant; re-anchor it into floating time so
      // every comparison inside rrule happens in one (wall-clock) frame.
      if (parsed.until) parsed.until = toFloating(parsed.until.toISOString());
      rule = new RRule({ ...parsed, dtstart: toFloating(e.startIso) });
    } catch (err) {
      warnings.push(
        `${e.source}:${e.externalId}: unparseable RRULE "${e.rrule}" (${String(
          (err as Error)?.message ?? err,
        )}) — kept as a single event`,
      );
      const { rrule: _rrule, exdates: _exdates, ...single } = e;
      out.push({ ...single, occurrenceKey: e.occurrenceKey || occurrenceKeyFor(e, e.startIso) });
      continue;
    }

    const floatingOccs = rule
      .between(toFloating(opts.windowStart.toISOString()), toFloating(opts.windowEnd.toISOString()), true)
      .slice(0, MAX_OCCURRENCES_PER_SERIES);

    const exdateMs = new Set((e.exdates ?? []).map((x) => new Date(x).getTime()));
    const wallDurationMs =
      e.endIso !== undefined
        ? toFloating(e.endIso).getTime() - toFloating(e.startIso).getTime()
        : 0;
    const seriesOverrides = overrides.get(`${e.source}:${e.externalId}`);

    for (const floating of floatingOccs) {
      const occStart = fromFloating(floating);
      const originalStartIso = occStart.toISOString();
      if (exdateMs.has(occStart.getTime())) continue;

      const override = seriesOverrides?.get(occStart.getTime());
      const key = occurrenceKeyFor(e, originalStartIso);
      if (override) {
        consumedOverrides.add(override);
        const { rrule: _r, exdates: _x, recurrenceId: _id, ...rest } = override;
        out.push({ ...rest, occurrenceKey: key });
        continue;
      }

      const occEndIso =
        wallDurationMs > 0
          ? fromFloating(new Date(floating.getTime() + wallDurationMs)).toISOString()
          : undefined;
      const { rrule: _r, exdates: _x, ...rest } = e;
      out.push({
        ...rest,
        startIso: e.allDay ? pacificDateKeyToMidnightIso(originalStartIso) : originalStartIso,
        endIso: occEndIso,
        occurrenceKey: key,
      });
    }
  }

  // Orphan overrides: series absent from input, or no occurrence matched
  // (e.g. the original start fell outside the window). Standalone beats lost.
  for (const e of events) {
    if (!e.recurrenceId || consumedOverrides.has(e)) continue;
    const { rrule: _r, exdates: _x, recurrenceId, ...rest } = e;
    out.push({
      ...rest,
      occurrenceKey: e.occurrenceKey || occurrenceKeyFor(e, recurrenceId),
    });
  }

  return { events: out, warnings };
}

/** All-day occurrences re-emit as clean Pacific midnights (guards against a
 *  series whose faked start drifted sub-day fields). */
function pacificDateKeyToMidnightIso(iso: string): string {
  const day = pacificDateKey(iso);
  const [y, mo, d] = day.split("-").map(Number);
  return wallTimeToInstant(ZONE, y, mo, d).toISOString();
}
