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
];
