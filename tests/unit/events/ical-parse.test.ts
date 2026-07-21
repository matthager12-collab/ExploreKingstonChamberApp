// E12 pure core: iCal tokenizer suite. Real ChamberMaster fixtures plus
// synthetics for the shapes the Chamber feed hasn't (yet) shown us.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseContentLine,
  parseICalDate,
  parseICalendar,
  unescapeText,
  unfoldLines,
} from "@/lib/events/ical-parse";

const fixture = (name: string): string =>
  readFileSync(path.join(__dirname, "fixtures", name), "utf8");

describe("unfoldLines", () => {
  it("joins CRLF+space and LF+tab continuations, stripping exactly the marker char", () => {
    // §3.1: unfolding removes CRLF + ONE whitespace char. A space belonging to
    // the content survives only if the emitter wrote marker + space ("  ").
    expect(unfoldLines("A:one\r\n  two\r\nB:three\n\tfour")).toEqual(["A:one two", "B:threefour"]);
  });

  it("handles folded long lines from the committed fixture without splitting words", () => {
    const lines = unfoldLines(fixture("synthetic-folded-escaped.ics"));
    const desc = lines.find((l) => l.startsWith("DESCRIPTION:"));
    expect(desc).toContain("Second line continues café énergie");
    expect(desc).toContain("seventy-five octets total.");
  });
});

describe("parseContentLine", () => {
  it("splits NAME;PARAM=VALUE:VALUE and uppercases names/params", () => {
    expect(parseContentLine("DTSTART;TZID=America/Los_Angeles:20260722T183000")).toEqual({
      name: "DTSTART",
      params: { TZID: "America/Los_Angeles" },
      value: "20260722T183000",
    });
  });

  it("keeps colons inside quoted params out of the name/value split", () => {
    const parsed = parseContentLine('X-URL;ALTREP="http://a:b/c;d":the-value');
    expect(parsed?.params.ALTREP).toBe("http://a:b/c;d");
    expect(parsed?.value).toBe("the-value");
  });
});

describe("unescapeText", () => {
  it("unescapes \\n \\, \\; \\\\ per §3.3.11", () => {
    expect(unescapeText("a\\, b\\; c\\nD \\\\ e")).toBe("a, b; c\nD \\ e");
  });
});

describe("parseICalDate", () => {
  it("TZID wall time converts to the correct Pacific instant", () => {
    expect(parseICalDate("20260701T090000", { TZID: "America/Los_Angeles" })?.iso).toBe(
      "2026-07-01T16:00:00.000Z",
    );
  });

  it("Zulu form is taken as UTC directly", () => {
    expect(parseICalDate("20260701T160000Z", {})?.iso).toBe("2026-07-01T16:00:00.000Z");
  });

  it("VALUE=DATE all-day form anchors to Pacific midnight and keeps the date", () => {
    const dt = parseICalDate("20260815", { VALUE: "DATE" });
    expect(dt?.dateOnly).toBe("2026-08-15");
    expect(dt?.iso).toBe("2026-08-15T07:00:00.000Z");
  });

  it("rejects garbage", () => {
    expect(parseICalDate("not-a-date", {})).toBeNull();
  });
});

describe("parseICalendar", () => {
  it("parses the real ChamberMaster fixture: UID, TZID start, TTL-lagged feed shape", () => {
    const { events, warnings } = parseICalendar(fixture("ams-grand-hallway-art-show-1770249.ics"));
    expect(warnings).toEqual([]);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.uid).toBe("e.3508.1493103");
    expect(e.summary).toBe("Grand Hallway Art Show");
    expect(e.start?.iso).toBe("2026-07-01T16:00:00.000Z");
    expect(e.end?.iso).toBe("2026-09-01T01:00:00.000Z");
    expect(e.allDay).toBe(false);
    expect(e.url).toContain("business.kingstonchamber.com/events/Details/");
  });

  it("does NOT read VTIMEZONE transition rules as event recurrence (the trap)", () => {
    // The real fixture's VTIMEZONE block carries two RRULE: lines (DST rules).
    const { events } = parseICalendar(fixture("ams-grand-hallway-art-show-1770249.ics"));
    expect(events[0].rrule).toBeUndefined();
  });

  it("collects multi-line, multi-value EXDATE with TZID", () => {
    const { events } = parseICalendar(fixture("synthetic-weekly-exdate.ics"));
    expect(events[0].rrule).toBe("FREQ=WEEKLY;BYDAY=WE;COUNT=8");
    expect(events[0].exdates).toEqual([
      "2026-08-13T01:30:00.000Z", // 2026-08-12 18:30 PDT
      "2026-09-03T01:30:00.000Z",
      "2026-09-10T01:30:00.000Z",
    ]);
  });

  it("reads RECURRENCE-ID as the ORIGINAL occurrence start", () => {
    const { events } = parseICalendar(fixture("synthetic-recurrence-override.ics"));
    const override = events.find((e) => e.recurrenceId);
    expect(override?.recurrenceId).toBe("2026-08-14T17:00:00.000Z"); // 10:00 PDT original
    expect(override?.start?.iso).toBe("2026-08-14T21:00:00.000Z"); // 14:00 PDT moved
  });

  it("flags VALUE=DATE events as all-day", () => {
    const { events } = parseICalendar(fixture("synthetic-until-allday.ics"));
    const allDay = events.find((e) => e.uid === "e.9999.bluegrass-festival");
    expect(allDay?.allDay).toBe(true);
    expect(allDay?.start?.dateOnly).toBe("2026-08-15");
  });

  it("unescapes folded TEXT values (commas, semicolons, newlines, UTF-8)", () => {
    const { events } = parseICalendar(fixture("synthetic-folded-escaped.ics"));
    const e = events[0];
    expect(e.summary).toBe("Wine, Cheese; and Chocolate Café Evening");
    expect(e.location).toBe("Café on the Cove, Kingston");
    expect(e.description).toBe(
      "Crème brûlée, smörgåsbord; a backslash \\ then a newline:\n" +
        "Second line continues café énergie with enough length to exceed seventy-five octets total.",
    );
  });

  it("soft-404 HTML parses to zero events, never a throw (truth-triple backstop)", () => {
    const { events } = parseICalendar(fixture("soft-404.html"));
    expect(events).toEqual([]);
  });

  it("skips a VEVENT with no DTSTART, with a warning, and keeps the rest", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:No start",
      "UID:broken-1",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART:20260801T100000Z",
      "SUMMARY:Fine",
      "UID:ok-1",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const { events, warnings } = parseICalendar(text);
    expect(events.map((e) => e.uid)).toEqual(["ok-1"]);
    expect(warnings.some((w) => w.includes("broken-1"))).toBe(true);
  });
});
