// Seed custom map features. Admin edits/additions overlay these in
// .data/stores/map-features.json (and admins draw new ones at /admin/maps).
//
// These starter features show the shape of each kind; coordinates are
// approximate downtown Kingston landmarks the Chamber can nudge in the editor.

import type { MapFeature } from "../map/types";

export const mapFeatures: MapFeature[] = [
  {
    id: "mike-wallace-park",
    kind: "marker",
    title: "Mike Wallace Park & Marina",
    notes:
      "Waterfront park right by the ferry — lawn, boardwalk, and the Sunday Kingston Public Market (May–Oct).",
    category: "park",
    views: ["explore"],
    point: [47.7961, -122.4972],
    link: "https://www.google.com/maps/search/?api=1&query=Mike+Wallace+Park+Kingston+WA",
  },
  {
    id: "point-no-point",
    kind: "marker",
    title: "Point No Point Lighthouse",
    notes:
      "Puget Sound's oldest lighthouse (1879), driftwood beach, and a county park ~15 min north. Great tide-pooling at low tide.",
    category: "viewpoint",
    views: ["explore"],
    point: [47.9126, -122.5266],
    link: "https://www.google.com/maps/search/?api=1&query=Point+No+Point+Lighthouse",
  },
  {
    id: "village-green",
    kind: "marker",
    title: "Village Green Community Campus",
    notes: "Community center, library branch, and park — the town's living room, up the hill.",
    category: "park",
    views: ["explore"],
    point: [47.8016, -122.5],
  },
  {
    id: "waterfront-boardwalk",
    kind: "trail",
    title: "Waterfront boardwalk stroll",
    notes: "Flat, stroller-friendly walk along the marina from the ferry to the swim beach.",
    color: "#1e96c0",
    views: ["trails", "explore"],
    path: [
      [47.7963, -122.4966],
      [47.7969, -122.4979],
      [47.7975, -122.499],
      [47.7981, -122.5001],
    ],
  },

  /* ---------------- Practical basics — the "amenities" view (E27) ----------------
   *
   * SOURCING RULE (M-19-03, and the reason this block is short): a pin sent to a
   * restroom that isn't there is a real harm to someone who needs one. Every
   * amenity below traces to a published source, and says so in `notes` — the
   * same honesty posture src/lib/data/parking.ts uses, and `notes` (unlike a new
   * typed field) stays editable in the existing admin map editor.
   *
   * Both restrooms below come from the Port of Kingston's official parking map
   * dated 12-30-25 — the same document the Port parking geometry is georeferenced
   * from — and are corroborated by the site's own published /print copy:
   * "there are public restrooms on the waterfront promenade by the Port marina,
   * near the boat launch."
   *
   * DELIBERATELY EMPTY: drinking water. No published source places a fountain or
   * potable-water spigot in Kingston, so nothing is seeded rather than guessing.
   * The `water` category, the map layer, and the finder all support it — the
   * Chamber adds real ones at /admin/maps with no deploy, and the finder renders
   * an honest "none mapped yet" state until then.
   */
  {
    id: "restroom-waterfront-promenade",
    kind: "marker",
    title: "Public restrooms — waterfront promenade",
    notes:
      "Public restrooms on the waterfront promenade by the Port marina, inside the D-shaped loop pod. Approximate location, read off the Port of Kingston's official parking map dated 12-30-25 (portofkingston.org) — the map shows the restrooms, not their exact footprint, so treat the pin as within about a block. Not field-checked.",
    category: "restroom",
    cost: "free",
    views: ["amenities"],
    point: [47.7962, -122.498],
  },
  {
    id: "restroom-boat-launch",
    kind: "marker",
    title: "Public restrooms — boat launch",
    notes:
      "Restrooms at the center of the boat-launch maneuvering apron, west of the marina. Approximate location, derived from the Port of Kingston's official parking map dated 12-30-25 (portofkingston.org), which places the launch restrooms mid-apron. Not field-checked.",
    category: "restroom",
    cost: "free",
    views: ["amenities"],
    point: [47.796418, -122.499288],
  },
  {
    id: "restroom-dispenser-portable",
    kind: "marker",
    title: "Portable toilet — SR 104 pass dispenser",
    // Provenance, same standard as the two above: this one is Chamber-reported
    // rather than read off a published map, and a portable unit is not a fixed
    // building — it can be moved or removed without anyone updating a source.
    // Both facts belong in the note a visitor reads before walking to it.
    notes:
      "A portable toilet at the boarding-pass dispenser on SR 104 just west of Lindvog Rd — step 2 of the pass system, the machine every vehicle stops at. Reported by the Kingston Chamber (August 2026); not field-checked, and portable units get moved, so treat the pin as approximate.",
    category: "restroom",
    cost: "free",
    views: ["amenities"],
    // LINE_DISPENSER in lib/ferry-line-geometry. Not imported: this seed is
    // plain data and must not depend on the geometry module, but the two are
    // the same spot by intent — keep them together if either moves.
    //
    // Being AT the dispenser is what makes this the first amenity to land in
    // the amenity split's `walkable` half: the dispenser is the eastern end of
    // LINE_WEST_OF_DISPENSER, so its distance to the waiting stretch is ~0.
    // That answers E33's Open question 2 — see docs/LINE-LANDER.md.
    point: [47.8033, -122.5045],
  },

  /* ------- Shops and services — four themed views, one per errand -------
   *
   * shops-gifts (8) · food-to-take-home (8) · home-practical (5) ·
   * health-beauty (7). These 28 pins shipped as ONE "shopping" view in
   * PR #150 and were split immediately after: at the fitted downtown zoom the
   * greedy label declutter had to drop most of the chips, leaving pins whose
   * names you could only get by tapping. Views of 5–8 pins nearly all render.
   *
   * The split is by ERRAND, not by marker category — Kingston Mini Storage is
   * category `services` but lives under home-practical beside the hardware
   * store, because a visitor thinks "where do I get X", not "what taxonomy is
   * X". A pin's `category` still drives its icon; `views` decides its map.
   *
   * SOURCING. Coordinates and the business list come from OpenStreetMap POIs
   * inside the Kingston bounding box (pulled 2026-08-01), which is the same
   * provenance src/lib/data/restaurants.ts uses for its lat/lng. OSM is
   * community-maintained, so it is a starting point, not an authority — three
   * things it got wrong in this one pull, each caught by a second source:
   *
   *   - The Flower Box has been rebranded **Bouquet** (theflowerboxdowntown.com
   *     301s to bouquetkingston.com; same suite, same phone). Seeded under the
   *     new name, with the old one in the note for anyone returning.
   *   - **HAVENCRAFT** is not in OSM at all. Verified from its own site
   *     (11133 NE Maine St, (253) 260-3572); its pin is the coordinate OSM
   *     holds for that street address, not a POI of its own.
   *   - A web search for Kingston shops surfaced "Whit Kingston", which is in
   *     Kingston, ONTARIO. Not seeded. Check the state, not just the town.
   *
   * `check` in each note is OSM's own last-survey date where it has one. Where
   * a business's own site corroborated the address or phone, the note says
   * "verified". A pin with neither is honest about it. The Chamber fixes any of
   * this in /admin/maps without a deploy — that is the point of the CMS.
   *
   * DELIBERATELY NOT SEEDED:
   *   - Professional offices (accountants, lawyers, real-estate, insurance) and
   *     the Chamber's own office. A visitor browsing a shopping map is not
   *     looking for a tax preparer; that is the E17 directory's job.
   *   - One unnamed laundry POI downtown (OSM node 1331948270). A pin with no
   *     name tells a visitor nothing and cannot be checked later.
   *
   * MEMBERSHIP (`member: true`) is left unset on every pin below. Marking a
   * non-member as a member — or missing a member who pays dues — is a real
   * harm to the Chamber's own customers, and the roster is theirs to assert,
   * not OSM's. The flag is per-feature in /admin/maps whenever they want it.
   *
   * ON-MAP LABELS. Several pins carry an explicit `label.text`. shortenTitle()
   * keeps the FIRST words and ellipsizes the rest, which is the wrong end of
   * the name in a town where businesses are named after it: "Kingston
   * Mini-Mart", "Kingston Mini Storage" and "Kingston Mercantile & Marine"
   * auto-shorten to "Kingston Mini-Mart", "Kingston Mini…" and "Kingston…" —
   * three near-identical chips within a few hundred metres of each other, seen
   * in a render before this seed shipped. The override drops the town name and
   * keeps the distinguishing word. Full names still show in the popup.
   *
   * CROSSOVERS. d'Vine Wines, Cellar Cat, Borrowed Kitchen Bakery and J'aime
   * Les Crêpes also appear on food-drink via the restaurants built-in layer.
   * They are seeded here too, on purpose, and keep their food/drink icons so
   * a visitor recognises them across the two maps instead of meeting an
   * unexplained twin.
   */

  /* -- Waterfront strip: walkable straight off the ferry --
   * Ordered by geography, not by view: neighbours stay next to each other so a
   * coordinate typo is easy to spot. Read each pin's `views` for its map, or
   * `grep 'views: \["health-beauty"\]'` to see one view's whole set. -- */
  {
    id: "shop-paisley-whale",
    kind: "marker",
    title: "The Paisley Whale",
    notes:
      "Antiques, gifts, and vintage finds on the downtown strip, a couple of minutes from the ferry lanes. OSM check 2025-02-08.",
    category: "shop",
    views: ["shops-gifts"],
    point: [47.7972839, -122.4969225],
    link: "https://thepaisleywhale.wordpress.com/",
  },
  {
    id: "shop-jasper-row",
    kind: "marker",
    title: "Jasper Row",
    notes:
      "Clothing boutique — tops, dresses, outerwear, vintage and handmade goods, plus permanent jewelry. Address and phone verified against jasperrow.com.",
    category: "shop",
    views: ["shops-gifts"],
    point: [47.7974544, -122.4970585],
    link: "https://jasperrow.com",
  },
  {
    id: "shop-havencraft",
    kind: "marker",
    title: "HAVENCRAFT",
    notes:
      "Indoor and outdoor plants, custom fine woodworking, and goods from local artisans, at 11133 NE Maine St. Verified from the shop's own site; the pin is that street address, so treat it as within a building's width.",
    category: "shop",
    views: ["shops-gifts"],
    point: [47.7988234, -122.4986056],
    link: "https://www.haven-craft.com/",
  },
  {
    id: "shop-dvine-wines",
    kind: "marker",
    title: "d'Vine Wines",
    // `drink`, not `shop` — see the CROSSOVERS note above.
    notes:
      "Wine shop on the downtown strip; the d'Vine Bistro lounge next door is on the Food & Drink map. OSM check 2025-02-08.",
    category: "drink",
    views: ["food-to-take-home"],
    point: [47.7973261, -122.4975002],
    link: "http://dvinewineshop.com",
  },
  {
    id: "shop-cellar-cat",
    kind: "marker",
    title: "Cellar Cat",
    // No `link`: cellarcat.com fails its TLS handshake — the same reason the
    // restaurants seed ships Cellar Cat without a website. Keep them in step.
    notes:
      "Bottles to take away as well as a place to sit — it also appears on the Food & Drink map. OSM check 2025-02-08.",
    category: "drink",
    views: ["food-to-take-home"],
    point: [47.7971868, -122.497344],
  },
  {
    id: "shop-bouquet",
    kind: "marker",
    title: "Bouquet",
    notes:
      "Florist at 25960 Central Ave NE, Suite 101 — formerly The Flower Box. Tue–Sat 10–4, Sun/Mon by appointment. Verified against bouquetkingston.com.",
    category: "shop",
    views: ["shops-gifts"],
    point: [47.7981391, -122.4981443],
    link: "https://bouquetkingston.com/",
  },
  {
    id: "shop-jaime-les-crepes",
    kind: "marker",
    title: "J'aime Les Crêpes",
    notes:
      "Crêperie steps from the ferry lanes, open early enough to catch before a morning boat. Full listing lives on the Food & Drink map.",
    category: "food",
    views: ["food-to-take-home"],
    point: [47.7971965, -122.4968596],
    link: "https://jaimelescrepes.com",
  },
  {
    id: "shop-mr-clouds",
    kind: "marker",
    title: "Mr. Cloud's Extraordinary E-juices",
    notes:
      "Vape and e-juice shop on the downtown strip. No survey date on record — call ahead before making the walk.",
    category: "shop",
    label: { text: "Mr. Cloud's" },
    views: ["home-practical"],
    point: [47.7977721, -122.4967624],
  },
  {
    id: "services-all-about-sewing",
    kind: "marker",
    title: "All About Sewing",
    notes:
      "Tailoring and alterations, upstairs on the downtown strip. By appointment — (360) 731-9973. No survey date on record.",
    category: "services",
    // Home & Practical, not Health & Beauty (owner call 2026-08-15): alterations
    // are an errand you run, not something you browse — the same test the
    // home-practical view description applies to hardware and auto parts.
    views: ["home-practical"],
    point: [47.7972193, -122.4967622],
  },
  {
    id: "services-central-avenue-salon",
    kind: "marker",
    title: "Central Avenue Salon",
    notes:
      "Hair salon at 25960 Central Ave NE, Suite 102 — the same building as Bouquet. Address corroborated by a second directory source.",
    category: "services",
    label: { text: "Central Ave Salon" },
    views: ["health-beauty"],
    point: [47.7980751, -122.4983123],
  },
  {
    id: "services-kingston-nails",
    kind: "marker",
    title: "Kingston Nails",
    notes: "Nail salon just up from the waterfront. OSM check 2025-02-08.",
    category: "services",
    views: ["health-beauty"],
    point: [47.7975894, -122.4979912],
  },
  {
    id: "services-blue-wind-massage",
    kind: "marker",
    title: "Blue Wind Massage",
    notes:
      "Massage studio near the waterfront. No survey date on record — call ahead.",
    category: "services",
    views: ["health-beauty"],
    point: [47.7970147, -122.4976363],
  },
  {
    id: "services-studio-104",
    kind: "marker",
    title: "Studio 104",
    notes:
      "Hair studio on the downtown strip. No survey date on record — call ahead.",
    category: "services",
    views: ["health-beauty"],
    point: [47.7981036, -122.4974606],
  },

  /* -- Kingston Center, up the hill on Highway 104 (~10 min walk) -- */
  {
    id: "shop-saltwater-bookshop",
    kind: "marker",
    title: "Saltwater Bookshop",
    notes:
      "New-books shop in the Kingston Center strip on Highway 104. OSM check 2025-06-14.",
    category: "shop",
    views: ["shops-gifts"],
    point: [47.8024687, -122.5005949],
    link: "https://saltwaterbookshop.com",
  },
  {
    id: "shop-kingston-bookery",
    kind: "marker",
    title: "Kingston Bookery",
    notes:
      "Second-hand and used books, a few doors along from Saltwater Bookshop. OSM check 2025-06-14.",
    category: "shop",
    views: ["shops-gifts"],
    point: [47.8028216, -122.5014913],
  },
  {
    id: "shop-kingston-mercantile-marine",
    kind: "marker",
    title: "Kingston Mercantile & Marine",
    notes:
      "Gifts, marine supplies, and general goods at 10943 NE Highway 104. OSM check 2025-06-14.",
    category: "shop",
    label: { text: "Mercantile" },
    views: ["shops-gifts"],
    point: [47.8018392, -122.5022377],
  },
  {
    id: "shop-henery-hardware",
    kind: "marker",
    title: "Henery Hardware",
    notes:
      "The town hardware store, up the hill on Highway 104. OSM check 2026-05-18 — the freshest survey in this set.",
    category: "shop",
    views: ["home-practical"],
    point: [47.8018899, -122.5001945],
  },
  // The Sheepish Pig (butcher, next to Kingston Mercantile & Marine) was here
  // until 2026-08-15 — removed as closed, owner report. Kept as a comment
  // rather than deleted outright so the coordinates survive if it reopens:
  // point [47.8018765, -122.5023235], category "shop", views ["food-to-take-home"].
  {
    id: "shop-country-pet-shoppe",
    kind: "marker",
    title: "Country Pet Shoppe",
    notes: "Pet supplies and feed, on the way up the hill. OSM check 2025-08-29.",
    category: "shop",
    views: ["shops-gifts"],
    point: [47.8009455, -122.4986842],
    link: "https://www.countrypetshoppe.com/",
  },
  {
    id: "shop-grocery-outlet",
    kind: "marker",
    title: "Grocery Outlet",
    notes:
      "Full grocery store in the Kingston Center strip — the nearest real supermarket to the ferry, useful for campers, boaters, and rental guests. No survey date on record.",
    category: "shop",
    views: ["food-to-take-home"],
    point: [47.8026756, -122.501064],
  },
  {
    id: "shop-kingston-mini-mart",
    kind: "marker",
    title: "Kingston Mini-Mart",
    notes: "Convenience store on Highway 104. OSM check 2025-06-14.",
    category: "shop",
    label: { text: "Mini-Mart" },
    views: ["food-to-take-home"],
    point: [47.8012772, -122.5015917],
  },
  {
    id: "shop-borrowed-kitchen-bakery",
    kind: "marker",
    title: "Borrowed Kitchen Bakery",
    notes:
      "Bakery counter in the Kingston Center strip. Full listing lives on the Food & Drink map. OSM check 2025-06-14.",
    category: "food",
    label: { text: "Borrowed Kitchen" },
    views: ["food-to-take-home"],
    point: [47.8025211, -122.5007133],
    link: "https://www.borrowedkitchenbakery.com/",
  },
  {
    id: "shop-t-mobile",
    kind: "marker",
    title: "T-Mobile",
    notes:
      "Phone store in the Kingston Center strip — the place to solve a dead phone before a boat. OSM check 2025-06-14.",
    category: "shop",
    views: ["home-practical"],
    point: [47.8027423, -122.5012859],
  },
  {
    id: "shop-napa-auto-parts",
    kind: "marker",
    title: "NAPA Auto Parts",
    notes:
      "Auto parts at the west end of the Highway 104 businesses. No survey date on record.",
    category: "shop",
    views: ["home-practical"],
    point: [47.8022789, -122.5032807],
  },
  {
    id: "services-bliss-day-spa",
    kind: "marker",
    title: "Bliss Day Spa",
    notes: "Day spa in the Kingston Center strip. OSM check 2025-06-14.",
    category: "services",
    views: ["health-beauty"],
    point: [47.8028675, -122.5016481],
  },
  {
    id: "services-harbor-hair-design",
    kind: "marker",
    title: "Harbor Hair Design",
    notes:
      "Hair salon at 10801 NE Highway 104. No survey date on record — call ahead.",
    category: "services",
    views: ["health-beauty"],
    point: [47.802277, -122.5034226],
  },
  {
    id: "services-kingston-mini-storage",
    kind: "marker",
    title: "Kingston Mini Storage",
    notes: "Self-storage units off Highway 104. No survey date on record.",
    category: "services",
    label: { text: "Mini Storage" },
    views: ["home-practical"],
    point: [47.8013079, -122.4991515],
    link: "https://kingstonministorage.com/",
  },

  /* -- The biggest food draw of the week, and it isn't a storefront -- */
  {
    id: "shop-kingston-public-market",
    kind: "marker",
    title: "Kingston Public Market",
    // Seeded from the app's OWN events data (src/lib/data/events.ts, category
    // "market", organizer "Kingston Farmers Market"), not from OSM — which
    // carries no marketplace POI here at all. The link points at /events
    // rather than restating a season the market can change; the calendar is
    // already the single source for its dates.
    notes:
      "Sunday market on the marina lawn at Mike Wallace Park — produce, crafts, and food vendors, 10 AM to 3 PM through the season. Check the events calendar for this week's date before you count on it.",
    category: "event",
    label: { text: "Public Market" },
    views: ["food-to-take-home"],
    point: [47.7961, -122.4972],
    link: "/events",
  },
];
