// The shopping seed — the invariants that keep a browsable map honest.
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
// It also pins the structural facts the /map switcher depends on, and the one
// taxonomy rule that makes the map readable: retail and services are different
// icons, because "what do I leave with" is the question a shopping map answers.

import { describe, expect, it } from "vitest";
import { mapFeatures } from "@/lib/data/map-features";
import { mapViews } from "@/lib/data/map-views";
import { MARKER_CATEGORIES, markerCategory, CATEGORY_LABEL_RANK } from "@/lib/map/types";

const SHOPPING_VIEW = "shopping";

const shoppingFeatures = mapFeatures.filter((f) => f.views.includes(SHOPPING_VIEW));

/**
 * A named, checkable origin: OSM's own survey date, a second source that
 * corroborated the record, or an explicit admission that neither exists.
 *
 * "no survey date on record" counts on purpose. A pin nobody has checked is
 * allowed on this map — a pin that hides the fact is not.
 */
const PROVENANCE =
  /osm check \d{4}-\d{2}-\d{2}|verified|corroborated|no survey date on record|food & drink map|events calendar/i;

describe("shopping map view", () => {
  const view = () => mapViews.find((v) => v.id === SHOPPING_VIEW);

  it("is published, or it is invisible on /map", () => {
    expect(view(), "seed must define a 'shopping' view").toBeDefined();
    expect(view()!.published).toBe(true);
  });

  it("declares no BuiltInSource — there is no shop layer to pull from", () => {
    // Not a stylistic preference. BuiltInSource offers restaurants /
    // parking-zones / streets, and E17's DirectoryListing has no coordinates.
    // If a future epic adds a geocoded directory source, this assertion is the
    // place that should fail and make someone re-read the view's comment.
    expect(view()!.sources).toEqual([]);
  });

  it("has features, so the pill is not an empty promise", () => {
    // The parking-cash view once shipped as a blank canvas under copy that
    // promised markers. Once is enough.
    expect(shoppingFeatures.length).toBeGreaterThan(0);
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
