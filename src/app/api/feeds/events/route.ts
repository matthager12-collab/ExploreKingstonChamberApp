// Public events feed — JSON by default, iCalendar with ?format=ics.
//
// This is the canonical outbound surface for Kingston events: a business's
// own website can poll the JSON (or paste /embed/kingston-events.js), and
// anyone can subscribe to the ICS URL from Google Calendar ("From URL") or
// Apple Calendar (File → New Calendar Subscription). At the GrowthZone R4
// cutover (~April 2027) the kingstonchamber.com WordPress site repoints its
// events surfaces HERE — the feed contract is additive-only (ADR-0005).
//
// Query params:
//   ?owner=<id>    only events managed by that listing/org (ownerId or charityId)
//   ?format=ics    RFC 5545 iCalendar instead of JSON
//
// UNIFIED CALENDAR (E12, ship-dark): when the unified-calendar flag is ON the
// feed serves the merged in-app + external calendar; in-app events keep their
// ids and `UID:${id}@explorekingston` byte-identical, external occurrences
// ADD entries with slugged ids and namespaced UIDs. Flag OFF (the default)
// serves exactly the pre-E12 in-app-only bytes. The flag read is
// deliberately session-free: this response is shared-cached (s-maxage +
// CORS *), so an admin-preview branch here would leak preview data into the
// public cache — admin preview lives on /admin/events-sources instead.
//
// Cross-origin on purpose: these are public reads, so the feed sends
// Access-Control-Allow-Origin: * — the embed script on a business's domain
// depends on it.

import type { NextRequest } from "next/server";
import { attachmentPublicUrl } from "@/lib/events/attachment-refs";
import { escapeText, toICalendar, type IcsEvent } from "@/lib/events/ics";
import { externalEventId, normalizedToEventItem } from "@/lib/events/normalize";
import { getUnifiedEvents } from "@/lib/events/unified";
import type { NormalizedEvent } from "@/lib/events/types";
import { getEvents } from "@/lib/stores/event-store";
import { getUnifiedCalendarEnabled } from "@/lib/stores/unified-calendar-store";
import { normalizeEventTimestamp } from "@/lib/time";
import type { EventItem } from "@/lib/types";

const SHARED_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
};

/** The stable per-event UID: legacy `${id}@explorekingston` for in-app
 *  events (byte-frozen — subscribers hold these), namespaced
 *  `${source}-${externalId}-${occStamp}@explorekingston` for external
 *  occurrences (the slugged occurrenceKey — can never collide with an
 *  in-app id, which contains no source prefix). */
function icsUidFor(e: EventItem, n?: NormalizedEvent): string {
  if (!n || n.source === "in-app") return `${escapeText(e.id)}@explorekingston`;
  return `${externalEventId(n.occurrenceKey)}@explorekingston`;
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const owner = search.get("owner");
  const now = Date.now();
  const unified = await getUnifiedCalendarEnabled();

  // Each entry: the feed-shaped EventItem plus (flag ON) its merge-layer
  // record for UID/allDay decisions. Flag OFF never touches the merge layer.
  let entries: { item: EventItem; normalized?: NormalizedEvent }[];
  if (unified) {
    entries = (await getUnifiedEvents(new Date(now))).map((n) => ({
      item: normalizedToEventItem(n),
      normalized: n,
    }));
  } else {
    // Defensive read-time normalization: pre-existing rows written before the
    // write-path fix may still hold a naive string, and the upcoming-events
    // comparison just below is itself TZ-sensitive for those — so normalize
    // BEFORE filtering, not after, or a naive event could sort as already-past
    // (or not) depending on the server's TZ.
    entries = (await getEvents()).map((e) => ({
      item: {
        ...e,
        start: normalizeEventTimestamp(e.start),
        end: e.end ? normalizeEventTimestamp(e.end) : e.end,
      },
    }));
  }

  // Upcoming = anything not yet finished (events in progress still count).
  let events = entries.filter(
    ({ item }) => new Date(item.end ?? item.start).getTime() >= now,
  );
  if (owner) {
    events = events.filter(({ item, normalized }) => {
      const ownerId = normalized ? normalized.ownerId : item.ownerId;
      const charityId = normalized ? normalized.charityId : item.charityId;
      return ownerId === owner || charityId === owner;
    });
  }

  if (search.get("format") === "ics") {
    const slug = owner ? owner.replace(/[^a-zA-Z0-9_-]/g, "") : "";
    const filename = slug ? `kingston-events-${slug}.ics` : "kingston-events.ics";
    const icsEvents: IcsEvent[] = events.map(({ item, normalized }) => ({
      uid: icsUidFor(item, normalized),
      title: item.title,
      start: item.start,
      end: item.end,
      allDay: normalized?.allDay,
      venue: item.venue,
      address: item.address,
      description: item.description,
      url: item.url,
      contact: item.eventContact,
    }));
    return new Response(toICalendar(icsEvents), {
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
      events: events.map(({ item: e, normalized }) => ({
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
        // Additive per-event keys — emitted only when the event actually
        // carries them, so seed/in-app events without them stay byte-frozen.
        ...(e.eventContact ? { eventContact: e.eventContact } : {}),
        ...(e.attachments?.length
          ? { attachments: e.attachments.map(attachmentPublicUrl) }
          : {}),
        // Merge-layer metadata — unified mode only.
        ...(unified && normalized
          ? { sourceCalendar: normalized.source, allDay: normalized.allDay }
          : {}),
      })),
    },
    { headers: SHARED_HEADERS },
  );
}
