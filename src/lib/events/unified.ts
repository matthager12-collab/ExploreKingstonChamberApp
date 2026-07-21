// The unified read path (E12 step 9): in-app live events + live external
// events from ENABLED sources → recurrence expansion → mergeCalendar with
// the admin dedupe verdicts → one sorted town calendar.
//
// Consumed — ONLY when the unified-calendar flag is ON — by:
//   - src/app/events/page.tsx (the public calendar page)
//   - src/app/api/feeds/events/route.ts (JSON + ICS feed)
//   - the ?onDate deconfliction lookup in /api/portal/events (M-16-05:
//     anchor-date conflict warnings see AMS/Tribe events too)
// Flag OFF → those surfaces never call this and serve exactly the current
// single-store behavior.
//
// Delta 2 enforcement point: getExternalEvents({ sources: enabledIds }) —
// disabling a source (the GrowthZone end-of-life switch) drops its events
// from the merged output on the next read, no deploy.

import "server-only";

import { normalizeEventTimestamp } from "@/lib/time";
import { getEvents } from "@/lib/stores/event-store";
import { getEnabledSourceIds } from "@/lib/stores/calendar-sources-store";
import { getExternalEvents } from "@/lib/stores/external-events-store";
import { listDedupeOverrides } from "@/lib/stores/event-overrides-store";
import { mergeCalendar, reviewClusters, type EventCluster } from "./dedupe";
import { eventItemToNormalized } from "./normalize";
import { expandEvents } from "./rrule-expand";
import { pacificDateKey } from "./tz";
import type { NormalizedEvent } from "./types";

/** Expansion window (epic constraint): [now − 1 day, now + 180 days]. */
const WINDOW_BACK_MS = 86_400_000;
const WINDOW_FORWARD_MS = 180 * 86_400_000;

/**
 * The merged calendar: per-occurrence NormalizedEvents, deduped, precedence
 * applied (in-app > ams-ical > tribe-*), sorted by start. Pure core does all
 * the thinking; this function only wires stores to it.
 */
export async function getUnifiedEvents(now: Date = new Date()): Promise<NormalizedEvent[]> {
  const { expanded, overrides } = await expandedCalendar(now);
  return mergeCalendar(expanded, overrides);
}

/** The admin dedupe-review view (FR-EVT-02): every multi-member cluster in
 *  the current merge, plus the merged list — the /admin/events-sources
 *  preview surface (session-gated there; this function itself is not). */
export async function getUnifiedReview(now: Date = new Date()): Promise<{
  merged: NormalizedEvent[];
  clusters: EventCluster[];
}> {
  const { expanded, overrides } = await expandedCalendar(now);
  return {
    merged: mergeCalendar(expanded, overrides),
    clusters: reviewClusters(expanded, overrides),
  };
}

async function expandedCalendar(now: Date) {
  const [inApp, enabledIds, overrides] = await Promise.all([
    getEvents(),
    getEnabledSourceIds(),
    listDedupeOverrides(),
  ]);
  const external = await getExternalEvents({ sources: enabledIds });

  const normalized: NormalizedEvent[] = [
    // Read-time timestamp normalization, same reason as the feed route:
    // pre-fix rows may hold naive strings; normalize BEFORE any instant math.
    ...inApp.map((e) =>
      eventItemToNormalized({
        ...e,
        start: normalizeEventTimestamp(e.start),
        end: e.end ? normalizeEventTimestamp(e.end) : e.end,
      }),
    ),
    ...external.map(({ id: _id, ...event }) => event as NormalizedEvent),
  ];

  const { events: expanded } = expandEvents(normalized, {
    windowStart: new Date(now.getTime() - WINDOW_BACK_MS),
    windowEnd: new Date(now.getTime() + WINDOW_FORWARD_MS),
  });

  return { expanded, overrides };
}

/**
 * Merged-set deconfliction (M-16-05): every unified event on the given
 * Pacific calendar date, excluding `excludeId` (matched against both the
 * in-app id and the occurrence key, so a portal edit excludes itself).
 */
export async function unifiedEventsSharingDate(
  dateIso: string,
  excludeId?: string,
  now: Date = new Date(),
): Promise<NormalizedEvent[]> {
  const day = pacificDateKey(dateIso);
  return (await getUnifiedEvents(now)).filter(
    (e) =>
      pacificDateKey(e.startIso) === day &&
      e.externalId !== excludeId &&
      e.occurrenceKey !== excludeId,
  );
}
