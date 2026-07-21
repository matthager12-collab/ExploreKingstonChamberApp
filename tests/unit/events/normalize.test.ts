// E12 pure core: source-shape normalizers, against the REAL fixtures (the
// committed portofkingston page shows venue-as-OBJECT; the synthetic page
// shows venue-as-ARRAY — both shapes verified live, same host, different
// probe dates).

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseICalendar } from "@/lib/events/ical-parse";
import {
  eventItemToNormalized,
  externalEventId,
  normalizedToEventItem,
  stripHtml,
  tribeToNormalized,
  veventToNormalized,
  type TribeEvent,
} from "@/lib/events/normalize";
import type { EventItem } from "@/lib/types";

const fixture = (name: string): string =>
  readFileSync(path.join(__dirname, "fixtures", name), "utf8");

const realPage = JSON.parse(fixture("tribe-portofkingston-org-page1.json")) as {
  events: TribeEvent[];
};
const arrayPage = JSON.parse(fixture("tribe-venue-array.json")) as { events: TribeEvent[] };

describe("tribeToNormalized", () => {
  it("real fixture: uses utc_start_date (never the naive local string) and global_id", () => {
    const n = tribeToNormalized(realPage.events[0], "tribe-portofkingston");
    expect(n).not.toBeNull();
    expect(n!.externalId).toBe("portofkingston.org?id=18728");
    // start_date says "2026-07-20 00:00:00" naive — the instant is 07:00Z.
    expect(n!.startIso).toBe("2026-07-20T07:00:00.000Z");
    expect(n!.allDay).toBe(true);
    expect(n!.source).toBe("tribe-portofkingston");
  });

  it("real fixture: venue as a single OBJECT normalizes", () => {
    const n = tribeToNormalized(realPage.events[0], "tribe-portofkingston");
    expect(n!.venue).toBe("Wenatchee, Washington");
  });

  it("synthetic fixture: venue as an ARRAY normalizes with a composed address", () => {
    const n = tribeToNormalized(arrayPage.events[0], "tribe-portofkingston");
    expect(n!.venue).toBe("Mike Wallace Marina Park");
    expect(n!.address).toBe("25864 Washington Blvd NE, Kingston, WA, 98346");
    expect(n!.organizer).toBe("Port of Kingston");
    expect(n!.category).toBe("market");
  });

  it("strips HTML and decodes entities in descriptions", () => {
    const n = tribeToNormalized(arrayPage.events[0], "tribe-portofkingston");
    expect(n!.description).toBe("Local produce, crafts & food vendors 'til 3 PM.");
  });

  it("skips status !== publish and hide_from_listings === true", () => {
    expect(tribeToNormalized(arrayPage.events[1], "tribe-portofkingston")).toBeNull();
    expect(tribeToNormalized(arrayPage.events[2], "tribe-portofkingston")).toBeNull();
  });

  it("falls back to the naive local string + timezone only when utc dates are absent", () => {
    const raw: TribeEvent = {
      id: 1,
      status: "publish",
      title: "Fallback Event",
      start_date: "2026-08-01 18:30:00",
      timezone: "America/Los_Angeles",
    };
    expect(tribeToNormalized(raw, "tribe-explorekingstonwa")!.startIso).toBe(
      "2026-08-02T01:30:00.000Z",
    );
  });
});

describe("stripHtml", () => {
  it("turns block tags into newlines and never leaves raw entities", () => {
    expect(stripHtml("<p>a&nbsp;&amp; b</p><p>c &#8217;d</p>")).toBe("a & b\nc 'd");
  });
});

describe("veventToNormalized", () => {
  it("maps the real ChamberMaster VEVENT with its UID as externalId", () => {
    const { events } = parseICalendar(fixture("ams-grand-hallway-art-show-1770249.ics"));
    const n = veventToNormalized(events[0], "ams-ical");
    expect(n).not.toBeNull();
    expect(n!.externalId).toBe("e.3508.1493103");
    expect(n!.title).toBe("Grand Hallway Art Show");
    expect(n!.venue).toBe(""); // LOCATION is empty on this feed — wildcard for fuzzy
    expect(n!.occurrenceKey).toBe("ams-ical:e.3508.1493103:20260701T160000Z");
  });

  it("keys an override VEVENT by its RECURRENCE-ID (original start), not its moved start", () => {
    const { events } = parseICalendar(fixture("synthetic-recurrence-override.ics"));
    const override = events.find((e) => e.recurrenceId)!;
    const n = veventToNormalized(override, "ams-ical");
    expect(n!.occurrenceKey).toBe("ams-ical:e.9999.board-meeting:20260814T170000Z");
  });
});

describe("in-app round trip", () => {
  const item: EventItem = {
    id: "july4-fireworks-2026",
    title: "Kingston 4th of July Fireworks Show",
    start: "2026-07-04T22:15:00-07:00",
    end: "2026-07-04T22:35:00-07:00",
    venue: "Appletree Cove (Kingston waterfront)",
    address: "Mike Wallace Park, Kingston, WA 98346",
    description: "Fireworks over the cove.",
    category: "festival",
    organizer: "Greater Kingston Chamber of Commerce",
    url: "https://example.com",
  };

  it("eventItemToNormalized preserves identity and fields", () => {
    const n = eventItemToNormalized(item);
    expect(n.source).toBe("in-app");
    expect(n.externalId).toBe(item.id);
    expect(n.occurrenceKey).toBe("in-app:july4-fireworks-2026:20260705T051500Z");
  });

  it("normalizedToEventItem keeps the in-app id verbatim (feed contract)", () => {
    const back = normalizedToEventItem(eventItemToNormalized(item));
    expect(back).toEqual(item);
  });

  it("external occurrences get a feed-safe slug id derived from the occurrenceKey", () => {
    const { events } = parseICalendar(fixture("ams-grand-hallway-art-show-1770249.ics"));
    const n = veventToNormalized(events[0], "ams-ical")!;
    const item2 = normalizedToEventItem(n);
    expect(item2.id).toBe(externalEventId(n.occurrenceKey));
    expect(item2.id).toBe("ams-ical-e-3508-1493103-20260701T160000Z");
    expect(item2.category).toBe("community"); // default when the source has none
  });
});
