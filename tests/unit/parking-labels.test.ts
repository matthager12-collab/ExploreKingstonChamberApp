// E14 — the parking text alternative must actually spell the type out.
//
// /parking's "Every lot, in words" list exists because the map encodes a lot's
// type in its MARKER COLOUR (M-14-04), and src/components/feature-map.tsx is
// frozen. The list is only a real alternative if it renders a human label; it
// shipped rendering the raw enum slug ("free-2hr"), which conveys nothing.
//
// src/lib/map/parking-labels.ts is a deliberate hand-copy of the frozen file's
// table — the frozen module cannot be imported from a server page's graph, and
// it cannot be edited to export the table. These tests are what make that
// duplication survivable: a new rule slug in the seed data fails here rather
// than quietly printing itself to a visitor, and the copy is checked against
// the frozen original's text so the two cannot drift.

import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parkingZones } from "@/lib/data/parking";
import {
  PARKING_RULE_LABELS,
  freeOrPaidFromRule,
  parkingRuleLabel,
} from "@/lib/map/parking-labels";
import { COST_VALUES } from "@/lib/cost";

const FROZEN_MAP = path.join(process.cwd(), "src", "components", "feature-map.tsx");

describe("parking rule labels", () => {
  it("every rule slug in the seed data has a human label", () => {
    const unlabelled = [
      ...new Set(parkingZones.map((z) => z.rule).filter((rule) => !(rule in PARKING_RULE_LABELS))),
    ];
    expect(
      unlabelled,
      `Parking rule slug(s) with no label — /parking would print the raw enum to a visitor: ${unlabelled.join(", ")}`,
    ).toEqual([]);
  });

  it("no label is just the slug back again", () => {
    const passthrough = Object.entries(PARKING_RULE_LABELS).filter(([slug, label]) => slug === label);
    expect(passthrough, `Labels identical to their slug: ${passthrough.map(([s]) => s).join(", ")}`).toEqual([]);
  });

  it("matches the frozen map component's own table for every slug it defines", () => {
    // Read, do not import: feature-map.tsx is a client Leaflet module and is
    // frozen. Comparing the text is enough to catch a silent divergence.
    const frozen = readFileSync(FROZEN_MAP, "utf8");
    const drift = Object.entries(PARKING_RULE_LABELS).filter(
      ([, label]) => !frozen.includes(JSON.stringify(label)),
    );
    expect(
      drift,
      `Label(s) that no longer match src/components/feature-map.tsx (the map popup and the text alternative would say different things): ${drift
        .map(([slug]) => slug)
        .join(", ")}`,
    ).toEqual([]);
  });

  it("falls back to the slug rather than to nothing", () => {
    expect(parkingRuleLabel("free-2hr")).toBe("Free · 2-hour limit");
    expect(parkingRuleLabel("some-new-rule")).toBe("some-new-rule");
  });
});

/* ------------------------------------------------------------------ */
/* E27 — the free-vs-paid projection                                   */
/* ------------------------------------------------------------------ */

describe("freeOrPaidFromRule", () => {
  it("calls the free rules free", () => {
    expect(freeOrPaidFromRule("free-2hr")).toBe("free");
    expect(freeOrPaidFromRule("free-unrestricted")).toBe("free");
    // Kitsap park & rides cost nothing; the 24-hour cap is a time limit, not a price.
    expect(freeOrPaidFromRule("park-and-ride-24h")).toBe("free");
  });

  it("calls the paid rule paid", () => {
    expect(freeOrPaidFromRule("paid")).toBe("paid");
  });

  // The deliberate part. A visitor cannot park in any of these at any price, so
  // a money badge is the wrong answer — and "Free" would be the harmful one,
  // since a permit row is free only to somebody who already holds a permit.
  it.each(["permit", "load-zone", "prohibited"])(
    "renders no cost badge for '%s' — the money question does not apply",
    (rule) => {
      expect(freeOrPaidFromRule(rule)).toBeUndefined();
    },
  );

  it("never labels a permit row 'free'", () => {
    expect(freeOrPaidFromRule("permit")).not.toBe("free");
  });

  it("returns undefined for an unknown slug rather than guessing", () => {
    // A new rule added to the seed data must show up as a MISSING badge, not a
    // wrong one. The label test above is what catches the omission loudly.
    expect(freeOrPaidFromRule("some-future-rule")).toBeUndefined();
  });

  it("emits only values the badge knows how to render", () => {
    for (const rule of Object.keys(PARKING_RULE_LABELS)) {
      const cost = freeOrPaidFromRule(rule);
      if (cost !== undefined) expect(COST_VALUES).toContain(cost);
    }
  });

  it("covers every rule the seed data actually uses", () => {
    // Not an assertion that each maps to a badge — an assertion that each was
    // CONSIDERED, i.e. the function returns without throwing for all of them.
    for (const zone of parkingZones) {
      expect(() => freeOrPaidFromRule(zone.rule)).not.toThrow();
    }
  });
});
