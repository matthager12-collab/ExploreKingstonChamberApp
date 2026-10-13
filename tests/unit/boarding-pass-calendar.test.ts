import { describe, expect, it } from "vitest";
import { forecastAt } from "@/lib/ferry-forecast";
import { getBoardingPassStatus } from "@/lib/wsf";
import { pacificWallTimeToISO } from "@/lib/time";
import { isBoardingPassSeason } from "@/lib/boarding-pass-season";

// WSDOT: daily operation ends on Indigenous Peoples' Day, the second Monday
// of October, and resumes on Mother's Day, the second Sunday of May.
describe("boarding-pass calendar boundaries", () => {
  it.each([
    [2026, 5, 9, false], [2026, 5, 10, true], [2026, 5, 11, true],
    [2026, 10, 11, true], [2026, 10, 12, true], [2026, 10, 13, false],
    [2027, 5, 8, false], [2027, 5, 9, true], [2027, 5, 10, true],
    [2027, 10, 10, true], [2027, 10, 11, true], [2027, 10, 12, false],
    [2028, 5, 13, false], [2028, 5, 14, true], [2028, 5, 15, true],
    [2028, 10, 8, true], [2028, 10, 9, true], [2028, 10, 10, false],
  ])("season on %i-%i-%i: %s", (year, month, day, expected) => {
    expect(isBoardingPassSeason(year, month, day)).toBe(expected);
  });

  it.each([
    ["2026-10-12", true],
    ["2026-10-13", false],
    ["2026-10-14", false],
    ["2027-10-11", true],
    ["2027-10-12", false],
    ["2028-10-09", true],
    ["2028-10-10", false],
    ["2027-05-07", false],
    ["2027-05-10", true],
    ["2028-05-12", false],
    ["2028-05-15", true],
    ["2026-10-17", true],
    ["2026-11-26", true],
  ])("%s at noon Pacific requires a pass: %s", (day, active) => {
    expect(getBoardingPassStatus(new Date(pacificWallTimeToISO(day, "12:00"))).active).toBe(active);
    expect(forecastAt(day, 12 * 60, "from-kingston", "drive").boardingPassActive).toBe(active);
  });

  it.each(["07:59", "20:00"])("keeps peak-hour limits at %s Pacific", (time) => {
    expect(getBoardingPassStatus(new Date(pacificWallTimeToISO("2026-10-12", time))).active).toBe(false);
    const [hour, minute] = time.split(":").map(Number);
    expect(forecastAt("2026-10-12", hour * 60 + minute, "from-kingston", "drive").boardingPassActive).toBe(false);
  });
});
