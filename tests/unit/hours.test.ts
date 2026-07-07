import { describe, expect, it } from "vitest";
import { getOpenStatus } from "@/lib/hours";
import { pacificWallTimeToISO } from "@/lib/time";
import type { WeeklyHours } from "@/lib/types";

// Characterization tests for getOpenStatus(weekly, now).
// All "now" instants are built from Pacific wall time via pacificWallTimeToISO
// so results are independent of the runner timezone.
//
// Reference weekdays (verified with `date`):
//   2026-01-14 = Wed (PST),  2026-01-13 = Tue,  2026-01-15 = Thu
//   2026-07-15 = Wed (PDT),  2026-07-14 = Tue
//
// WeeklyHours keys are sun..sat; each value is an array of ["HH:MM","HH:MM"]
// spans. A close time <= open time means the span crosses midnight.

/** Build a full WeeklyHours (all days closed) then let callers override days. */
function week(overrides: Partial<WeeklyHours> = {}): WeeklyHours {
  return {
    sun: [],
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    ...overrides,
  };
}

/** A Date at a given Pacific wall time on a given Pacific date. */
function at(dateStr: string, hhmm: string): Date {
  return new Date(pacificWallTimeToISO(dateStr, hhmm));
}

describe("getOpenStatus", () => {
  it("reports open mid-span with a 'closes' label", () => {
    // Wed 11:00–20:00, probe Wed 13:00 -> open, closes 8 pm.
    const w = week({ wed: [["11:00", "20:00"]] });
    const status = getOpenStatus(w, at("2026-01-14", "13:00"));
    expect(status.open).toBe(true);
    expect(status.label).toBe("Open · closes 8 pm");
  });

  it("reports closed with a next-open day-and-time label", () => {
    // Only open Fri; probe Wed (ahead=2) -> "opens Fri <time>".
    const w = week({ fri: [["12:00", "20:00"]] });
    const status = getOpenStatus(w, at("2026-01-14", "13:00"));
    expect(status.open).toBe(false);
    expect(status.label).toBe("Closed · opens Fri 12 pm");
  });

  it("labels the very next day as 'tomorrow' (ahead===1)", () => {
    // Open Thu 09:00; probe Wed -> tomorrow.
    const w = week({ thu: [["09:00", "17:00"]] });
    const status = getOpenStatus(w, at("2026-01-14", "13:00"));
    expect(status.open).toBe(false);
    expect(status.label).toBe("Closed · opens tomorrow 9 am");
  });

  it("labels a later-today opening with just the time (ahead===0)", () => {
    // Open Wed 17:00–20:00; probe Wed 13:00 (before open) -> opens 5 pm.
    const w = week({ wed: [["17:00", "20:00"]] });
    const status = getOpenStatus(w, at("2026-01-14", "13:00"));
    expect(status.open).toBe(false);
    expect(status.label).toBe("Closed · opens 5 pm");
  });

  describe("split day (two spans with a gap)", () => {
    // Wed 11:00–14:00 and 17:00–21:00 (lunch/dinner).
    const w = week({ wed: [["11:00", "14:00"], ["17:00", "21:00"]] });

    it("is closed inside the gap and points to the next span today", () => {
      const status = getOpenStatus(w, at("2026-01-14", "15:00"));
      expect(status.open).toBe(false);
      expect(status.label).toBe("Closed · opens 5 pm");
    });

    it("is open inside the first span", () => {
      const status = getOpenStatus(w, at("2026-01-14", "12:00"));
      expect(status.open).toBe(true);
      expect(status.label).toBe("Open · closes 2 pm");
    });

    it("is open inside the second span", () => {
      const status = getOpenStatus(w, at("2026-01-14", "18:00"));
      expect(status.open).toBe(true);
      expect(status.label).toBe("Open · closes 9 pm");
    });
  });

  it("is open during a past-midnight span at 23:00", () => {
    // Wed 17:00–01:00 crosses midnight; at Wed 23:00 it's open until 1 am.
    const w = week({ wed: [["17:00", "01:00"]] });
    const status = getOpenStatus(w, at("2026-01-14", "23:00"));
    expect(status.open).toBe(true);
    expect(status.label).toBe("Open · closes 1 am");
  });

  it("stays open on the yesterday-tail of a past-midnight span", () => {
    // Tue 17:00–01:00 span; probe Wed 00:30 -> open via yesterday's tail.
    const w = week({ tue: [["17:00", "01:00"]] });
    const status = getOpenStatus(w, at("2026-01-14", "00:30"));
    expect(status.open).toBe(true);
    expect(status.label).toBe("Open · closes 1 am");
  });

  it("treats an empty week ({}-equivalent, all days closed) as closed", () => {
    const status = getOpenStatus(week(), at("2026-01-14", "13:00"));
    expect(status.open).toBe(false);
    expect(status.label).toBe("Closed");
  });

  it("treats a truly empty object as closed (no next opening found)", () => {
    // Cast: the module reads keys defensively with `?? []`, so {} behaves as
    // a fully-closed week even though it isn't a complete WeeklyHours.
    const status = getOpenStatus({} as WeeklyHours, at("2026-01-14", "13:00"));
    expect(status.open).toBe(false);
    expect(status.label).toBe("Closed");
  });

  it("resolves correctly in PST (a January date)", () => {
    // 2026-01-14 is Wed in PST. Open Wed 09:00–17:00, probe 10:00 -> open.
    const w = week({ wed: [["09:00", "17:00"]] });
    const status = getOpenStatus(w, at("2026-01-14", "10:00"));
    expect(status.open).toBe(true);
    expect(status.label).toBe("Open · closes 5 pm");
  });

  it("resolves correctly in PDT (a July date)", () => {
    // 2026-07-15 is Wed in PDT. Same Wed 09:00–17:00 hours, probe 10:00 -> open.
    const w = week({ wed: [["09:00", "17:00"]] });
    const status = getOpenStatus(w, at("2026-07-15", "10:00"));
    expect(status.open).toBe(true);
    expect(status.label).toBe("Open · closes 5 pm");
  });

  describe("label formatting (fmt)", () => {
    it("formats a whole-hour evening time as '8 pm'", () => {
      const w = week({ wed: [["11:00", "20:00"]] });
      const status = getOpenStatus(w, at("2026-01-14", "13:00"));
      expect(status.label).toBe("Open · closes 8 pm");
    });

    it("formats a half-hour morning time as '7:30 am'", () => {
      // Probe before opening so the "opens <time>" branch runs.
      const w = week({ wed: [["07:30", "12:00"]] });
      const status = getOpenStatus(w, at("2026-01-14", "07:00"));
      expect(status.label).toBe("Closed · opens 7:30 am");
    });

    it("formats noon as '12 pm' and midnight-open as '12 am'", () => {
      const noon = getOpenStatus(week({ wed: [["12:00", "23:00"]] }), at("2026-01-14", "10:00"));
      expect(noon.label).toBe("Closed · opens 12 pm");
      const midnight = getOpenStatus(
        week({ wed: [["00:00", "06:00"]] }),
        at("2026-01-14", "03:00"),
      );
      expect(midnight.open).toBe(true);
      expect(midnight.label).toBe("Open · closes 6 am");
    });
  });
});
