// Adding a parking rule touches SEVEN places, four of them hand-synced copies.
//
// `ParkingRule` is enumerated in: the domain type + RULE_LABELS
// (src/lib/data/parking.ts), the visitor label table
// (src/lib/map/parking-labels.ts), the frozen map component's own label AND
// colour tables (src/components/feature-map.tsx), two admin editors' colour
// tables, the admin API's validation whitelist, and the editor's dropdown
// array. docs/MAPS.md calls that a "copy-paste dependency", and the existing
// parking-labels spec only guards slugs the SEED DATA uses — so a rule the
// Chamber assigns by hand in the editor, with no seed zone behind it (which is
// exactly what `business-customer` is), slips straight through it.
//
// These tests are definitional instead: they walk the declared union, so a new
// rule fails here until every copy knows about it.
//
// They also hold the ADR-0007 §4 line — "zero confusable pairs inside the
// parking legend" — as a measurement rather than a claim.

import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { RULE_LABELS, type ParkingRule } from "@/lib/data/parking";
import { PARKING_RULE_LABELS, freeOrPaidFromRule } from "@/lib/map/parking-labels";
import { PARKING_TYPES } from "@/lib/map/types";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const FEATURE_MAP = read("src/components/feature-map.tsx");
const ZONE_EDITOR = read("src/app/(site)/admin/map/editor.tsx");
const CMS_EDITOR = read("src/app/(site)/admin/maps/editor.tsx");
const PARKING_API = read("src/app/api/admin/parking/route.ts");

// RULE_LABELS is typed Record<ParkingRule, string>, so its keys ARE the union —
// TypeScript fails the build if a rule is added to the type and not to it, which
// makes this an exhaustive list rather than a hand-maintained one.
const ALL_RULES = Object.keys(RULE_LABELS) as ParkingRule[];

/**
 * Parse a NAMED colour table out of a source file.
 *
 * Scoped to the one table rather than the whole file: these modules also hold
 * street-rule and member colours, and a file-wide scan would silently mix them
 * in. Keys are optionally quoted, because the tables genuinely mix the two
 * (`paid:` next to `"free-2hr":` — the hyphenated slugs have to be quoted).
 */
function hexTable(src: string, constName: string): Record<string, string> {
  const start = src.indexOf(`const ${constName}`);
  if (start === -1) throw new Error(`no ${constName} in this file`);
  const end = src.indexOf("};", start);
  const block = src.slice(start, end);
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/"?([a-z0-9-]+)"?:\s*"(#[0-9a-fA-F]{6})"/g)) out[m[1]] = m[2];
  return out;
}

/* ---- colour maths (WCAG relative luminance + CIE Lab ΔE76) ------------- */
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (h: string) => {
  const [r, g, b] = rgb(h).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
function lab(h: string): [number, number, number] {
  const [r, g, b] = rgb(h).map(lin);
  const [X, Y, Z] = [
    (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047,
    r * 0.2126 + g * 0.7152 + b * 0.0722,
    (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883,
  ];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const deltaE = (a: string, b: string) =>
  Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

/** KEEP IN SYNC with mapStyle()'s PALETTE (src/lib/map/basemap.ts, ADR-0007). */
const BASE_SURFACES = [
  "#e4e8e4", // earth
  "#d8ddd7", // buildings
  "#b3cbad", // forest
  "#aac4a4", // greenspace
  "#b5d2de", // water
  "#ffffff", // road
  "#e6dcc4", // highway
  "#eef0ee", // paper
];

describe("every declared parking rule is known to every copy of the table", () => {
  it("has a visitor-facing label", () => {
    const missing = ALL_RULES.filter((r) => !(r in PARKING_RULE_LABELS));
    expect(missing, `no label in parking-labels.ts: ${missing.join(", ")}`).toEqual([]);
  });

  it("has a label in the frozen map component too", () => {
    // The popup's own copy. parking-labels.ts documents it as a deliberate
    // hand-copy; this is what stops the two drifting on a NEW slug.
    const table = FEATURE_MAP.slice(
      FEATURE_MAP.indexOf("const PARKING_RULE_LABELS"),
      FEATURE_MAP.indexOf("const PARKING_RULE_LABELS") + 600,
    );
    const missing = ALL_RULES.filter((r) => !table.includes(`"${r}"`) && !table.includes(`${r}:`));
    expect(missing, `no popup label in feature-map.tsx: ${missing.join(", ")}`).toEqual([]);
  });

  it("has a colour in all three hand-synced colour tables", () => {
    for (const [name, src, table] of [
      ["feature-map.tsx", FEATURE_MAP, "PARKING_RULE_COLORS"],
      ["admin/map/editor.tsx", ZONE_EDITOR, "RULE_COLORS"],
      ["admin/maps/editor.tsx", CMS_EDITOR, "PARKING_RULE_COLORS"],
    ] as const) {
      const colours = hexTable(src, table);
      const missing = ALL_RULES.filter((r) => !(r in colours));
      expect(missing, `${name} has no colour for: ${missing.join(", ")}`).toEqual([]);
    }
  });

  it("agrees on the colour across all three tables", () => {
    const [a, b, c] = [
        hexTable(FEATURE_MAP, "PARKING_RULE_COLORS"),
        hexTable(ZONE_EDITOR, "RULE_COLORS"),
        hexTable(CMS_EDITOR, "PARKING_RULE_COLORS"),
      ];
    for (const r of ALL_RULES) {
      const set = new Set([a[r], b[r], c[r]].map((h) => h?.toLowerCase()));
      expect(set.size, `${r} is a different colour in different files: ${[...set].join(" / ")}`).toBe(1);
    }
  });

  it("is accepted by the admin API's validation whitelist", () => {
    // Absent here, the editor offers the rule and the save 400s.
    const missing = ALL_RULES.filter((r) => !PARKING_API.includes(`"${r}"`));
    expect(missing, `not in the API RULES whitelist: ${missing.join(", ")}`).toEqual([]);
  });

  it("is offered by the zone editor's dropdown", () => {
    const missing = ALL_RULES.filter((r) => !ZONE_EDITOR.includes(`"${r}"`));
    expect(missing, `not in the editor RULES array: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no label that is just the slug back again", () => {
    for (const r of ALL_RULES) {
      expect(PARKING_RULE_LABELS[r], r).not.toBe(r);
      expect(RULE_LABELS[r], r).not.toBe(r);
    }
  });
});

describe("the free-vs-paid projection", () => {
  it("gives every declared rule a deliberate answer, including `undefined`", () => {
    // COST_VALUES-shaped or undefined; the point is that a new rule cannot fall
    // through freeOrPaidFromRule's switch by accident and land on `undefined`
    // without anyone deciding that is right. Listing them here IS the decision.
    const expected: Record<ParkingRule, "free" | "paid" | undefined> = {
      "free-2hr": "free",
      "free-unrestricted": "free",
      paid: "paid",
      // Free to a visitor, who becomes a customer simply by going in — the
      // reasoning, and the counter-argument, are written out in
      // parking-labels.ts. Change BOTH if this flips.
      "business-customer": "free",
      "park-and-ride-24h": "free",
      // A visitor cannot park in these at any price, so a money badge would be
      // the wrong question rather than a missing answer.
      prohibited: undefined,
      "load-zone": undefined,
      permit: undefined,
    };
    for (const rule of ALL_RULES) {
      expect(freeOrPaidFromRule(rule), rule).toBe(expected[rule]);
    }
  });

  it("never calls customer parking paid — it costs a visitor nothing", () => {
    expect(freeOrPaidFromRule("business-customer")).not.toBe("paid");
  });
});

describe("ADR-0007 §4 — zero confusable pairs inside the parking legend", () => {
  const colours = hexTable(FEATURE_MAP, "PARKING_RULE_COLORS");
  const pairs = ALL_RULES.flatMap((a, i) =>
    ALL_RULES.slice(i + 1).map((b) => ({ a, b, d: deltaE(colours[a], colours[b]) })),
  );

  it("keeps every pair perceptually far apart", () => {
    // 30 is a floor with headroom: the tightest shipped pair is ~36
    // (park-and-ride / load-zone). A new rule colour that lands under this is
    // the "confusable pair" the ADR was written to eliminate.
    const tight = pairs.filter((p) => p.d < 30);
    expect(
      tight.map((p) => `${p.a}/${p.b} ΔE=${p.d.toFixed(1)}`),
      "confusable parking colours",
    ).toEqual([]);
  });

  it("the newest rule is not the tightest pair in the legend", () => {
    // Adding a colour must not quietly become the worst case — if it does, it
    // needed a different hue, not a smaller floor.
    const withNew = pairs.filter((p) => p.a === "business-customer" || p.b === "business-customer");
    const others = pairs.filter((p) => !withNew.includes(p));
    expect(Math.min(...withNew.map((p) => p.d))).toBeGreaterThan(
      Math.min(...others.map((p) => p.d)),
    );
  });
});

describe("rule colour legibility", () => {
  const colours = hexTable(FEATURE_MAP, "PARKING_RULE_COLORS");

  /**
   * RECORDED, NOT ENDORSED — a ratchet, not a pass mark.
   *
   * These ADR-0007 colours already sit below 3:1 against the lightest base
   * surfaces (WCAG 1.4.11 for graphical objects) and/or below 4.5:1 for the
   * white pill text in the popup. They predate this test and are the ADR's to
   * change, not this file's. Pinning the exact set means a NEW rule colour
   * cannot join them silently — and that fixing one of them fails here too,
   * which is the prompt to update this list deliberately.
   */
  const LEGACY_BELOW_SURFACE_BAR = ["free-2hr", "free-unrestricted", "prohibited", "load-zone", "permit"];
  const LEGACY_BELOW_WHITE_TEXT_BAR = ["free-2hr", "free-unrestricted", "load-zone"];

  it("no NEW rule colour drops below 3:1 on the base surfaces", () => {
    const failing = ALL_RULES.filter(
      (r) => Math.min(...BASE_SURFACES.map((s) => contrast(colours[r], s))) < 3,
    );
    expect(failing.sort()).toEqual([...LEGACY_BELOW_SURFACE_BAR].sort());
  });

  it("no NEW rule colour drops below 4.5:1 for the popup's white pill text", () => {
    const failing = ALL_RULES.filter((r) => contrast("#ffffff", colours[r]) < 4.5);
    expect(failing.sort()).toEqual([...LEGACY_BELOW_WHITE_TEXT_BAR].sort());
  });

  it("business-customer clears both bars", () => {
    const c = colours["business-customer"];
    expect(Math.min(...BASE_SURFACES.map((s) => contrast(c, s)))).toBeGreaterThanOrEqual(3);
    // Better than the P&R badge (6.69:1) the ADR was written to fix.
    expect(contrast("#ffffff", c)).toBeGreaterThan(6.6);
  });
});

describe("the CMS feature taxonomy mirrors the zone rule", () => {
  it("offers a matching customer-parking type, in the same colour", () => {
    // Two taxonomies exist (docs/MAPS.md, "Two divergent parking color maps").
    // They are already hand-synced; a brand-new concept should not deepen the
    // divergence by existing on only one side.
    const type = PARKING_TYPES.find((t) => t.key === "customer");
    expect(type, "PARKING_TYPES has no `customer` entry").toBeDefined();
    expect(type!.color.toLowerCase()).toBe(hexTable(FEATURE_MAP, "PARKING_RULE_COLORS")["business-customer"].toLowerCase());
  });
});
