// Itinerary schema + the pure slug-clash helper: parity with the old
// sanitizeItinerary (E07). The slug-clash rule itself needs a store read and
// lives in the route; findItinerarySlugClash is its unit-testable core.

import { describe, expect, it } from "vitest";
import type { Itinerary } from "@/lib/types";
import { firstZodMessage } from "./shared";
import { findItinerarySlugClash, itinerarySchema } from "./itinerary";

const valid = {
  id: "walk-on-wander",
  slug: "walk-on-wander",
  title: "The Walk-On Wander",
  tagline: "No car, no problem.",
  duration: "About 5 hours",
  mode: "walk-on",
  audience: ["Couples", "Solo travelers"],
  stops: [
    { time: "9:40 AM", title: "Walk off the ferry", description: "Start at the dock." },
    { time: "10:15 AM", title: "Coffee", description: "", mapQuery: "Kingston coffee" },
  ],
};

function errorOf(record: Record<string, unknown>): string {
  const result = itinerarySchema.safeParse(record);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("unreachable");
  return firstZodMessage(result.error);
}

describe("itinerarySchema", () => {
  it("parses a valid record and lowercases the slug", () => {
    const result = itinerarySchema.parse({ ...valid, slug: "Walk-On-Wander" });
    expect(result.slug).toBe("walk-on-wander");
    expect(result.stops).toHaveLength(2);
  });

  it("strips client-only stop fields and omits empty mapQuery", () => {
    const result = itinerarySchema.parse({
      ...valid,
      stops: [{ key: "stop-abc123", time: "", title: "Start", description: "", mapQuery: "" }],
    });
    const stop = JSON.parse(JSON.stringify(result.stops[0])) as Record<string, unknown>;
    expect(Object.hasOwn(stop, "key")).toBe(false);
    expect(Object.hasOwn(stop, "mapQuery")).toBe(false);
    expect(stop).toEqual({ time: "", title: "Start", description: "" });
  });

  it("rejects with the exact stop messages", () => {
    expect(errorOf({ ...valid, stops: [] })).toBe("at least one stop required");
    expect(errorOf({ ...valid, stops: "nope" })).toBe("at least one stop required");
    expect(errorOf({ ...valid, stops: [valid.stops[0], { title: "  " }] })).toBe(
      "stop 2 needs a title",
    );
    expect(errorOf({ ...valid, stops: ["nope"] })).toBe("stop 1 is malformed");
  });

  it("rejects bad slug, title, and mode with the exact messages", () => {
    expect(errorOf({ ...valid, slug: "no spaces" })).toBe(
      "slug required: lowercase letters, numbers, and dashes (e.g. beach-day)",
    );
    expect(errorOf({ ...valid, title: "" })).toBe("title required");
    expect(errorOf({ ...valid, mode: "bike" })).toBe("mode must be walk-on, car, or either");
  });

  it("coerces non-array audience to [] (strArray parity)", () => {
    expect(itinerarySchema.parse({ ...valid, audience: "Couples" }).audience).toEqual([]);
  });
});

describe("findItinerarySlugClash", () => {
  const mk = (id: string, slug: string): Itinerary => ({
    id,
    slug,
    title: `Title of ${id}`,
    tagline: "",
    duration: "",
    mode: "either",
    audience: [],
    stops: [{ time: "", title: "Stop", description: "" }],
  });

  it("finds a different record holding the same slug", () => {
    const clash = findItinerarySlugClash([mk("a", "beach-day"), mk("b", "car-day")], mk("c", "beach-day"));
    expect(clash?.id).toBe("a");
  });

  it("does not flag the record itself, or unrelated slugs", () => {
    expect(findItinerarySlugClash([mk("a", "beach-day")], mk("a", "beach-day"))).toBeUndefined();
    expect(findItinerarySlugClash([mk("a", "beach-day")], mk("b", "car-day"))).toBeUndefined();
  });
});
