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
    // The 25 seeded lots in src/lib/data/parking.ts, shown by default. This
    // was a blank canvas to be drawn by hand in /admin/maps; that never
    // happened, and the live map sat empty under copy promising markers.
    //
    // "parking-zones" here is load-bearing for accessibility, not just for the
    // map. /parking's "Every lot, in words" list — M-14-04's text alternative
    // to the frozen map's colour-only lot types — renders only when
    // resolveMapView() fills builtins.parkingZones, and it only does that when
    // this source is listed. Seeded rather than ticked in /admin/maps so a
    // restored backup, a wiped store, or a fresh environment cannot silently
    // drop the alternative. tests/unit/parking-seed-source.test.ts holds this.
    //
    // Admins still draw on top in /admin/maps; overlay edits win by id.
    description: "Where to park in Kingston — built by the Chamber.",
    center: [47.7972, -122.498],
    zoom: 17,
    sources: ["parking-zones"],
    published: true,
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
  {
    // Shops and services. `sources: []` is not a placeholder — there is no
    // built-in layer this view could pull from. BuiltInSource offers
    // restaurants / parking-zones / streets, and the one domain that sounds
    // right, E17's DirectoryListing, carries no lat/lng at all (see
    // src/lib/schemas/directory.ts — name, address, phone, website, tags).
    // A map needs coordinates, so these are drawn MapFeatures, geocoded and
    // source-noted one at a time in src/lib/data/map-features.ts.
    //
    // WHEN DIRECTORY LISTINGS GAIN COORDINATES, this is the seam to revisit:
    // add a "directory" BuiltInSource filtered to category shop/services, the
    // way "restaurants" backs food-drink, and retire the hand-seeded pins.
    // Until then a hand-drawn pin the Chamber can fix in one click beats an
    // empty map — the mistake parking-cash made and had to undo above.
    id: "shopping",
    name: "Shopping & Services",
    description:
      "Shops and services in Kingston, in two clusters: the waterfront strip right off the ferry, and Kingston Center up the hill on Highway 104 — about a 10-minute walk between them.",
    // A fallback only: the public map auto-frames to its content, and these
    // pins span both clusters (~700 m, inside the 1.2 km outlier trim), so the
    // fitted frame is what a visitor actually sees.
    center: [47.7999, -122.4995],
    zoom: 15,
    sources: [],
    published: true,
  },
];
