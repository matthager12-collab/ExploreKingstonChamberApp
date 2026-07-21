// E12 pure core: recurrence expansion. The DST suite is the load-bearing one —
// `rrule` does naive UTC math, and the floating-time + re-anchor strategy is
// what keeps a weekly 18:30 event at 18:30 local across both 2026-11-01
// (fall back) and 2027-03-14 (spring forward).

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseICalendar } from "@/lib/events/ical-parse";
import { veventToNormalized } from "@/lib/events/normalize";
import {
  expandEvents,
  MAX_OCCURRENCES_PER_SERIES,
} from "@/lib/events/rrule-expand";
import { instantToWallTime, pacificDateKey } from "@/lib/events/tz";
import type { NormalizedEvent } from "@/lib/events/types";

const fixture = (name: string): string =>
  readFileSync(path.join(__dirname, "fixtures", name), "utf8");

function normalizedFrom(name: string): NormalizedEvent[] {
  const { events } = parseICalendar(fixture(name));
  return events
    .map((e) => veventToNormalized(e, "ams-ical"))
    .filter((e): e is NormalizedEvent => e !== null);
}

const WINDOW_2026H2 = {
  windowStart: new Date("2026-07-01T00:00:00Z"),
  windowEnd: new Date("2027-01-01T00:00:00Z"),
};

const wallClock = (iso: string) => {
  const w = instantToWallTime("America/Los_Angeles", new Date(iso));
  return `${String(w.h).padStart(2, "0")}:${String(w.mi).padStart(2, "0")}`;
};

describe("expandEvents — DST boundaries", () => {
  it("DST fall-back (2026-11-01): weekly 18:30 stays 18:30 local on both sides", () => {
    const { events } = expandEvents(normalizedFrom("synthetic-dst-crossing.ics"), WINDOW_2026H2);
    const series = events.filter((e) => e.externalId === "e.9999.fall-back-series");
    expect(series).toHaveLength(6);
    for (const occ of series) {
      expect(wallClock(occ.startIso), occ.startIso).toBe("18:30");
      expect(wallClock(occ.endIso!), occ.endIso).toBe("20:00");
    }
    // The UTC instant shifts by exactly the DST hour: PDT 01:30Z → PST 02:30Z.
    expect(series[1].startIso).toBe("2026-10-29T01:30:00.000Z"); // 10/28 PDT
    expect(series[2].startIso).toBe("2026-11-05T02:30:00.000Z"); // 11/04 PST
  });

  it("DST spring-forward (2027-03-14): weekly 18:30 stays 18:30 local on both sides", () => {
    const { events } = expandEvents(normalizedFrom("synthetic-dst-crossing.ics"), {
      windowStart: new Date("2027-02-01T00:00:00Z"),
      windowEnd: new Date("2027-04-15T00:00:00Z"),
    });
    const series = events.filter((e) => e.externalId === "e.9999.spring-forward-series");
    expect(series).toHaveLength(4);
    for (const occ of series) {
      expect(wallClock(occ.startIso), occ.startIso).toBe("18:30");
    }
    expect(series[1].startIso).toBe("2027-03-11T02:30:00.000Z"); // 03/10 PST
    expect(series[2].startIso).toBe("2027-03-18T01:30:00.000Z"); // 03/17 PDT
  });
});

describe("expandEvents — EXDATE and bounds", () => {
  it("EXDATE removes listed occurrences (multi-line and multi-value forms)", () => {
    const { events } = expandEvents(normalizedFrom("synthetic-weekly-exdate.ics"), WINDOW_2026H2);
    // Pacific dates — an 18:30 PDT start is the NEXT day in UTC.
    const days = events.map((e) => pacificDateKey(e.startIso)).sort();
    // COUNT=8 minus three EXDATEs (08-12, 09-02, 09-09) = 5 occurrences.
    expect(days).toEqual(["2026-08-05", "2026-08-19", "2026-08-26", "2026-09-16", "2026-09-23"]);
  });

  it("COUNT bounds the series (no ninth Wednesday)", () => {
    const withoutExdates = normalizedFrom("synthetic-weekly-exdate.ics").map(
      ({ exdates: _x, ...e }) => e,
    );
    const { events } = expandEvents(withoutExdates, WINDOW_2026H2);
    expect(events).toHaveLength(8);
    expect(events.map((e) => pacificDateKey(e.startIso))).not.toContain("2026-09-30");
  });

  it("UNTIL bounds the series", () => {
    const { events } = expandEvents(normalizedFrom("synthetic-until-allday.ics"), WINDOW_2026H2);
    const cleanups = events.filter((e) => e.externalId === "e.9999.beach-cleanup");
    expect(cleanups.map((e) => e.startIso.slice(0, 10))).toEqual([
      "2026-08-03",
      "2026-08-10",
      "2026-08-17",
      "2026-08-24",
    ]);
  });

  it("caps a runaway unbounded series at the per-series maximum", () => {
    const daily: NormalizedEvent = {
      title: "Runaway Daily",
      startIso: "2026-07-02T17:00:00.000Z",
      allDay: false,
      venue: "",
      description: "",
      source: "ams-ical",
      externalId: "e.9999.runaway",
      rrule: "FREQ=DAILY",
      occurrenceKey: "ams-ical:e.9999.runaway:20260702T170000Z",
    };
    const { events } = expandEvents([daily], WINDOW_2026H2);
    expect(events).toHaveLength(MAX_OCCURRENCES_PER_SERIES);
  });
});

describe("expandEvents — RECURRENCE-ID overrides", () => {
  it("replaces the occurrence whose ORIGINAL start matches, keeping its stable key", () => {
    const { events } = expandEvents(
      normalizedFrom("synthetic-recurrence-override.ics"),
      WINDOW_2026H2,
    );
    expect(events).toHaveLength(4); // COUNT=4, override replaces — never adds
    const moved = events.find((e) => e.title.includes("moved to afternoon"));
    expect(moved).toBeDefined();
    // The override moved 10:00 → 14:00, but the occurrenceKey stamps the
    // ORIGINAL start so stored admin verdicts survive the reschedule.
    expect(moved!.occurrenceKey).toBe("ams-ical:e.9999.board-meeting:20260814T170000Z");
    expect(moved!.startIso).toBe("2026-08-14T21:00:00.000Z");
    // The other three occurrences are untouched series occurrences.
    expect(events.filter((e) => !e.title.includes("moved"))).toHaveLength(3);
  });

  it("an orphan RECURRENCE-ID override (series missing) degrades to a standalone event", () => {
    const orphan = normalizedFrom("synthetic-recurrence-override.ics").filter(
      (e) => e.recurrenceId,
    );
    const { events } = expandEvents(orphan, WINDOW_2026H2);
    expect(events).toHaveLength(1);
    expect(events[0].startIso).toBe("2026-08-14T21:00:00.000Z");
  });
});

describe("expandEvents — pass-through", () => {
  it("non-recurring events (incl. all-day) pass through with their keys intact", () => {
    const input = normalizedFrom("synthetic-until-allday.ics").filter((e) => !e.rrule);
    const { events } = expandEvents(input, WINDOW_2026H2);
    expect(events).toHaveLength(1);
    expect(events[0].allDay).toBe(true);
    expect(events[0].occurrenceKey).toBe(input[0].occurrenceKey);
  });
});
