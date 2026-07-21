// Source-shape normalizers (E12 pure core): Tribe REST JSON, parsed VEVENTs,
// and in-app EventItems each map into NormalizedEvent; plus the reverse map
// the unified read path uses to emit feed-shaped events. PURE — plain data
// in, plain data out; the adapters own all I/O.
//
// Verified Tribe traps encoded here (probes of 2026-07-05 and 2026-07-20):
//  - `start_date` is a NAIVE local string ("2026-07-04 00:00:00") — parsing it
//    with new Date() shifts hours engine-dependently. Use `utc_start_date`
//    (+ `timezone` fallback), never the naive string.
//  - `venue` is an ARRAY of venue objects on some Tribe versions and a single
//    OBJECT on others — the 2026-07-05 probe saw the array, 2026-07-20 saw
//    the object, same host. Handle both. Same for `organizer`.
//  - `status !== "publish"` and `hide_from_listings === true` events skip.
//  - `all_day: true` events must carry the flag (rendered as dates, and
//    VALUE=DATE in ICS), never as 00:00–23:59 times.

import type { EventCategory, EventItem } from "@/lib/types";
import type { ParsedVEvent } from "./ical-parse";
import { toPacificOffsetIso, toUtcBasic, wallTimeToInstant } from "./tz";
import type { EventSource, NormalizedEvent } from "./types";

const CATEGORIES: readonly EventCategory[] = [
  "festival",
  "market",
  "music",
  "community",
  "charity",
  "sports",
  "arts",
];

/* ------------------------------ Tribe JSON ------------------------------- */

/** The Tribe REST fields we read — everything optional, versions vary. */
export interface TribeEvent {
  id?: number;
  global_id?: string;
  status?: string;
  title?: string;
  description?: string;
  url?: string;
  all_day?: boolean;
  hide_from_listings?: boolean;
  start_date?: string;
  end_date?: string;
  utc_start_date?: string;
  utc_end_date?: string;
  timezone?: string;
  venue?: TribeVenue | TribeVenue[];
  organizer?: TribeOrganizer | TribeOrganizer[];
  categories?: { name?: string; slug?: string }[];
}
interface TribeVenue {
  venue?: string;
  address?: string;
  city?: string;
  state?: string;
  province?: string;
  zip?: string;
}
interface TribeOrganizer {
  organizer?: string;
}

/** "2026-07-20 07:00:00" (Tribe's UTC form) → ISO instant. */
function tribeUtcToIso(value: string): string | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return new Date(
    Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]),
  ).toISOString();
}

/** Naive local + IANA zone → ISO instant (fallback when utc_* is absent). */
function tribeLocalToIso(value: string, zone: string): string | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return wallTimeToInstant(zone, +m[1], +m[2], +m[3], +m[4], +m[5], +m[6]).toISOString();
}

/** Minimal HTML → text: strip tags, decode the common entities, collapse
 *  whitespace. Good enough for calendar blurbs; never rendered as HTML. */
export function stripHtml(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/li)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;|&#0*8217;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return n > 31 && n < 0x10ffff ? String.fromCodePoint(n) : " ";
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function firstOf<T>(v: T | T[] | undefined): T | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function tribeCategory(categories: TribeEvent["categories"]): EventCategory | undefined {
  for (const c of categories ?? []) {
    const candidate = (c.slug ?? c.name ?? "").toLowerCase().trim();
    const hit = CATEGORIES.find((k) => k === candidate);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * One Tribe REST event → NormalizedEvent, or null when it must not render
 * (unpublished, hidden, or missing the fields an event cannot exist without).
 */
export function tribeToNormalized(
  raw: TribeEvent,
  source: EventSource,
): NormalizedEvent | null {
  if (raw.status !== "publish") return null;
  if (raw.hide_from_listings === true) return null;
  const title = (raw.title ?? "").trim();
  if (!title) return null;

  const zone = raw.timezone || "America/Los_Angeles";
  const startIso = raw.utc_start_date
    ? tribeUtcToIso(raw.utc_start_date)
    : raw.start_date
      ? tribeLocalToIso(raw.start_date, zone)
      : null;
  if (!startIso) return null;
  const endIso =
    (raw.utc_end_date
      ? tribeUtcToIso(raw.utc_end_date)
      : raw.end_date
        ? tribeLocalToIso(raw.end_date, zone)
        : null) ?? undefined;

  const externalId = raw.global_id || (raw.id !== undefined ? String(raw.id) : "");
  if (!externalId) return null;

  const venue = firstOf(raw.venue);
  const organizer = firstOf(raw.organizer);
  const addressParts = [
    venue?.address,
    venue?.city,
    venue?.state ?? venue?.province,
    venue?.zip,
  ].filter((p): p is string => Boolean(p && p.trim()));

  return {
    title,
    startIso,
    endIso,
    allDay: raw.all_day === true,
    venue: (venue?.venue ?? "").trim(),
    address: addressParts.length ? addressParts.join(", ") : undefined,
    description: stripHtml(raw.description ?? ""),
    url: raw.url?.trim() || undefined,
    category: tribeCategory(raw.categories),
    organizer: organizer?.organizer?.trim() || undefined,
    source,
    externalId,
    occurrenceKey: `${source}:${externalId}:${toUtcBasic(startIso)}`,
  };
}

/* ----------------------------- parsed VEVENT ----------------------------- */

/** One parsed VEVENT → NormalizedEvent (series-level: rrule/exdates ride
 *  along for rrule-expand), or null when unusable. */
export function veventToNormalized(
  ev: ParsedVEvent,
  source: EventSource,
): NormalizedEvent | null {
  if (!ev.start || !ev.uid) return null;
  const title = ev.summary.trim();
  if (!title) return null;
  return {
    title,
    startIso: ev.start.iso,
    endIso: ev.end?.iso,
    allDay: ev.allDay,
    venue: ev.location,
    description: ev.description,
    url: ev.url,
    source,
    externalId: ev.uid,
    rrule: ev.rrule,
    exdates: ev.exdates.length ? ev.exdates : undefined,
    recurrenceId: ev.recurrenceId,
    occurrenceKey: `${source}:${ev.uid}:${toUtcBasic(ev.recurrenceId ?? ev.start.iso)}`,
  };
}

/* ------------------------------- in-app ---------------------------------- */

/** In-app EventItem → NormalizedEvent. Callers pass timestamps already run
 *  through normalizeEventTimestamp (the read path does) so naive legacy rows
 *  cannot smuggle a server-local parse in here. */
export function eventItemToNormalized(e: EventItem): NormalizedEvent {
  return {
    title: e.title,
    startIso: e.start,
    endIso: e.end,
    allDay: false,
    venue: e.venue,
    address: e.address,
    description: e.description,
    url: e.url,
    category: e.category,
    organizer: e.organizer,
    source: "in-app",
    externalId: e.id,
    occurrenceKey: `in-app:${e.id}:${toUtcBasic(e.start)}`,
    ownerId: e.ownerId,
    charityId: e.charityId,
    eventContact: e.eventContact,
    attachments: e.attachments,
  };
}

/* ------------------------- back out, for the feed ------------------------ */

/** Feed-safe id for an external occurrence — the occurrenceKey slugged into
 *  the id alphabet. In-app events keep their real id (feed contract: their
 *  bytes must not change). */
export function externalEventId(occurrenceKey: string): string {
  return occurrenceKey.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

/** NormalizedEvent → the EventItem shape every feed surface emits. In-app
 *  events keep their stored bytes verbatim (feed contract); external instants
 *  re-serialize with the Pacific offset — the form the in-app store has
 *  always used, so date-prefix slicing (the events page, pacificDateKey's
 *  naive branch) reads the correct local date. */
export function normalizedToEventItem(n: NormalizedEvent): EventItem {
  const inApp = n.source === "in-app";
  return {
    id: inApp ? n.externalId : externalEventId(n.occurrenceKey),
    title: n.title,
    start: inApp ? n.startIso : toPacificOffsetIso(n.startIso),
    end: inApp ? n.endIso : n.endIso && toPacificOffsetIso(n.endIso),
    venue: n.venue,
    address: n.address,
    description: n.description,
    category: n.category ?? "community",
    organizer: n.organizer ?? "",
    url: n.url,
    eventContact: n.eventContact,
    attachments: n.attachments,
  };
}
