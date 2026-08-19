// /itineraries groups its cards into sections (E-content, 2026-08-19). The
// grouping is derived, not stored: multi-day plans are recognised by their
// "Day 1 9:00 AM" stop times, and everything else falls out by `mode`.
//
// The failure this file exists to prevent is a SILENT DROP. The page renders
// section by section, so an itinerary that matches no group would simply not
// appear — no error, no empty state, nothing in CI. That is worse than a crash:
// the Chamber creates an itinerary in the admin builder, it looks saved, and it
// is invisible to visitors. The page guards this with a leftover bucket; these
// tests keep the guard honest.

import { describe, expect, it } from "vitest";

import { GROUPS, groupItineraries, isMultiDay } from "@/app/(site)/itineraries/grouping";
import { itineraries } from "@/lib/data/itineraries";
import type { Itinerary } from "@/lib/types";

describe("/itineraries grouping", () => {
  it("puts every seed itinerary in exactly one group", () => {
    for (const it of itineraries) {
      const matched = GROUPS.filter((g) => g.match(it)).map((g) => g.key);
      expect(matched, `${it.slug} matched ${matched.length} groups: ${matched.join(", ")}`).toHaveLength(1);
    }
  });

  it("recognises multi-day itineraries by their day-prefixed stop times", () => {
    const multi = itineraries.filter(isMultiDay).map((i) => i.slug).sort();
    // Both shipped multi-day plans must be found. If a future itinerary times
    // its stops "Day 1 …", it joins this list automatically — that is the point.
    expect(multi).toContain("north-kitsap-weekend");
    expect(multi).toContain("three-day-north-kitsap");
    for (const slug of multi) {
      const record = itineraries.find((i) => i.slug === slug)!;
      expect(record.stops.some((s) => /^Day\s+\d/i.test(s.time))).toBe(true);
    }
  });

  it("does not mistake a single-day plan for a multi-day one", () => {
    const single = itineraries.find((i) => i.slug === "taste-of-kingston")!;
    expect(isMultiDay(single)).toBe(false);
  });

  it("renders every itinerary exactly once across the sections", () => {
    // The property that actually matters on the page: partition, not just
    // membership. Nothing duplicated, nothing dropped.
    const { groups, leftovers } = groupItineraries(itineraries);
    const shown = [...groups.flatMap((g) => g.items), ...leftovers];
    expect(shown).toHaveLength(itineraries.length);
    expect(new Set(shown).size).toBe(itineraries.length);
    expect(leftovers).toHaveLength(0);
  });

  it("keeps an itinerary no group claims instead of dropping it", () => {
    const rogue: Itinerary = {
      ...itineraries[0],
      id: "rogue",
      slug: "rogue",
      mode: "hovercraft" as Itinerary["mode"],
      stops: [{ time: "9:00 AM", title: "Somewhere", description: "" }],
    };
    const { groups, leftovers } = groupItineraries([...itineraries, rogue]);
    expect(leftovers).toContain(rogue);
    const shown = [...groups.flatMap((g) => g.items), ...leftovers];
    expect(shown).toContain(rogue);
    expect(shown).toHaveLength(itineraries.length + 1);
  });

  it("leaves an unknown mode unmatched, which is why the page keeps a leftover bucket", () => {
    // A record the admin builder should never produce (mode is a schema enum),
    // but the page must survive one anyway — e.g. a future mode added to the
    // schema before this file learns about it. No group claims it here; the
    // page renders it under the last heading rather than dropping it.
    const rogue = {
      ...itineraries[0],
      id: "rogue",
      slug: "rogue",
      mode: "hovercraft" as Itinerary["mode"],
      stops: [{ time: "9:00 AM", title: "Somewhere", description: "" }],
    };
    expect(GROUPS.filter((g) => g.match(rogue))).toHaveLength(0);
  });
});
