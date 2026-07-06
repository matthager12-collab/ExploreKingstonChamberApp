import { describe, expect, it } from "vitest";
import { normalizeEventTimestamp } from "@/lib/time";

describe("normalizeEventTimestamp", () => {
  it("attaches the PDT offset to a naive summer wall time", () => {
    expect(normalizeEventTimestamp("2026-08-01T15:00")).toBe("2026-08-01T15:00:00-07:00");
  });

  it("attaches the PST offset to a naive winter wall time", () => {
    expect(normalizeEventTimestamp("2026-01-15T15:00")).toBe("2026-01-15T15:00:00-08:00");
  });

  it("leaves an already-offset-carrying string unchanged", () => {
    expect(normalizeEventTimestamp("2026-08-01T15:00:00-07:00")).toBe("2026-08-01T15:00:00-07:00");
  });

  it("leaves a Z-suffixed string unchanged", () => {
    expect(normalizeEventTimestamp("2026-08-01T22:00:00Z")).toBe("2026-08-01T22:00:00Z");
  });
});
