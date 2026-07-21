// E27 practical basics — the amenity seed is an honesty invariant, not a list.
//
// The failure this guards is a real-world harm, not a crash: someone who needs
// a restroom walks to a pin that isn't there. So the rule is not "restrooms
// exist" but "every restroom/water pin names where it came from and admits what
// it doesn't know". A future contributor who adds a confident-looking pin from
// memory fails this suite.
//
// It also pins two structural facts the finder depends on: every amenity is a
// marker with a point (the on-device distance sort has nothing to sort
// otherwise), and the "amenities" view is published (a draft view is invisible
// on /map and the finder page would render an empty map).

import { describe, expect, it } from "vitest";
import { mapFeatures } from "@/lib/data/map-features";
import { mapViews } from "@/lib/data/map-views";
import { MARKER_CATEGORIES, markerCategory, CATEGORY_LABEL_RANK } from "@/lib/map/types";

const AMENITY_VIEW = "amenities";
/** Categories whose pins send someone walking somewhere specific. */
const SAFETY_CRITICAL = ["restroom", "water"];

const amenityFeatures = mapFeatures.filter((f) => f.views.includes(AMENITY_VIEW));

/** Phrases that admit the pin is not field-verified. */
const CAVEAT = /approximate|not field-checked|probable|unverified|treat the pin/i;
/** A named, checkable origin for the fact. */
const SOURCE = /portofkingston\.org|port of kingston|wsdot|kitsap|chamber-verified|per the/i;

describe("amenities map view", () => {
  it("is published, or it is invisible on /map", () => {
    const view = mapViews.find((v) => v.id === AMENITY_VIEW);
    expect(view, "seed must define an 'amenities' view").toBeDefined();
    expect(view!.published).toBe(true);
  });

  it("needs no BuiltInSource — custom features resolve on their own", () => {
    const view = mapViews.find((v) => v.id === AMENITY_VIEW)!;
    expect(view.sources).toEqual([]);
  });

  it("has at least one feature, so the layer is not an empty promise", () => {
    expect(amenityFeatures.length).toBeGreaterThan(0);
  });
});

describe("amenity seed honesty (M-19-03)", () => {
  it("seeds at least one public restroom", () => {
    const restrooms = amenityFeatures.filter((f) => f.category === "restroom");
    expect(restrooms.length).toBeGreaterThan(0);
  });

  // The core rule. Applies to whatever exists — including water pins added
  // later, which is why it filters by category rather than hardcoding ids.
  it.each(SAFETY_CRITICAL)("every '%s' pin names a source and admits its limits", (category) => {
    for (const f of amenityFeatures.filter((x) => x.category === category)) {
      const notes = f.notes ?? "";
      expect(notes, `${f.id} has no notes — a bare pin asserts precision it lacks`).not.toBe("");
      expect(
        SOURCE.test(notes),
        `${f.id} notes name no source — where does this location come from?`,
      ).toBe(true);
      expect(
        CAVEAT.test(notes),
        `${f.id} notes claim certainty with no caveat — say it is approximate, or field-verify it`,
      ).toBe(true);
    }
  });

  it("gives every amenity a point, so the finder can sort by distance", () => {
    for (const f of amenityFeatures) {
      expect(f.kind, `${f.id} must be a marker to appear in the finder`).toBe("marker");
      expect(Array.isArray(f.point), `${f.id} has no point`).toBe(true);
      const [lat, lng] = f.point!;
      // Kingston, WA — a coordinate outside this box is a transposed or
      // mistyped pair, which is how a restroom ends up in the Pacific.
      expect(lat).toBeGreaterThan(47.7);
      expect(lat).toBeLessThan(48.0);
      expect(lng).toBeGreaterThan(-122.6);
      expect(lng).toBeLessThan(-122.4);
    }
  });
});

describe("amenity marker taxonomy", () => {
  const keys = MARKER_CATEGORIES.map((c) => c.key);

  it.each(["water", "bench", "picnic", "shade", "bin"])("registers '%s'", (key) => {
    expect(keys).toContain(key);
  });

  it("keeps category keys unique", () => {
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Regression guard for a live-map trap: markerCategory() used to resolve its
  // fallback as MARKER_CATEGORIES[length - 2], so appending a category silently
  // changed the default icon for every uncategorized marker. E27 appended five.
  it("still defaults to the info pin for an unknown category", () => {
    expect(markerCategory("no-such-category").key).toBe("info");
    expect(markerCategory(undefined).key).toBe("info");
  });

  it("ranks basics below landmarks so they lose label collisions", () => {
    for (const key of ["water", "bench", "picnic", "shade", "bin"]) {
      expect(CATEGORY_LABEL_RANK[key]).toBeLessThan(CATEGORY_LABEL_RANK.park);
    }
    // The P0 pair outranks the comfort amenities.
    expect(CATEGORY_LABEL_RANK.water).toBeGreaterThan(CATEGORY_LABEL_RANK.bench);
  });
});
