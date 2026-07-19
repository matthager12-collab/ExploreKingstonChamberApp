// Lodging schema: parity with the old sanitizeLodging (E07).

import { describe, expect, it } from "vitest";
import { firstZodMessage } from "./shared";
import { lodgingSchema } from "./lodging";

const valid = {
  id: "point-casino-hotel",
  name: "The Point Casino & Hotel",
  type: "hotel",
  description: "Closest full-service hotel rooms to downtown Kingston.",
  tags: ["Closest hotel to the ferry"],
};

function errorOf(record: Record<string, unknown>): string {
  const result = lodgingSchema.safeParse(record);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("unreachable");
  return firstZodMessage(result.error);
}

describe("lodgingSchema", () => {
  it("parses a valid record; empty optionals end up absent", () => {
    const result = lodgingSchema.parse({ ...valid, address: "", website: "", bookingUrl: "" });
    const json = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    expect(Object.hasOwn(json, "address")).toBe(false);
    expect(Object.hasOwn(json, "website")).toBe(false);
    expect(Object.hasOwn(json, "bookingUrl")).toBe(false);
    expect(json.tags).toEqual(["Closest hotel to the ferry"]);
  });

  it("rejects every bad enum value with the exact message", () => {
    expect(errorOf({ ...valid, type: "motel" })).toBe(
      "type must be one of: hotel, vacation-rental, bnb, camping, marina",
    );
    expect(errorOf({ ...valid, type: "" })).toBe(
      "type must be one of: hotel, vacation-rental, bnb, camping, marina",
    );
  });

  it("rejects an invalid optional URL instead of silently dropping it (E07 behavior change)", () => {
    expect(errorOf({ ...valid, website: "foo" })).toBe("website must be an http(s) URL");
    expect(errorOf({ ...valid, bookingUrl: "www.example.com" })).toBe(
      "bookingUrl must be an http(s) URL",
    );
  });

  it("coerces non-array tags to [] (strArray parity)", () => {
    expect(lodgingSchema.parse({ ...valid, tags: "oops" }).tags).toEqual([]);
  });

  it("requires id and name with the exact messages", () => {
    expect(errorOf({ ...valid, id: "bad id" })).toBe(
      "id required: letters, numbers, and dashes (max 64 chars)",
    );
    expect(errorOf({ ...valid, name: "" })).toBe("name required");
  });
});
