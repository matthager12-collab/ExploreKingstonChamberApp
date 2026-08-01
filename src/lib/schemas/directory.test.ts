// Directory schema (E17): the write gate for imported + hand-created
// directory listings. Message-verbatim per the E07 convention.

import { describe, expect, it } from "vitest";
import { firstZodMessage } from "./shared";
import { DIRECTORY_DESCRIPTION_MAX, directoryListingSchema } from "./directory";

const valid = {
  id: "kingston-mercantile",
  name: "Kingston Mercantile & Marine",
  category: "shop",
  description: "Marine supplies, hardware, and gifts a block from the ferry.",
  tags: ["Downtown"],
};

function errorOf(record: Record<string, unknown>): string {
  const result = directoryListingSchema.safeParse(record);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("unreachable");
  return firstZodMessage(result.error);
}

describe("directoryListingSchema", () => {
  it("parses a valid record; empty optionals end up absent after JSON round-trip", () => {
    const result = directoryListingSchema.parse({
      ...valid,
      address: "",
      phone: "",
      website: "",
    });
    const json = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    expect(Object.hasOwn(json, "address")).toBe(false);
    expect(Object.hasOwn(json, "phone")).toBe(false);
    expect(Object.hasOwn(json, "website")).toBe(false);
    expect(json.tags).toEqual(["Downtown"]);
  });

  it("rejects a bad category with the exact message", () => {
    const message =
      "category must be one of: eat, stay, shop, services, activities, community, other";
    expect(errorOf({ ...valid, category: "retail" })).toBe(message);
    expect(errorOf({ ...valid, category: "" })).toBe(message);
  });

  it("rejects an invalid optional URL instead of silently dropping it", () => {
    expect(errorOf({ ...valid, website: "foo" })).toBe("website must be an http(s) URL");
  });

  it("caps the description at the documented maximum", () => {
    const long = "x".repeat(DIRECTORY_DESCRIPTION_MAX + 1);
    expect(errorOf({ ...valid, description: long })).toBe(
      `description must be ${DIRECTORY_DESCRIPTION_MAX} characters or fewer`,
    );
    // At the cap exactly: fine.
    expect(
      directoryListingSchema.safeParse({
        ...valid,
        description: "x".repeat(DIRECTORY_DESCRIPTION_MAX),
      }).success,
    ).toBe(true);
  });

  it("coerces non-array tags to [] (strArray parity)", () => {
    expect(directoryListingSchema.parse({ ...valid, tags: "oops" }).tags).toEqual([]);
  });

  it("keeps import provenance fields intact and drops unknown keys (strip mode)", () => {
    const parsed = directoryListingSchema.parse({
      ...valid,
      sourceCategories: ["Retail Shops", "Marine"],
      sourceImages: { logo: "https://res.cloudinary.com/qwick/x.png" },
      isPromoted: true,
    });
    expect(parsed.sourceCategories).toEqual(["Retail Shops", "Marine"]);
    expect(parsed.sourceImages?.logo).toBe("https://res.cloudinary.com/qwick/x.png");
    expect(Object.hasOwn(parsed, "isPromoted")).toBe(false);
  });

  it("requires name and a well-formed id", () => {
    expect(errorOf({ ...valid, name: " " })).toBe("name required");
    const badId = directoryListingSchema.safeParse({ ...valid, id: "-nope" });
    expect(badId.success).toBe(false);
  });
});
