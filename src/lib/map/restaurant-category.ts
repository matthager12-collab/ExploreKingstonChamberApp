// Marker-palette category for a restaurant pin on the feature map — the
// Food / Coffee / Drinks legend (MARKER_CATEGORIES keys "food" / "coffee" /
// "drink"). Extracted verbatim from resolve.ts so the classifier is
// unit-testable without importing the server-only store graph.

import type { Restaurant } from "../types";

/** The three MARKER_CATEGORIES keys a restaurant pin can resolve to. */
export type RestaurantMapCategory = "food" | "coffee" | "drink";

/** Pick a marker-palette category so coffee/bars get their own pin, not 🍽️.
 *  An explicit per-listing `mapCategory` (admin-editable, E07 schema field)
 *  always wins: cuisine strings like "American pub & seafood" describe the
 *  menu, not which icon the business should get, so keyword guesses are only
 *  the fallback. */
export function restaurantCategory(r: Restaurant): RestaurantMapCategory {
  if (r.mapCategory) return r.mapCategory;
  const hay = `${r.cuisine} ${r.tags.join(" ")}`.toLowerCase();
  if (/coffee|espresso|caf[eé]|bakery|muffin|matcha/.test(hay)) return "coffee";
  if (/\b(bar|brew|brewery|taproom|pub|wine|beer|lounge|cocktail|jazz)\b/.test(hay))
    return "drink";
  return "food";
}
