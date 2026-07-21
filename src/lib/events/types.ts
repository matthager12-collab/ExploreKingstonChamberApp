// E12 unified-calendar pure core: shared types + the two policy constants
// (vk/events-core). PURE — no fetch, no fs, no db imports anywhere in the
// core modules (types, tz, ical-parse, rrule-expand, dedupe, normalize);
// adapters do I/O and hand plain data in.

import type { EventCategory } from "@/lib/types";

/** Where a calendar event came from. `in-app` is the app's own store; the
 *  rest are ingest sources configured in the calendar-sources store. */
export type EventSource =
  | "in-app"
  | "ams-ical"
  | "tribe-explorekingstonwa"
  | "tribe-portofkingston";

/**
 * Merge precedence, highest first — ADR-0002 policy, recorded with evidence in
 * ADR-0005: in-app > GrowthZone (ams-ical) > Tribe. Changing this order means
 * amending ADR-0002 with Mat, never a code-review call.
 *
 * The order is TOTAL OVER ANY SUBSET of sources (E12 RE-CHARTER delta 4): the
 * GrowthZone feed is transitional (ends ~April 2027), and nothing here or in
 * dedupe.ts may require a given source to be present in the input.
 */
export const SOURCE_PRECEDENCE: readonly EventSource[] = [
  "in-app",
  "ams-ical",
  "tribe-explorekingstonwa",
  "tribe-portofkingston",
];

/** Lower = wins its cluster. Unknown sources sink to the bottom rather than
 *  throwing — precedence must stay total over whatever the input holds. */
export function sourceRank(source: string): number {
  const i = (SOURCE_PRECEDENCE as readonly string[]).indexOf(source);
  return i === -1 ? SOURCE_PRECEDENCE.length : i;
}

/**
 * The ONLY hosts ingest may fetch (compile-time constant; adapters reject
 * anything else, unit-tested). Facebook is never a source (ToS; decided
 * output-channel-only). If the staff-generated whole-calendar feed URL
 * (docs/OPERATIONS.md §9 item 6b) arrives on the tenant's staff hostname
 * (greaterkingstoncommunitychamberofcommerce.growthzoneapp.com — same tenant
 * 3508 per ADR-0001), add that EXACT host here; no other relaxation.
 */
export const SOURCE_ALLOWLIST = [
  "explorekingstonwa.com",
  "business.kingstonchamber.com",
  "portofkingston.org",
] as const;

/**
 * One calendar item in the merge pipeline — a superset mapping onto
 * `EventItem` / `eventSchema`. Series-level before recurrence expansion
 * (may carry `rrule`); per-occurrence after (occurrenceKey is unique).
 */
export interface NormalizedEvent {
  title: string;
  /** ISO 8601 instant (UTC or offset-carrying — always a real instant). */
  startIso: string;
  endIso?: string;
  /** All-day events render as dates, never as 00:00–23:59 times. */
  allDay: boolean;
  venue: string;
  address?: string;
  description: string;
  url?: string;
  /** Best-effort mapping into the 7-category model; consumers default
   *  "community" when absent. */
  category?: EventCategory;
  organizer?: string;
  source: EventSource;
  /** Stable per-source identity: in-app id, iCal UID, or Tribe global_id. */
  externalId: string;
  /** Raw RRULE value (series-level only; expansion strips it). */
  rrule?: string;
  /** EXDATE instants (ISO) — occurrences removed from the series. */
  exdates?: string[];
  /** RECURRENCE-ID original-occurrence instant (ISO) — this event overrides
   *  that occurrence of the series sharing its externalId. */
  recurrenceId?: string;
  /**
   * Stable per-occurrence key `${source}:${externalId}:${occStartUtcBasic}`
   * (e.g. "ams-ical:e.3508.1493103:20260815T170000Z"). For an overridden
   * occurrence the stamp is the ORIGINAL start (the RECURRENCE-ID), so the
   * key survives the override changing the time. Admin dedupe verdicts
   * reference these keys.
   */
  occurrenceKey: string;
  /** Identities merged into this survivor (losers' {source, externalId}),
   *  carried so future ingests keep resolving to the same record. */
  aliases?: { source: EventSource; externalId: string }[];
  /** Portal ownership refs — in-app events only; the feed's ?owner filter
   *  reads them. External sources never carry ownership. */
  ownerId?: string;
  charityId?: string;
  /** In-app public event contact + uploaded artwork, carried through the
   *  merge so the card/feed keep them in unified mode. External sources have
   *  none. */
  eventContact?: string;
  attachments?: string[];
}

/** Per-run adapter report — stored on the calendar-sources record and shown
 *  on the admin page. */
export interface IngestReport {
  fetched: number;
  parsed: number;
  skipped: number;
  errors: string[];
}
