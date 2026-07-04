// Ferry departure reminders — the calendar (.ics) half of the phased feature.
//
// A reminder targets one specific car-ferry sailing (a departure instant + a
// direction). reminderIcsUrl() builds the link the widget points at; the
// /api/ferry/reminder route calls buildFerryIcs() to return an RFC-5545 event
// with a VALARM that fires REMINDER_LEAD_MIN before departure, so the rider's
// own phone calendar nudges them in time.
//
// Pure module (no fs/db/env), so both the server route and the client widget
// import from it. Injection-safe by construction: nothing from the query string
// is echoed into the .ics — `dir` is validated against FERRY_DIRS (fixed
// labels) and `departs` is parsed to an instant and re-emitted as a UTC stamp.

import { formatPacificTime } from "./time";

export type FerryDir = "from-kingston" | "to-kingston";

interface RouteMeta {
  /** Human label, e.g. "Kingston to Edmonds". */
  label: string;
  /** Departure terminal address (event LOCATION). */
  fromAddr: string;
  /** Typical crossing time, for a sensible event end. */
  crossingMin: number;
}

export const FERRY_DIRS: Record<FerryDir, RouteMeta> = {
  "from-kingston": {
    label: "Kingston to Edmonds",
    fromAddr: "Kingston Ferry Terminal, Kingston, WA 98346",
    crossingMin: 30,
  },
  "to-kingston": {
    label: "Edmonds to Kingston",
    fromAddr: "Edmonds Ferry Terminal, Edmonds, WA 98020",
    crossingMin: 30,
  },
};

export function isFerryDir(v: unknown): v is FerryDir {
  return v === "from-kingston" || v === "to-kingston";
}

/** How far ahead of departure the reminder fires (calendar alarm + in-page). */
export const REMINDER_LEAD_MIN = 20;

/** Link the widget points at for a given sailing's calendar reminder. */
export function reminderIcsUrl(dir: FerryDir, departs: string): string {
  return `/api/ferry/reminder?${new URLSearchParams({ dir, departs }).toString()}`;
}

/* ------------------------------- ICS building ------------------------------- */

/** "2026-07-04T02:15:00.000Z" → "20260704T021500Z". */
function toIcsUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Escape an ICS TEXT value (RFC 5545 §3.3.11). Content here is ASCII. */
function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** Fold a content line at 75 octets (ASCII-only content → char count == octets). */
function fold(line: string): string {
  if (line.length <= 75) return line;
  let out = line.slice(0, 74);
  let rest = line.slice(74);
  while (rest.length > 0) {
    out += "\r\n " + rest.slice(0, 73);
    rest = rest.slice(73);
  }
  return out;
}

/**
 * Build a single-event VCALENDAR for a sailing, or null if `departs` isn't a
 * real instant. `now` stamps DTSTAMP (pass new Date() from the route).
 */
export function buildFerryIcs(dir: FerryDir, departs: string, now: Date): string | null {
  const start = new Date(departs);
  if (Number.isNaN(start.getTime())) return null;
  // RFC 5545 DATE-TIME needs a plain 4-digit year. Reject extended-year /
  // out-of-range instants (e.g. "+012026-…" or JS's max Date) so a crafted
  // query returns a clean 400 rather than a malformed stamp or an overflow.
  const year = start.getUTCFullYear();
  if (year < 1 || year > 9999) return null;
  const meta = FERRY_DIRS[dir];
  const end = new Date(start.getTime() + meta.crossingMin * 60_000);
  if (Number.isNaN(end.getTime())) return null;

  const summary = `Ferry: ${meta.label} (${formatPacificTime(departs)})`;
  // Written as plain text; escapeText() handles the commas/semicolons per RFC.
  const description =
    `Reminder from Explore Kingston. Head to the terminal about ${REMINDER_LEAD_MIN} minutes early. ` +
    `When the SR-104 boarding-pass signs are flashing, get in the ferry line - don't drive straight to the dock. ` +
    `Live times: https://explorekingstonwa.com/ferry`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Explore Kingston//Ferry Reminder//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:ferry-${start.getTime()}-${dir}@explorekingstonwa.com`,
    `DTSTAMP:${toIcsUtc(now)}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${escapeText(summary)}`,
    `LOCATION:${escapeText(meta.fromAddr)}`,
    `DESCRIPTION:${escapeText(description)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(`Ferry leaves in ${REMINDER_LEAD_MIN} min - time to head to the dock`)}`,
    `TRIGGER:-PT${REMINDER_LEAD_MIN}M`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
