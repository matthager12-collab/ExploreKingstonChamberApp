// Pin the feature-map icon (Food / Coffee / Drinks) for EVERY seed listing.
//
// This is a deliberate full-table snapshot: any change to the classifier or to
// a listing's cuisine/tags that flips an icon must show up here as an explicit
// diff, so a keyword tweak can never silently re-categorize a business.

import { describe, expect, it } from "vitest";
import { restaurants } from "../../data/restaurants";
import { restaurantCategory } from "../restaurant-category";

const EXPECTED: Record<string, "food" | "coffee" | "drink"> = {
  "jaime-les-crepes": "food",
  "sourdough-willys": "food",
  "saucy-sailor": "food",
  // Owner feedback 2026-07-31: these three are eating places — their seed
  // records carry an explicit mapCategory: "food" that overrides the keyword
  // guess (their cuisine strings all contain pub/bar/lounge keywords).
  "kingston-ale-house": "food",
  "dvine-lounge": "food",
  "cellar-cat": "drink",
  "filling-station": "food",
  "grub-hut": "food",
  "nirvana-indian-nepali": "food",
  "friends-and-neighbors-brewing": "drink",
  "los-tres-compadres": "food",
  "borrowed-kitchen-bakery": "coffee",
  "cup-and-muffin": "coffee",
  "argensol-kitchen": "food",
  "da-poke-shop": "food",
  "westside-pizza": "food",
  "kingston-coffee-company": "coffee",
  // Classifier-derived, not overridden: cuisine "Coffee roastery & cafe" plus
  // the "coffee" tag hit the keyword branch, so it takes ☕ without needing an
  // explicit mapCategory.
  "over-the-moon-coffee": "coffee",
};

describe("restaurantCategory over the seed data", () => {
  it("covers every seed listing (add new listings to EXPECTED)", () => {
    expect(restaurants.map((r) => r.id).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("assigns every seed listing its pinned icon category", () => {
    const actual = Object.fromEntries(restaurants.map((r) => [r.id, restaurantCategory(r)]));
    expect(actual).toEqual(EXPECTED);
  });

  it("only the three owner-flagged listings carry an explicit override", () => {
    const explicit = restaurants.filter((r) => r.mapCategory).map((r) => r.id);
    expect(explicit.sort()).toEqual(["dvine-lounge", "filling-station", "kingston-ale-house"]);
  });
});

describe("restaurantCategory precedence", () => {
  const base = {
    id: "x",
    name: "X",
    description: "",
    address: "",
    priceLevel: 2,
    lat: 0,
    lng: 0,
    walkMinutesFromFerry: 5,
  } as const;

  it("an explicit mapCategory beats every keyword", () => {
    const pub = { ...base, cuisine: "American pub & seafood", tags: ["pub", "beer"] };
    expect(restaurantCategory({ ...pub })).toBe("drink");
    expect(restaurantCategory({ ...pub, mapCategory: "food" })).toBe("food");
    const cafe = { ...base, cuisine: "Coffee & cafe", tags: ["coffee"] };
    expect(restaurantCategory({ ...cafe, mapCategory: "drink" })).toBe("drink");
  });

  it("falls back to the keyword guess when mapCategory is absent", () => {
    expect(restaurantCategory({ ...base, cuisine: "Pizza", tags: [] })).toBe("food");
    expect(restaurantCategory({ ...base, cuisine: "Espresso bar", tags: [] })).toBe("coffee");
    expect(restaurantCategory({ ...base, cuisine: "Brewery taproom", tags: [] })).toBe("drink");
  });
});
