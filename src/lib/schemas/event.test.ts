// Event schema: the E12 domain module (docs/SCHEMAS.md "Adding a domain").
// Seed round-trip coverage lives in seeds.test.ts alongside the other domains.

import { describe, expect, it } from "vitest";
import { eventSchema, EVENT_CATEGORIES } from "./event";
import { firstZodMessage } from "./shared";

const valid = {
  id: "july4-fireworks-2026",
  title: "Kingston 4th of July Fireworks Show",
  start: "2026-07-04T22:15:00-07:00",
  end: "2026-07-04T22:35:00-07:00",
  venue: "Appletree Cove (Kingston waterfront)",
  address: "Mike Wallace Park, Kingston, WA 98346",
  description: "The show goes up over Appletree Cove at 10:15 PM.",
  category: "festival",
  organizer: "Greater Kingston Chamber of Commerce",
  url: "https://business.kingstonchamber.com/events/Details/x-1133348",
};

function errorOf(record: Record<string, unknown>): string {
  const result = eventSchema.safeParse(record);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("unreachable");
  return firstZodMessage(result.error);
}

describe("eventSchema", () => {
  it("parses a valid record and round-trips it", () => {
    expect(eventSchema.parse(valid)).toEqual(valid);
  });

  it("accepts the naive datetime-local form the portal submits", () => {
    const parsed = eventSchema.parse({ ...valid, start: "2026-08-01T15:00", end: undefined });
    // Byte-preserved: normalization is the ROUTE's job (normalizeEventTimestamp),
    // never the schema's — parsing must not rewrite stored bytes.
    expect(parsed.start).toBe("2026-08-01T15:00");
    expect("end" in JSON.parse(JSON.stringify(parsed))).toBe(false);
  });

  it("requires title, start, venue, organizer with the exact messages", () => {
    expect(errorOf({ ...valid, title: " " })).toBe("title required");
    expect(errorOf({ ...valid, start: "not-a-date" })).toBe(
      "start must be an ISO date-time (YYYY-MM-DDTHH:mm)",
    );
    expect(errorOf({ ...valid, start: "2026-07-04" })).toBe(
      "start must be an ISO date-time (YYYY-MM-DDTHH:mm)",
    );
    expect(errorOf({ ...valid, venue: "" })).toBe("venue required");
    expect(errorOf({ ...valid, organizer: "" })).toBe("organizer required");
  });

  it("rejects unknown categories with the allowlist message", () => {
    expect(errorOf({ ...valid, category: "bingo" })).toBe(
      `category must be one of: ${EVENT_CATEGORIES.join(", ")}`,
    );
  });

  it("empty optional fields parse to ABSENT keys, not empty strings", () => {
    const parsed = eventSchema.parse({
      ...valid,
      end: "",
      address: "  ",
      url: "",
    });
    const serialized = JSON.parse(JSON.stringify(parsed));
    expect("end" in serialized).toBe(false);
    expect("address" in serialized).toBe(false);
    expect("url" in serialized).toBe(false);
  });

  it("a non-empty invalid url is a 400-with-message, not a silent drop", () => {
    expect(errorOf({ ...valid, url: "foo" })).toBe("url must be an http(s) URL");
  });

  it("description may be blank and coerces to an empty string", () => {
    expect(eventSchema.parse({ ...valid, description: undefined }).description).toBe("");
  });

  it("strips unknown keys (strip mode, parity with the old sanitizers)", () => {
    const parsed = eventSchema.parse({ ...valid, sneaky: "x" }) as Record<string, unknown>;
    expect("sneaky" in parsed).toBe(false);
  });

  it("carries ownership references through untouched", () => {
    const parsed = eventSchema.parse({ ...valid, ownerId: "kingston-ale-house", charityId: "sk9" });
    expect(parsed.ownerId).toBe("kingston-ale-house");
    expect(parsed.charityId).toBe("sk9");
  });
});
