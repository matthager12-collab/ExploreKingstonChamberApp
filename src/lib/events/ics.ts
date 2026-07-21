// ICS (RFC 5545) builder — extracted VERBATIM from
// src/app/api/feeds/events/route.ts (E12 step 9, pure move: for in-app
// events the emitted bytes must not change — external subscribers depend on
// them). The one addition is VALUE=DATE emission for all-day external
// events, a branch in-app events (allDay absent/false) never take.
//
// PURE: no fetch, no fs, no clock beyond the caller-supplied events — the
// DTSTAMP uses "now" exactly as the route always has.

/** One VEVENT's worth of input. `uid` is emitted verbatim — callers compose
 *  the full value (legacy in-app form: `${escapeText(id)}@explorekingston`;
 *  external occurrences: `${source}-${externalId}-${occStamp}@explorekingston`). */
export interface IcsEvent {
  uid: string;
  title: string;
  /** ISO 8601 (any offset). */
  start: string;
  end?: string;
  /** All-day events emit VALUE=DATE (never 00:00–23:59 times). */
  allDay?: boolean;
  venue: string;
  address?: string;
  description: string;
  url?: string;
  /** Public event contact (RFC 5545 CONTACT). Additive; absent on legacy events. */
  contact?: string;
}

/** Escape a TEXT value: backslash, semicolon, comma, newlines (§3.3.11). */
export function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * ISO string (with any offset) → UTC basic format, e.g. "20260704T221500Z".
 * Emitting UTC instead of TZID=America/Los_Angeles means we don't have to
 * ship a VTIMEZONE definition; calendar apps re-render in the viewer's zone.
 */
export function toUtcStamp(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/**
 * Fold a content line at 75 octets (§3.1); continuations start with a space
 * that counts toward their own 75. Iterates code points so a multi-byte
 * UTF-8 character is never split.
 */
export function fold(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const out: string[] = [];
  let current = "";
  let octets = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, "utf8");
    if (octets + size > 75) {
      out.push(current);
      current = " ";
      octets = 1;
    }
    current += ch;
    octets += size;
  }
  out.push(current);
  return out.join("\r\n");
}

const pacificDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" });

/** "20260815" — the Pacific calendar date of an instant, basic format. */
function pacificDateBasic(iso: string): string {
  return pacificDay.format(new Date(iso)).replace(/-/g, "");
}

/** The NEXT Pacific date in basic format — DTEND;VALUE=DATE is exclusive. */
function nextPacificDateBasic(iso: string): string {
  const day = pacificDay.format(new Date(iso));
  const next = new Date(new Date(`${day}T12:00:00Z`).getTime() + 86_400_000);
  return next.toISOString().slice(0, 10).replace(/-/g, "");
}

export function toICalendar(events: IcsEvent[]): string {
  const stamp = toUtcStamp(new Date().toISOString());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Explore Kingston//Events Feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Kingston WA Events",
    "X-WR-TIMEZONE:America/Los_Angeles",
  ];

  for (const e of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.uid}`);
    lines.push(`DTSTAMP:${stamp}`);
    if (e.allDay) {
      // §3.6.1: date-valued DTSTART/DTEND; DTEND is exclusive (next day).
      lines.push(`DTSTART;VALUE=DATE:${pacificDateBasic(e.start)}`);
      lines.push(`DTEND;VALUE=DATE:${nextPacificDateBasic(e.end ?? e.start)}`);
    } else {
      lines.push(`DTSTART:${toUtcStamp(e.start)}`);
      if (e.end) lines.push(`DTEND:${toUtcStamp(e.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(e.title)}`);
    lines.push(`LOCATION:${escapeText(e.address ? `${e.venue}, ${e.address}` : e.venue)}`);
    lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    // CONTACT is a TEXT value type (§3.8.4.2) — escape it. Additive: absent on
    // legacy events, so their bytes are unchanged.
    if (e.contact) lines.push(`CONTACT:${escapeText(e.contact)}`);
    // URL is a URI value type, not TEXT — no comma/semicolon escaping.
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
