// The crawl window and the id allowlist — the two pure gates the vote route
// leans on. Tested here as well as through the route because these are what a
// wrong date or a renamed scarecrow breaks, and a broken window is invisible
// until the day it matters.

import { describe, expect, it } from "vitest";
import { CRAWL_END, CRAWL_START, SCARECROWS, crawlPhase, scarecrowById } from "@/lib/data/scarecrows";

describe("crawlPhase", () => {
  it("is closed before the start and after the end, open in between", () => {
    expect(crawlPhase(new Date("2026-10-16T23:59:59-07:00"))).toBe("before");
    expect(crawlPhase(new Date(CRAWL_START))).toBe("open");
    expect(crawlPhase(new Date("2026-10-24T12:00:00-07:00"))).toBe("open");
    expect(crawlPhase(new Date(CRAWL_END))).toBe("open");
    expect(crawlPhase(new Date("2026-10-31T17:00:01-07:00"))).toBe("closed");
  });

  it("closes at 5pm Pacific on the final Saturday, not at midnight", () => {
    // The Chamber's flyer says 5pm. A window that ran to end-of-day would
    // still look right in every other test.
    expect(crawlPhase(new Date("2026-10-31T16:59:00-07:00"))).toBe("open");
    expect(crawlPhase(new Date("2026-10-31T18:00:00-07:00"))).toBe("closed");
  });
});

describe("scarecrowById", () => {
  it("finds a seeded scarecrow and refuses anything else", () => {
    expect(scarecrowById(SCARECROWS[0].id)?.id).toBe(SCARECROWS[0].id);
    expect(scarecrowById("not-a-scarecrow")).toBeUndefined();
    expect(scarecrowById("")).toBeUndefined();
  });

  it("has no duplicate ids — a duplicate would split or merge votes", () => {
    const ids = SCARECROWS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
