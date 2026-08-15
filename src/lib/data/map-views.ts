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
    //
    // "port-stalls" (E34) draws the Port lot's individual bays. It is NOT
    // listed here — owner decision 2026-08-07, reversing the one that shipped
    // it: at the zoom a visitor actually reads this map, 302 small shapes read
    // as clutter over the zone fills rather than as rows of stalls, and the
    // information they add is already carried by the pay cards and the zone
    // colours. Satellite imagery on the public map (see /parking) does the job
    // the bays were meant to do, with no drawing of ours to be wrong.
    //
    // The layer, its generator and its per-zone adjustment all remain — tick
    // "Port parking bays" on any view in /admin/maps to bring it back. Kept
    // rather than deleted because the geometry is only worth regenerating
    // while the Port's 12-30-25 sheet is current.
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
  /* ---------------- Shopping, split four ways ----------------
   *
   * These four replace a single "Shopping & Services" view (PR #150) that put
   * all 28 businesses on one map. It was too dense to read: at the fitted
   * downtown zoom the greedy label declutter had to drop most of the chips, so
   * the map showed pins whose names you could only get by tapping each one.
   * Four themed maps of 5–8 pins each let nearly every label render.
   *
   * The split is by ERRAND, not by the pin's marker category — which is why
   * Kingston Mini Storage (category `services`) sits under Home & Practical
   * next to the hardware store. A visitor thinks "where do I get X", not
   * "which taxonomy is X".
   *
   * THE SEAM OPENED (directory-public slice, 2026-08-12). DirectoryListing
   * now carries optional lat/lng (geocode pass + workbench), and the
   * "directory" BuiltInSource exists — filtered per view through
   * `directoryCategories`, the way "restaurants" backs food-drink. The four
   * shopping views still run on hand pins ON PURPOSE: their curation is
   * finer than the listing categories (shop vs take-home vs health), and a
   * curated hand pin beats an auto pin until the Chamber verifies each
   * replacement. The migration path: turn the "businesses" view below live
   * once listings are geocoded, then adopt the source per shopping view (an
   * admin edit, no code) and retire matched hand pins using the geocode
   * script's adoption report. Meanwhile resolve.ts already links every hand
   * pin whose name matches a live listing to its /directory profile — the
   * pins are clickable business profiles either way.
   *
   * Every `center` here is the centroid of that view's own pins, and every one
   * is a FALLBACK: the public map auto-frames to its content. They matter only
   * if a view is ever emptied in /admin/maps.
   */
  {
    // Every live directory business with a pin, one map — the first consumer
    // of the "directory" BuiltInSource. Ships UNPUBLISHED: it is empty until
    // the geocode pass gives listings coordinates in production, and an
    // empty public map is worse than none. The Chamber flips `published` in
    // /admin/maps once pins exist (and can then adopt the source per
    // curated shopping view, narrowed via directoryCategories).
    id: "businesses",
    name: "Businesses",
    description:
      "Every local business in the directory with a map pin — Chamber members ringed in blue. Tap a pin for the business's profile page.",
    center: [47.7998, -122.4988],
    zoom: 15,
    sources: ["directory"],
    published: false,
  },
  {
    id: "shops-gifts",
    name: "Shops & Gifts",
    description:
      "Browsable shops in Kingston — gifts, books, clothing, antiques, flowers, and plants. Split between the waterfront strip right off the ferry and Kingston Center up the hill, about a 10-minute walk apart.",
    center: [47.7998, -122.4988],
    zoom: 15,
    sources: [],
    published: true,
  },
  {
    id: "food-to-take-home",
    name: "Food & Drink to Take Home",
    // Deliberately NOT merged into the "food-drink" view above, and named to
    // read against it: that map is where you sit down and eat, this one is
    // what you carry onto the boat or back to a rental. Four businesses appear
    // on both — see the CROSSOVERS note in map-features.ts.
    description:
      "Groceries, the butcher, the bakery, wine shops, and the Sunday Public Market — food and drink to take with you, rather than somewhere to sit down. For restaurants and cafés, see the Food & Drink map.",
    center: [47.7999, -122.4992],
    zoom: 15,
    sources: [],
    published: true,
  },
  {
    id: "home-practical",
    name: "Home & Practical",
    description:
      "Hardware, auto parts, phones, alterations, and storage — the errands you run rather than browse. Mostly up the hill on Highway 104.",
    center: [47.8017, -122.5006],
    zoom: 16,
    sources: [],
    published: true,
  },
  {
    id: "health-beauty",
    name: "Health & Beauty",
    description:
      "Salons, spas, massage, and nails around downtown Kingston and Kingston Center.",
    center: [47.7992, -122.4995],
    zoom: 15,
    sources: [],
    published: true,
  },
];
