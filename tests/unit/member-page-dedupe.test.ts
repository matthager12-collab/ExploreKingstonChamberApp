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
});
