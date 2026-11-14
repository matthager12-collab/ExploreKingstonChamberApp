import { describe, expect, it } from "vitest";
import { draftDedupeKey } from "@/lib/events/member-page-dedupe";

describe("draftDedupeKey", () => {
  it("is the start minute only, so a reworded title keeps its key", () => {
    const a = draftDedupeKey("2026-11-12T17:30");
    expect(draftDedupeKey("2026-11-12T17:30-08:00")).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with the date or the time", () => {
    const a = draftDedupeKey("2026-11-12T19:00");
    expect(draftDedupeKey("2026-11-13T19:00")).not.toBe(a);
    expect(draftDedupeKey("2026-11-12T19:30")).not.toBe(a);
  });

  it("untimed one-off: keyed on the date, distinct from a timed event that day", () => {
    const untimed = draftDedupeKey("2026-11-13T00:00", { timeMissing: true });
    expect(draftDedupeKey("2026-11-13T00:00", { timeMissing: true })).toBe(untimed);
    expect(draftDedupeKey("2026-11-14T00:00", { timeMissing: true })).not.toBe(untimed);
    expect(draftDedupeKey("2026-11-13T00:00")).not.toBe(untimed);
  });

  it("series: stable as the first date moves, changes with rule or time", () => {
    const rrule = "FREQ=WEEKLY;BYDAY=FR";
    const a = draftDedupeKey("2026-11-13T18:30", { rrule });
    expect(draftDedupeKey("2026-11-20T18:30", { rrule })).toBe(a);
    expect(draftDedupeKey("2026-11-20T19:00", { rrule })).not.toBe(a);
    expect(draftDedupeKey("2026-11-20T18:30", { rrule: "FREQ=WEEKLY;BYDAY=SA" })).not.toBe(a);
    const untimed = draftDedupeKey("2026-11-13T00:00", { rrule, timeMissing: true });
    expect(draftDedupeKey("2026-11-20T00:00", { rrule, timeMissing: true })).toBe(untimed);
    expect(untimed).not.toBe(a);
  });
});
