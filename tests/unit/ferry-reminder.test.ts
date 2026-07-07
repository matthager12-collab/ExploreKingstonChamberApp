// Characterization tests for the ferry-reminder ICS builder and the ferry-line
// wait-note parser. These freeze the CURRENT behavior of:
//   - buildFerryIcs / isFerryDir / reminderIcsUrl  (src/lib/ferry-reminder.ts)
//   - parseWaitHours / lineBacksPastBarberCutoff    (src/lib/ferry-line.ts)
//
// Both modules are pure (no fs/db/env), so no mocking is needed. All Dates are
// anchored to Pacific wall time via pacificWallTimeToISO so the golden ICS stamps
// are independent of the runner timezone.

import { describe, expect, it } from "vitest";
import {
  buildFerryIcs,
  isFerryDir,
  reminderIcsUrl,
  REMINDER_LEAD_MIN,
} from "@/lib/ferry-reminder";
import { parseWaitHours, lineBacksPastBarberCutoff } from "@/lib/ferry-line";
import { pacificWallTimeToISO } from "@/lib/time";

// A fixed sailing. Independence from runner TZ: both instants are anchored to
// Pacific wall time. On 2026-07-04 the offset is PDT (-07:00), so:
//   departs 16:30 PDT  == 2026-07-04T23:30:00Z  (getTime 1783207800000)
//   now     15:00 PDT  == 2026-07-04T22:00:00Z
//   end     departs+30min == 2026-07-05T00:00:00Z
const DEPARTS = pacificWallTimeToISO("2026-07-04", "16:30"); // "2026-07-04T16:30:00-07:00"
const NOW = new Date(pacificWallTimeToISO("2026-07-04", "15:00"));

describe("buildFerryIcs — GOLDEN full-output characterization", () => {
  // Captured by running the real module (TZ=UTC) and freezing the exact string.
  // Every load-bearing property below is asserted separately, but this frozen
  // literal is the single source of truth for the whole event.
  const GOLDEN =
    "BEGIN:VCALENDAR\r\n" +
    "VERSION:2.0\r\n" +
    "PRODID:-//Explore Kingston//Ferry Reminder//EN\r\n" +
    "CALSCALE:GREGORIAN\r\n" +
    "METHOD:PUBLISH\r\n" +
    "BEGIN:VEVENT\r\n" +
    "UID:ferry-1783207800000-from-kingston@explorekingstonwa.com\r\n" +
    "DTSTAMP:20260704T220000Z\r\n" +
    "DTSTART:20260704T233000Z\r\n" +
    "DTEND:20260705T000000Z\r\n" +
    "SUMMARY:Ferry: Kingston to Edmonds (4:30 PM)\r\n" +
    "LOCATION:Kingston Ferry Terminal\\, Kingston\\, WA 98346\r\n" +
    "DESCRIPTION:Reminder from Explore Kingston. Head to the terminal about 20 \r\n" +
    " minutes early. When the SR-104 boarding-pass signs are flashing\\, get in \r\n" +
    " the ferry line - don't drive straight to the dock. Live times: https://ex\r\n" +
    " plorekingstonwa.com/ferry\r\n" +
    "BEGIN:VALARM\r\n" +
    "ACTION:DISPLAY\r\n" +
    "DESCRIPTION:Ferry leaves in 20 min - time to head to the dock\r\n" +
    "TRIGGER:-PT20M\r\n" +
    "END:VALARM\r\n" +
    "END:VEVENT\r\n" +
    "END:VCALENDAR\r\n";

  it("emits the exact frozen ICS for a fixed dir/departs/now", () => {
    expect(buildFerryIcs("from-kingston", DEPARTS, NOW)).toBe(GOLDEN);
  });

  const ics = buildFerryIcs("from-kingston", DEPARTS, NOW) as string;

  it("returns a non-null string for a valid sailing", () => {
    expect(ics).not.toBeNull();
    expect(typeof ics).toBe("string");
  });

  it("uses CRLF line endings and no bare LF", () => {
    expect(ics).toContain("\r\n");
    // Every LF in the output is preceded by a CR (no lone \n anywhere).
    expect(/(?<!\r)\n/.test(ics)).toBe(false);
    // Trailing CRLF present.
    expect(ics.endsWith("\r\n")).toBe(true);
  });

  it("wraps the event in BEGIN/END:VCALENDAR and BEGIN/END:VEVENT with a VALARM", () => {
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics).toContain("END:VALARM");
    expect(ics).toContain("TRIGGER:-PT20M");
  });

  it("carries a UID line", () => {
    const uidLine = ics
      .split("\r\n")
      .find((l) => l.startsWith("UID:"));
    expect(uidLine).toBe(
      "UID:ferry-1783207800000-from-kingston@explorekingstonwa.com",
    );
  });

  it("emits UTC DTSTART/DTEND/DTSTAMP in YYYYMMDDTHHMMSSZ form", () => {
    const utcRe = /^\d{8}T\d{6}Z$/;
    for (const key of ["DTSTART", "DTEND", "DTSTAMP"] as const) {
      const line = ics.split("\r\n").find((l) => l.startsWith(key + ":"));
      expect(line, `${key} line present`).toBeDefined();
      const stamp = (line as string).slice(key.length + 1);
      expect(stamp, `${key} stamp shape`).toMatch(utcRe);
    }
    // The specific instants for this fixed sailing.
    expect(ics).toContain("DTSTART:20260704T233000Z");
    expect(ics).toContain("DTEND:20260705T000000Z"); // +30 min crossing
    expect(ics).toContain("DTSTAMP:20260704T220000Z"); // from `now`
  });

  it("folds every content line to at most 75 octets (RFC 5545 §3.1)", () => {
    for (const line of ics.split("\r\n")) {
      // ASCII-only content, so byte length == char length.
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
  });

  it("escapes commas per RFC 5545 TEXT rules in the LOCATION field", () => {
    // The address "Kingston Ferry Terminal, Kingston, WA 98346" has its commas
    // escaped as \, in the emitted LOCATION.
    expect(ics).toContain(
      "LOCATION:Kingston Ferry Terminal\\, Kingston\\, WA 98346",
    );
    // A raw (unescaped) comma must never appear in the LOCATION segment: every
    // comma is preceded by a backslash. Grab the segment and check no comma is
    // un-escaped (i.e. not immediately preceded by a backslash).
    const locSegment = ics.slice(
      ics.indexOf("LOCATION:"),
      ics.indexOf("DESCRIPTION:"),
    );
    expect(/(?<!\\),/.test(locSegment)).toBe(false);
  });

  it("escapes an embedded comma inside the DESCRIPTION body", () => {
    // "...signs are flashing, get in..." → the comma is escaped as \, even
    // across the line fold.
    expect(ics).toContain("flashing\\,");
  });

  it("SUMMARY carries the Pacific-formatted departure time", () => {
    // formatPacificTime(DEPARTS) == "4:30 PM" for 16:30 PDT.
    expect(ics).toContain("SUMMARY:Ferry: Kingston to Edmonds (4:30 PM)");
  });

  it("VALARM fires REMINDER_LEAD_MIN before departure", () => {
    expect(REMINDER_LEAD_MIN).toBe(20);
    expect(ics).toContain(`TRIGGER:-PT${REMINDER_LEAD_MIN}M`);
  });

  it("produces a distinct label/UID/address for the to-kingston direction", () => {
    const rev = buildFerryIcs("to-kingston", DEPARTS, NOW) as string;
    expect(rev).toContain("SUMMARY:Ferry: Edmonds to Kingston (4:30 PM)");
    expect(rev).toContain(
      "UID:ferry-1783207800000-to-kingston@explorekingstonwa.com",
    );
    expect(rev).toContain("LOCATION:Edmonds Ferry Terminal\\, Edmonds\\, WA 98020");
  });
});

describe("buildFerryIcs — year-range and validity guard", () => {
  it("returns null for a garbage/unparseable departs", () => {
    expect(buildFerryIcs("from-kingston", "not-a-date", NOW)).toBeNull();
    expect(buildFerryIcs("from-kingston", "", NOW)).toBeNull();
  });

  it("returns null for a far-future out-of-range year (> 9999)", () => {
    // A 6-digit extended year is outside RFC 5545's 4-digit DATE-TIME range.
    expect(buildFerryIcs("from-kingston", "+012026-07-04T16:30:00Z", NOW)).toBeNull();
    // JS max Date instant (year ~275760) is likewise rejected.
    expect(
      buildFerryIcs("from-kingston", new Date(8.64e15).toISOString(), NOW),
    ).toBeNull();
  });

  it("returns null for a far-past out-of-range year (< 1)", () => {
    // Year 0000 is < 1 → rejected. Build it as an explicit UTC instant.
    expect(buildFerryIcs("from-kingston", "0000-06-15T12:00:00Z", NOW)).toBeNull();
  });

  it("still builds for an in-range year at the low edge (year 1)", () => {
    const ics = buildFerryIcs("from-kingston", "0001-06-15T12:00:00Z", NOW);
    expect(ics).not.toBeNull();
    expect(ics as string).toContain("DTSTART:00010615T120000Z");
  });
});

describe("isFerryDir", () => {
  it("accepts the two canonical directions", () => {
    expect(isFerryDir("from-kingston")).toBe(true);
    expect(isFerryDir("to-kingston")).toBe(true);
  });

  it("rejects other strings, null, and non-strings", () => {
    expect(isFerryDir("north")).toBe(false);
    expect(isFerryDir(null)).toBe(false);
    expect(isFerryDir(42)).toBe(false);
    expect(isFerryDir(undefined)).toBe(false);
    expect(isFerryDir("From-Kingston")).toBe(false); // case-sensitive
  });
});

describe("reminderIcsUrl", () => {
  it("builds a query-encoded /api/ferry/reminder link", () => {
    expect(reminderIcsUrl("from-kingston", DEPARTS)).toBe(
      "/api/ferry/reminder?dir=from-kingston&departs=2026-07-04T16%3A30%3A00-07%3A00",
    );
  });
});

describe("parseWaitHours — grammar characterization table", () => {
  // Each row is the value the CURRENT code returns. Notable, non-obvious facts:
  //  - Only an "hour" token counts; there is NO minutes grammar, so "90 min"
  //    and "90 minute wait" both return null.
  //  - "2+ hour" nudges just over 2 → 2.1 (routes drivers past Barber Cutoff).
  //  - The separator between a word and "hour" is optional ([\s-]?), so glued
  //    forms "twohour"/"sixhour" still match; but "seven"+ isn't in the table.
  //  - It returns the MAX hour figure mentioned in the note.
  const table: Array<[string | null | undefined, number | null]> = [
    ["2 hour wait", 2],
    ["2-hour wait", 2],
    ["2.5 hour wait", 2.5],
    ["2+ hour wait", 2.1],
    ["Two Hour Wait for Drivers", 2],
    ["three-hour wait", 3],
    ["90 min", null],
    ["90 minute wait", null],
    ["1 hour and 30 min", 1],
    ["", null],
    [null, null],
    [undefined, null],
    ["no wait right now", null],
    ["3-hour wait, backups on SR-104", 3],
    ["one hour then two hour later", 2], // max of 1 and 2
    ["2 hour wait, then 3 hour wait", 3], // max of 2 and 3
    ["six hour wait", 6],
    ["seven hour wait", null], // seven not in HOUR_WORDS
    ["0.5 hour", 0.5],
    ["2 + hour", 2.1], // spaces around the + are tolerated
    ["hourly ferry service", null], // "hour" without a leading count
    ["twohour", 2], // optional separator → glued word form matches
    ["sixhour", 6],
  ];

  for (const [input, expected] of table) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(parseWaitHours(input)).toBe(expected);
    });
  }
});

describe("lineBacksPastBarberCutoff", () => {
  it("is true only when the parsed wait is strictly over 2 hours", () => {
    expect(lineBacksPastBarberCutoff("3 hour wait")).toBe(true);
    expect(lineBacksPastBarberCutoff("2.5 hour wait")).toBe(true);
    expect(lineBacksPastBarberCutoff("2+ hour wait")).toBe(true); // 2.1 > 2
  });

  it("is false at exactly 2 hours, below, or with no parseable wait", () => {
    expect(lineBacksPastBarberCutoff("2 hour wait")).toBe(false); // not strictly > 2
    expect(lineBacksPastBarberCutoff("1 hour wait")).toBe(false);
    expect(lineBacksPastBarberCutoff("90 min")).toBe(false); // parses to null
    expect(lineBacksPastBarberCutoff(null)).toBe(false);
    expect(lineBacksPastBarberCutoff(undefined)).toBe(false);
    expect(lineBacksPastBarberCutoff("")).toBe(false);
  });
});
