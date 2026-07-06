// Public events feed — JSON by default, iCalendar with ?format=ics.
//
// This is the canonical outbound surface for Kingston events: a business's
// own website can poll the JSON (or paste /embed/kingston-events.js), and
// anyone can subscribe to the ICS URL from Google Calendar ("From URL") or
// Apple Calendar (File → New Calendar Subscription).
//
// Query params:
//   ?owner=<id>    only events managed by that listing/org (ownerId or charityId)
//   ?format=ics    RFC 5545 iCalendar instead of JSON
//
// Cross-origin on purpose: these are public reads, so the feed sends
// Access-Control-Allow-Origin: * — the embed script on a business's domain
// depends on it.

import type { NextRequest } from "next/server";
import { getEvents } from "@/lib/stores/event-store";
import { normalizeEventTimestamp } from "@/lib/time";
import type { EventItem } from "@/lib/types";

const SHARED_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
};

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const owner = search.get("owner");
  const now = Date.now();

  // Defensive read-time normalization: pre-existing rows written before the
  // write-path fix may still hold a naive string, and the upcoming-events
  // comparison just below is itself TZ-sensitive for those — so normalize
  // BEFORE filtering, not after, or a naive event could sort as already-past
  // (or not) depending on the server's TZ.
  const normalized = (await getEvents()).map((e) => ({
    ...e,
    start: normalizeEventTimestamp(e.start),
    end: e.end ? normalizeEventTimestamp(e.end) : e.end,
  }));

  // Upcoming = anything not yet finished (events in progress still count).
  let events = normalized.filter((e) => new Date(e.end ?? e.start).getTime() >= now);
  if (owner) {
    events = events.filter((e) => e.ownerId === owner || e.charityId === owner);
  }

  if (search.get("format") === "ics") {
    const slug = owner ? owner.replace(/[^a-zA-Z0-9_-]/g, "") : "";
    const filename = slug ? `kingston-events-${slug}.ics` : "kingston-events.ics";
    return new Response(toICalendar(events), {
      headers: {
        ...SHARED_HEADERS,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  }

  return Response.json(
    {
      source: "Explore Kingston — Greater Kingston Chamber of Commerce",
      generatedAt: new Date().toISOString(),
      count: events.length,
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end,
        venue: e.venue,
        address: e.address,
        description: e.description,
        category: e.category,
        organizer: e.organizer,
        url: e.url,
      })),
    },
    { headers: SHARED_HEADERS },
  );
}

// ---------- iCalendar (RFC 5545) ----------

/** Escape a TEXT value: backslash, semicolon, comma, newlines (§3.3.11). */
function escapeText(text: string): string {
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
function toUtcStamp(iso: string): string {
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
function fold(line: string): string {
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

function toICalendar(events: EventItem[]): string {
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
    lines.push(`UID:${escapeText(e.id)}@explorekingston`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${toUtcStamp(e.start)}`);
    if (e.end) lines.push(`DTEND:${toUtcStamp(e.end)}`);
    lines.push(`SUMMARY:${escapeText(e.title)}`);
    lines.push(`LOCATION:${escapeText(e.address ? `${e.venue}, ${e.address}` : e.venue)}`);
    lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    // URL is a URI value type, not TEXT — no comma/semicolon escaping.
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
