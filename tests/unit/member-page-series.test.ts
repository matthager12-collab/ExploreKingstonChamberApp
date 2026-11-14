import { describe, expect, it } from "vitest";

import { buildSeries } from "@/lib/events/member-page-series";
import { isPresetRRule } from "@/lib/events/recurrence";

const r = (kind: string, weekday = "", ordinal = "", date = "") => ({ kind, weekday, ordinal, date });
// 2026-11-13 is a Friday; 2026-11-14 a Saturday.

describe("buildSeries first occurrence", () => {
  it("weekly: today if it matches, else the next matching weekday", () => {
    expect(buildSeries(r("weekly", "FR"), "2026-11-13")).toEqual({ rrule: "FREQ=WEEKLY;BYDAY=FR", date: "2026-11-13" });
    expect(buildSeries(r("weekly", "FR"), "2026-11-14")?.date).toBe("2026-11-20");
    expect(buildSeries(r("weekly", "MO"), "2026-11-14")?.date).toBe("2026-11-16");
  });

  it("biweekly emits the two-week rule", () => {
    expect(buildSeries(r("biweekly", "TU"), "2026-11-13")).toEqual({
      rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU",
      date: "2026-11-17",
    });
  });

  it("monthly Nth weekday: this month if still ahead, else next month", () => {
    expect(buildSeries(r("monthly-weekday", "TH", "1"), "2026-11-13")?.date).toBe("2026-12-03"); // Nov 5 passed
    expect(buildSeries(r("monthly-weekday", "TH", "3"), "2026-11-13")?.date).toBe("2026-11-19");
    expect(buildSeries(r("monthly-weekday", "SA", "2"), "2026-11-13")?.date).toBe("2026-11-14");
    expect(buildSeries(r("monthly-weekday", "SA", "2"), "2026-11-14")?.date).toBe("2026-11-14"); // today counts
    expect(buildSeries(r("monthly-weekday", "SA", "2"), "2026-11-15")?.date).toBe("2026-12-12");
  });

  it("last weekday of the month", () => {
    expect(buildSeries(r("monthly-weekday", "FR", "-1"), "2026-11-13")).toEqual({
      rrule: "FREQ=MONTHLY;BYDAY=-1FR",
      date: "2026-11-27",
    });
    expect(buildSeries(r("monthly-weekday", "FR", "-1"), "2026-11-28")?.date).toBe("2026-12-25");
  });

  it("crosses a year boundary", () => {
    expect(buildSeries(r("monthly-weekday", "TH", "1"), "2026-12-30")?.date).toBe("2027-01-07");
  });

  it("monthly-date uses the model's day of month, skipping short months", () => {
    expect(buildSeries(r("monthly-date", "", "", "2026-10-15"), "2026-11-13")?.date).toBe("2026-11-15");
    expect(buildSeries(r("monthly-date", "", "", "2026-10-15"), "2026-11-16")?.date).toBe("2026-12-15");
    expect(buildSeries(r("monthly-date", "", "", "2026-10-31"), "2026-11-13")?.date).toBe("2026-12-31");
    expect(buildSeries(r("monthly-date", "", "", ""), "2026-11-13")).toBeNull();
  });

  it("every rule it emits passes the preset validator", () => {
    for (const s of [
      buildSeries(r("weekly", "SU"), "2026-11-13"),
      buildSeries(r("biweekly", "SA"), "2026-11-13"),
      buildSeries(r("monthly-weekday", "WE", "4"), "2026-11-13"),
      buildSeries(r("monthly-date", "", "", "2026-11-02"), "2026-11-13"),
    ]) {
      expect(s && isPresetRRule(s.rrule)).toBe(true);
    }
  });

  it("rejects anything outside the presets", () => {
    for (const bad of [
      r("weekly"),
      r("weekly", "ZZ"),
      r("monthly-weekday", "TH", "5"),
      r("monthly-weekday", "TH"),
      r("daily", "MO"),
      r("FREQ=DAILY"),
      r("none"),
    ]) {
      expect(buildSeries(bad, "2026-11-13")).toBeNull();
    }
  });
});
