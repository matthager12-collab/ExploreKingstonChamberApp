// Seed map views. Admin edits overlay these in .data/stores/map-views.json.
// Coordinates center on downtown Kingston (ferry dock ≈ 47.7966,-122.4958).

import type { MapView } from "../map/types";

export const mapViews: MapView[] = [
  {
    id: "food-drink",
    name: "Food & Drink",
    description:
      "Every place to eat and drink in downtown Kingston, pulled live from the restaurant listings.",
    center: [47.799, -122.4985],
    zoom: 16,
    sources: ["restaurants"],
    published: true,
  },
  {
    id: "parking-cash",
    name: "Parking",
    // A blank canvas built by hand in /admin/maps — draw the real parking areas
    // from the ground up. Starts as a draft (hidden from the
    // public /map switcher) until it's ready to publish. To pull in the
    // built-in layers again, tick sources in the editor's "Edit view" panel.
    description: "Where to park in Kingston — built by the Chamber.",
    center: [47.7972, -122.498],
    zoom: 17,
    sources: [],
    published: false,
  },
  {
    id: "explore",
    name: "Explore Kingston",
    description:
      "Beaches, viewpoints, parks, art, and local landmarks — the Chamber's curated map of things to see.",
    center: [47.799, -122.497],
    zoom: 15,
    sources: [],
    published: true,
  },
  {
    id: "trails",
    name: "Trails & Walks",
    description: "Walking routes and trails around Kingston and the North Kitsap Heritage area.",
    center: [47.8, -122.5],
    zoom: 14,
    sources: [],
    published: true,
  },
  {
    // E27 practical basics. Renders custom amenity MapFeatures only — no
    // BuiltInSource is needed or wanted, because getFeaturesForView("amenities")
    // already returns every feature listing this view id.
    // Centered on the waterfront so both mapped restrooms (promenade + boat
    // launch) and the downtown strip sit in frame at zoom 16.
    id: "amenities",
    name: "Restrooms & Amenities",
    description:
      "Public restrooms, drinking water, benches, shade, and trailheads around downtown Kingston.",
    center: [47.7968, -122.498],
    zoom: 16,
    sources: [],
    published: true,
  },
];
