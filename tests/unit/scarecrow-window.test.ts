// The crawl window and the map-feature mapping — the two pure pieces the vote
// route leans on. Tested here as well as through the route because these are
// what a wrong date or a stray shape on the map view breaks, and a broken
// window is invisible until the day it matters.

import { describe, expect, it } from "vitest";
import { CRAWL_END, CRAWL_START, crawlPhase, scarecrowsFromFeatures } from "@/lib/data/scarecrows";
import type { MapFeature } from "@/lib/map/types";

const marker = (id: string, title: string, extra: Partial<MapFeature> = {}): MapFeature => ({
  id,
  kind: "marker",
  title,
  views: ["scarecrow-crawl"],
  point: [47.798, -122.497],
  ...extra,
});

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

describe("scarecrowsFromFeatures", () => {
  it("keeps markers, in name order, with their maker and notes", () => {
    const list = scarecrowsFromFeatures([
      marker("b", "Bakery", { notes: "Main Street", creator: "The Preschool" }),
      marker("a", "Antiques"),
    ]);
    expect(list.map((s) => s.title)).toEqual(["Antiques", "Bakery"]);
    expect(list[1].notes).toBe("Main Street");
    // Attribution is its own field, not folded into the notes line.
    expect(list[1].creator).toBe("The Preschool");
    expect(list[0].creator).toBeUndefined();
    expect(list[0].lat).toBe(47.798);
  });

  it("skips anything that is not a placeable marker", () => {
    // A line or area drawn on the view is not a business, and a marker with no
    // point cannot be found — neither belongs on the ballot.
    const list = scarecrowsFromFeatures([
      { id: "route", kind: "trail", title: "Walking route", views: ["scarecrow-crawl"], path: [] },
      { id: "ghost", kind: "marker", title: "No location", views: ["scarecrow-crawl"] },
      marker("real", "A real one"),
    ]);
    expect(list.map((s) => s.id)).toEqual(["real"]);
  });
});
