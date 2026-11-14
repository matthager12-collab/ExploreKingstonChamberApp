import { describe, expect, it } from "vitest";
import { draftDedupeKey } from "@/lib/events/member-page-dedupe";

describe("draftDedupeKey", () => {
  it("is stable across case, punctuation and whitespace", () => {
    const a = draftDedupeKey("Jonas Style  Solo!", "2026-11-12T17:30");
    expect(draftDedupeKey("  jonas style solo ", "2026-11-12T19:00")).toBe(a);
    expect(draftDedupeKey("JONAS STYLE SOLO", "2026-11-12T00:00")).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with the title or the date", () => {
    const a = draftDedupeKey("Trivia", "2026-11-12T19:00");
    expect(draftDedupeKey("Trivia Night", "2026-11-12T19:00")).not.toBe(a);
    expect(draftDedupeKey("Trivia", "2026-11-13T19:00")).not.toBe(a);
  });

  it("does not confuse title/date boundaries", () => {
    expect(draftDedupeKey("a 2026", "2026-01-01T10:00")).not.toBe(draftDedupeKey("a", "2026-01-01T10:00"));
  });
});
