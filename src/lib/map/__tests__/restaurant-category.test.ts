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
  "kingston-ale-house": "drink",
  "dvine-lounge": "drink",
  "cellar-cat": "drink",
  "filling-station": "drink",
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
};

describe("restaurantCategory over the seed data", () => {
  it("covers every seed listing (add new listings to EXPECTED)", () => {
    expect(restaurants.map((r) => r.id).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("assigns every seed listing its pinned icon category", () => {
    const actual = Object.fromEntries(restaurants.map((r) => [r.id, restaurantCategory(r)]));
    expect(actual).toEqual(EXPECTED);
  });
});
