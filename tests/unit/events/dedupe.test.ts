// E12 pure core: cross-source dedupe. The success metric from the
// reconciliation: July 4th shows exactly once. Includes the RE-CHARTER
// delta-4 absent-source case (the post-cancellation world without ams-ical)
// and the idempotent re-merge invariant.

import { describe, expect, it } from "vitest";
import {
  mergeCalendar,
  normalizeTitle,
  reviewClusters,
  type DedupeOverride,
} from "@/lib/events/dedupe";
import type { EventSource, NormalizedEvent } from "@/lib/events/types";

function ev(partial: Partial<NormalizedEvent> & { source: EventSource; externalId: string }): NormalizedEvent {
  const startIso = partial.startIso ?? "2026-07-05T05:15:00.000Z"; // 7/4 22:15 PDT
  return {
    title: "Kingston 4th of July Fireworks Show",
    allDay: false,
    venue: "Mike Wallace Park",
    description: "",
    occurrenceKey: `${partial.source}:${partial.externalId}:${startIso.replace(/[-:]/g, "").replace(".000Z", "Z")}`,
    ...partial,
    startIso,
  };
}

describe("normalizeTitle", () => {
  it("folds case, punctuation, diacritics, leading articles, whitespace", () => {
    expect(normalizeTitle("The  Kingston 4th-of-July  Car Show!")).toBe(
      "kingston 4th of july car show",
    );
    expect(normalizeTitle("Café Récital")).toBe("cafe recital");
  });
});

describe("mergeCalendar — stable-ID pass", () => {
  it("UID dedupe: an alias carried from a prior merge re-clusters the same iCal UID", () => {
    const inApp = ev({
      source: "in-app",
      externalId: "july4-fireworks-2026",
      title: "Fireworks (in-app title, edited)",
      aliases: [{ source: "ams-ical", externalId: "e.3508.1133348" }],
    });
    const ams = ev({
      source: "ams-ical",
      externalId: "e.3508.1133348",
      title: "Completely Different Wording", // fuzzy would NOT match
      venue: "Somewhere Else",
    });
    const merged = mergeCalendar([inApp, ams]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("in-app");
  });

  it("global_id dedupe: two ingests of the same Tribe event share their global_id", () => {
    const a = ev({ source: "tribe-portofkingston", externalId: "portofkingston.org?id=18775" });
    const b = ev({
      source: "tribe-portofkingston",
      externalId: "portofkingston.org?id=18775",
      title: "Retitled After Edit",
      venue: "",
    });
    expect(mergeCalendar([a, b])).toHaveLength(1);
  });

  it("occurrences of one series on DIFFERENT days never cluster by shared UID", () => {
    const week1 = ev({
      source: "ams-ical",
      externalId: "e.9999.weekly",
      title: "Weekly Trivia",
      startIso: "2026-08-06T01:30:00.000Z",
    });
    const week2 = ev({
      source: "ams-ical",
      externalId: "e.9999.weekly",
      title: "Weekly Trivia",
      startIso: "2026-08-13T01:30:00.000Z",
    });
    expect(mergeCalendar([week1, week2])).toHaveLength(2);
  });
});

describe("mergeCalendar — fuzzy pass", () => {
  it("fuzzy match hit: seed phrasing vs AMS phrasing, same day, overlapping venue", () => {
    const inApp = ev({
      source: "in-app",
      externalId: "july4-fireworks-2026",
      title: "Kingston 4th of July Fireworks Show",
      venue: "Appletree Cove (Kingston waterfront)",
    });
    const ams = ev({
      source: "ams-ical",
      externalId: "e.3508.1133348",
      title: "The Kingston 4th of July Fireworks Show!",
      venue: "Kingston Waterfront",
    });
    const merged = mergeCalendar([inApp, ams]);
    expect(merged).toHaveLength(1);
    expect(merged[0].externalId).toBe("july4-fireworks-2026");
  });

  it("fuzzy match hit: an empty venue is a wildcard (AMS LOCATION is often blank)", () => {
    const a = ev({ source: "in-app", externalId: "x", venue: "Mike Wallace Park" });
    const b = ev({ source: "ams-ical", externalId: "y", venue: "" });
    expect(mergeCalendar([a, b])).toHaveLength(1);
  });

  it("fuzzy near-miss: same title on a DIFFERENT Pacific day must NOT merge (weekly market)", () => {
    const sun1 = ev({
      source: "in-app",
      externalId: "public-market-2026-07-05",
      title: "Kingston Public Market",
      startIso: "2026-07-05T17:00:00.000Z",
    });
    const sun2 = ev({
      source: "tribe-portofkingston",
      externalId: "portofkingston.org?id=18775",
      title: "Kingston Public Market",
      startIso: "2026-07-12T17:00:00.000Z",
    });
    expect(mergeCalendar([sun1, sun2])).toHaveLength(2);
  });

  it("fuzzy near-miss: same title, same day, disjoint venues must NOT merge", () => {
    const a = ev({ source: "in-app", externalId: "x", title: "Live Music", venue: "Kingston Ale House" });
    const b = ev({ source: "ams-ical", externalId: "y", title: "Live Music", venue: "Filling Station" });
    expect(mergeCalendar([a, b])).toHaveLength(2);
  });
});

describe("mergeCalendar — precedence", () => {
  const inApp = () => ev({ source: "in-app", externalId: "july4" });
  const ams = () => ev({ source: "ams-ical", externalId: "e.3508.1133348" });
  const tribe = () => ev({ source: "tribe-portofkingston", externalId: "portofkingston.org?id=1" });

  it("precedence: the in-app record wins its cluster (in-app > ams-ical > tribe)", () => {
    const merged = mergeCalendar([tribe(), ams(), inApp()]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("in-app");
    // Survivor carries the losers' identities for stable future ingests.
    expect(merged[0].aliases).toEqual(
      expect.arrayContaining([
        { source: "ams-ical", externalId: "e.3508.1133348" },
        { source: "tribe-portofkingston", externalId: "portofkingston.org?id=1" },
      ]),
    );
  });

  it("precedence: ams-ical beats tribe when in-app is absent from the cluster", () => {
    const merged = mergeCalendar([tribe(), ams()]);
    expect(merged[0].source).toBe("ams-ical");
  });

  it("absent-source case (delta 4): the same input minus every ams-ical event still merges, in-app > tribe", () => {
    const withAms = [inApp(), ams(), tribe()];
    const postCancellation = withAms.filter((e) => e.source !== "ams-ical");
    const merged = mergeCalendar(postCancellation);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("in-app");
    // And a tribe-only cluster survives as tribe — no code path needs ams-ical.
    expect(mergeCalendar([tribe()])[0].source).toBe("tribe-portofkingston");
  });
});

describe("mergeCalendar — admin overrides", () => {
  const inApp = () => ev({ source: "in-app", externalId: "july4" });
  const ams = () => ev({ source: "ams-ical", externalId: "e.3508.1133348" });

  it("a not-a-duplicate verdict splits the cluster", () => {
    const overrides: DedupeOverride[] = [
      { keyA: inApp().occurrenceKey, keyB: ams().occurrenceKey, verdict: "not-duplicate" },
    ];
    expect(mergeCalendar([inApp(), ams()])).toHaveLength(1);
    expect(mergeCalendar([inApp(), ams()], overrides)).toHaveLength(2);
  });

  it("a not-a-duplicate pair cannot be re-joined transitively through a third event", () => {
    const bridge = ev({ source: "tribe-portofkingston", externalId: "bridge", venue: "" });
    const overrides: DedupeOverride[] = [
      { keyA: inApp().occurrenceKey, keyB: ams().occurrenceKey, verdict: "not-duplicate" },
    ];
    const merged = mergeCalendar([inApp(), ams(), bridge], overrides);
    // Bridge fuzzy-matches both, but the verdict keeps in-app and ams apart:
    // exactly two survivors, and they are the overridden pair's two sides.
    expect(merged).toHaveLength(2);
    const sources = merged.map((m) => m.source).sort();
    expect(sources).toEqual(["ams-ical", "in-app"]);
  });

  it("reviewClusters lists only multi-member clusters for the admin UI", () => {
    const solo = ev({ source: "in-app", externalId: "solo", title: "Unrelated", startIso: "2026-09-01T17:00:00.000Z" });
    const clusters = reviewClusters([inApp(), ams(), solo], []);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toHaveLength(2);
    expect(clusters[0].survivor.source).toBe("in-app");
  });
});

describe("mergeCalendar — idempotent re-merge", () => {
  it("idempotent: merging the merged output with a fresh ingest of the same feed is a no-op", () => {
    const inApp = ev({ source: "in-app", externalId: "july4", venue: "Mike Wallace Park" });
    const ams = ev({ source: "ams-ical", externalId: "e.3508.1133348", title: "The Kingston 4th of July Fireworks Show" });
    const firstMerge = mergeCalendar([inApp, ams]);
    expect(firstMerge).toHaveLength(1);
    // Next ingest run: the stored survivor (with aliases) + the same AMS
    // event again. The alias makes pass 1 re-cluster them even if the title
    // wording has drifted apart in the meantime.
    const drifted = { ...ams, title: "Fireworks Extravaganza (renamed upstream)" };
    const secondMerge = mergeCalendar([...firstMerge, drifted]);
    expect(secondMerge).toEqual(firstMerge);
  });
});
