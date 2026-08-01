// Listing photos: the schema half of images[] on restaurants and lodging.
//
// The rules pinned here are the ones that keep a listing SAVEABLE and a card
// HONEST — both are failure modes that only show up with real, slightly-messy
// data, which is exactly when nobody is looking.

import { describe, expect, it } from "vitest";
import { lodgingSchema } from "@/lib/schemas/lodging";
import { restaurantSchema } from "@/lib/schemas/restaurant";
import { restaurantFields } from "@/lib/schemas/restaurant";
import { lodgingFields } from "@/lib/schemas/lodging";

const NAME = "abcdef0123456789.jpg";

const restaurant = (over: Record<string, unknown> = {}) => ({
  id: "fern-and-fig",
  name: "Fern & Fig",
  cuisine: "Italian",
  description: "",
  address: "1 Main St",
  tags: [],
  priceLevel: 2,
  lat: 47.797,
  lng: -122.496,
  walkMinutesFromFerry: 3,
  ...over,
});

describe("images[] on a listing", () => {
  it("keeps valid library names in the order given", () => {
    const second = "0011223344556677.webp";
    const parsed = restaurantSchema.parse(restaurant({ images: [NAME, second] }));
    // Order is the product decision: the first entry is the card photo.
    expect(parsed.images).toEqual([NAME, second]);
  });

  it("omits the field entirely when empty, rather than storing []", () => {
    // Matches how the editor drops empty optionals, and is what makes the
    // inferred type line up with `images?: string[]` in type-parity.ts.
    expect(restaurantSchema.parse(restaurant({ images: [] })).images).toBeUndefined();
    expect(restaurantSchema.parse(restaurant()).images).toBeUndefined();
  });

  it("DROPS junk entries instead of refusing the save", () => {
    // The important one. A listing must not become unsaveable because a photo
    // it referenced was removed or a record was hand-edited — the editor would
    // then reject every save, on a form showing no way to fix it. Dropping is
    // self-healing: the next save cleans the record up.
    const parsed = restaurantSchema.parse(
      restaurant({ images: [NAME, "not-a-name", "", "../../etc/passwd", 42, null] }),
    );
    expect(parsed.images).toEqual([NAME]);
  });

  it("drops a path-traversal attempt rather than passing it to the image route", () => {
    const parsed = restaurantSchema.parse(restaurant({ images: ["../secret.jpg"] }));
    expect(parsed.images).toBeUndefined();
  });

  it("applies to lodging the same way", () => {
    const parsed = lodgingSchema.parse({
      id: "the-inn",
      name: "The Inn",
      type: "hotel",
      description: "",
      tags: [],
      images: [NAME, "nope"],
    });
    expect(parsed.images).toEqual([NAME]);
  });
});

describe("the editor field", () => {
  it("both domains expose a photos field, so the picker actually appears", () => {
    for (const fields of [restaurantFields, lodgingFields]) {
      const f = fields.find((x) => x.key === "images");
      expect(f, "images field is missing from the domain").toBeDefined();
      // "photos" is what routes it to the picker; any other kind silently
      // renders a text box the Chamber would have to paste hashes into.
      expect(f!.kind).toBe("photos");
    }
  });
});

describe("saving a listing with untouched optional fields (regression)", () => {
  // Found while verifying listing photos in a browser: the save was rejected
  // with "Access facts verified on: must be a date in YYYY-MM-DD format" on a
  // field nobody had typed in. The editor sends "" for an untouched text field,
  // and `isoDateSchema.optional()` only short-circuits on `undefined` — so a
  // BLANK optional date made the whole record unsaveable. That blocked every
  // restaurant and lodging save through the workbench.
  it("accepts a blank optional access-verified date", () => {
    for (const blank of [undefined, "", "   "]) {
      const parsed = restaurantSchema.safeParse(restaurant({ accessVerifiedOn: blank }));
      expect(parsed.success, `blank date ${JSON.stringify(blank)} must be allowed`).toBe(true);
      if (parsed.success) expect(parsed.data.accessVerifiedOn).toBeUndefined();
    }
  });

  it("still rejects a real but malformed date", () => {
    const parsed = restaurantSchema.safeParse(restaurant({ accessVerifiedOn: "07/19/2026" }));
    expect(parsed.success).toBe(false);
  });

  it("still accepts a well-formed one", () => {
    const parsed = restaurantSchema.parse(restaurant({ accessVerifiedOn: "2026-07-19" }));
    expect(parsed.accessVerifiedOn).toBe("2026-07-19");
  });
});
