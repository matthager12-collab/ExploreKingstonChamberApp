// The shopping seed — the invariants that keep four browsable maps honest.
//
// This layer's failure mode is different from the amenity seed's. Nobody is
// harmed by walking to a closed gift shop the way they are by walking to a
// restroom that isn't there, so this suite does not demand a caveat on every
// pin. What it does demand is that the seed stay *checkable*: the businesses
// came from OpenStreetMap, OSM was wrong three times in the single pull that
// produced this list (a rebrand, a missing shop, and a shop in the wrong
// country), and the only defence against the fourth mistake is that every pin
// still says where it came from and when.
//
// It also pins the structure the /map switcher depends on. These 28 pins first
// shipped as ONE "shopping" view and were split four ways because the label
// declutter could not fit 28 chips at the fitted zoom — so the per-view size
// ceiling below is a real rendering constraint, not a style preference.

import { describe, expect, it } from "vitest";
import { mapFeatures } from "@/lib/data/map-features";
import { mapViews } from "@/lib/data/map-views";
import { MARKER_CATEGORIES, markerCategory, CATEGORY_LABEL_RANK } from "@/lib/map/types";

/** The four errand maps the businesses are split across. */
const SHOPPING_VIEWS = [
  "shops-gifts",
  "food-to-take-home",
  "home-practical",
  "health-beauty",
] as const;

const inShoppingViews = (f: { views: string[] }) =>
  f.views.some((v) => (SHOPPING_VIEWS as readonly string[]).includes(v));

const shoppingFeatures = mapFeatures.filter(inShoppingViews);

/**
 * A named, checkable origin: OSM's own survey date, a second source that
 * corroborated the record, or an explicit admission that neither exists.
 *
 * "no survey date on record" counts on purpose. A pin nobody has checked is
 * allowed on these maps — a pin that hides the fact is not. Keeping the
 * wording standard is what makes `grep "No survey date on record"` a
 * field-check work-list.
 */
const PROVENANCE =
  /osm check \d{4}-\d{2}-\d{2}|verified|corroborated|no survey date on record|food & drink map|events calendar/i;

/**
 * Above this, the greedy declutter in feature-map.tsx starts dropping name
 * chips at the fitted downtown zoom and the map degrades into anonymous pins.
 * Ten leaves headroom for the Chamber to add a few in /admin/maps before a
 * view needs splitting again.
 */
const MAX_PINS_PER_VIEW = 10;

describe("the four shopping views", () => {
  it.each(SHOPPING_VIEWS)("'%s' exists and is published", (id) => {
    const view = mapViews.find((v) => v.id === id);
    expect(view, `seed must define a '${id}' view`).toBeDefined();
    // A draft view is invisible in the /map switcher.
    expect(view!.published).toBe(true);
  });

  it.each(SHOPPING_VIEWS)("'%s' declares no BuiltInSource", (id) => {
    // Not a stylistic preference. BuiltInSource offers restaurants /
    // parking-zones / streets, and E17's DirectoryListing has no coordinates.
    // If a future epic adds a geocoded directory source, this is the assertion
    // that should fail and make someone re-read the views' comment.
    expect(mapViews.find((v) => v.id === id)!.sources).toEqual([]);
  });

  it.each(SHOPPING_VIEWS)("'%s' has pins, so the pill is not an empty promise", (id) => {
    // The parking-cash view once shipped as a blank canvas under copy that
    // promised markers. Once is enough.
    const n = mapFeatures.filter((f) => f.views.includes(id)).length;
    expect(n, `view '${id}' has no features`).toBeGreaterThan(0);
  });

  it.each(SHOPPING_VIEWS)("'%s' stays small enough for its labels to render", (id) => {
    const n = mapFeatures.filter((f) => f.views.includes(id)).length;
    expect(n, `view '${id}' has ${n} pins — split it rather than hide labels`).toBeLessThanOrEqual(
      MAX_PINS_PER_VIEW,
    );
  });

  it("files every business on exactly one of the four", () => {
    // Two errand maps claiming the same shop is a duplicate a visitor meets as
    // a mystery; zero is a business that silently vanished during a re-split.
    for (const f of shoppingFeatures) {
      const hits = f.views.filter((v) => (SHOPPING_VIEWS as readonly string[]).includes(v));
      expect(hits, `${f.id} is on ${hits.length} shopping views: ${hits.join(", ")}`).toHaveLength(1);
    }
  });

  it("leaves no pin stranded on the retired 'shopping' view", () => {
    // PR #150's single view was replaced by the four above. A feature still
    // pointing at it would render on no map at all.
    expect(mapViews.some((v) => v.id === "shopping")).toBe(false);
    expect(mapFeatures.filter((f) => f.views.includes("shopping"))).toHaveLength(0);
  });
});

describe("seed-wide view integrity", () => {
  it("points every feature at a view that exists", () => {
    // The generalised version of the stranded-pin bug above: any seed feature
    // naming a view the seed does not define is invisible on the site.
    const ids = new Set(mapViews.map((v) => v.id));
    for (const f of mapFeatures) {
      for (const v of f.views) {
        expect(ids, `${f.id} lists unknown view '${v}'`).toContain(v);
      }
    }
  });
});

describe("shopping seed integrity", () => {
  it("gives every pin a checkable origin", () => {
    for (const f of shoppingFeatures) {
      expect(f.notes, `${f.id} has no notes`).toBeTruthy();
      expect(
        f.notes!,
        `${f.id}: notes must say where the record came from, or admit nothing checked it`,
      ).toMatch(PROVENANCE);
    }
  });

  it("is all markers with points — a shop with no location is not a map pin", () => {
    for (const f of shoppingFeatures) {
      expect(f.kind, `${f.id} is not a marker`).toBe("marker");
      expect(f.point, `${f.id} has no point`).toBeDefined();
    }
  });

  it("keeps every pin inside Kingston, WA", () => {
    // The Whit Kingston trap: a web search for "Kingston shops" returns
    // Kingston, Ontario. A transposed or wrong-town coordinate lands outside
    // this box rather than quietly onto the map.
    for (const f of shoppingFeatures) {
      const [lat, lng] = f.point!;
      expect(lat, `${f.id} latitude`).toBeGreaterThan(47.7);
      expect(lat, `${f.id} latitude`).toBeLessThan(48.0);
      expect(lng, `${f.id} longitude`).toBeGreaterThan(-122.6);
      expect(lng, `${f.id} longitude`).toBeLessThan(-122.4);
    }
  });

  it("keeps feature ids unique across the whole seed", () => {
    const ids = mapFeatures.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses only registered marker categories", () => {
    // markerCategory() silently falls back to the ℹ️ info pin for an unknown
    // key, so a typo'd category is invisible in review and wrong on the map.
    const keys = MARKER_CATEGORIES.map((c) => c.key) as readonly string[];
    for (const f of shoppingFeatures) {
      expect(keys, `${f.id} category '${f.category}'`).toContain(f.category);
    }
  });

  it("asserts membership on nobody", () => {
    // The roster is the Chamber's to assert, not OpenStreetMap's. Marking a
    // non-member — or missing a member who pays dues — is a real harm to their
    // own customers, so the seed stays silent and /admin/maps sets the flag.
    for (const f of shoppingFeatures) {
      expect(f.member, `${f.id} must not claim membership from seed data`).toBeUndefined();
    }
  });
});

describe("shop / services taxonomy", () => {
  it("registers a 'services' category distinct from 'shop'", () => {
    const keys = MARKER_CATEGORIES.map((c) => c.key) as readonly string[];
    expect(keys).toContain("services");

    const shop = markerCategory("shop");
    const services = markerCategory("services");
    // Different emoji is the load-bearing half — colour alone would leave the
    // distinction invisible to anyone who can't separate the two hues.
    expect(services.emoji).not.toBe(shop.emoji);
    expect(services.color).not.toBe(shop.color);
  });

  it("still defaults to the info pin for an unknown category", () => {
    // Appending to MARKER_CATEGORIES used to change the default icon for every
    // uncategorized marker (the old length-2 fallback). This seed appended one.
    expect(markerCategory("no-such-category").key).toBe("info");
    expect(markerCategory(undefined).key).toBe("info");
  });

  it("labels services just under shops, but at the same zoom", () => {
    // Both ≥45 so they appear together at the fitted downtown zoom; services
    // ranks lower so retail wins a collision on a map about buying things.
    expect(CATEGORY_LABEL_RANK.services).toBeLessThan(CATEGORY_LABEL_RANK.shop);
    expect(CATEGORY_LABEL_RANK.services).toBeGreaterThanOrEqual(45);
  });

  it("draws both retail and service pins", () => {
    const cats = new Set(shoppingFeatures.map((f) => f.category));
    expect(cats.has("shop"), "seed should include retail pins").toBe(true);
    expect(cats.has("services"), "seed should include service pins").toBe(true);
  });
});
