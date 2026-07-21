// E14 — human labels for the parking-zone `rule` slugs (M-14-04).
//
// On the map canvas a lot's type is carried by its MARKER COLOUR, and the type
// name only appears inside a popup you have to tap. The text alternative on
// /parking ("Every lot, in words") therefore has to spell the type out — and
// printing the raw slug ("free-2hr", "park-and-ride-24h") does not do that: it
// is an internal enum, not something a visitor reads.
//
// DELIBERATE DUPLICATE. src/components/feature-map.tsx carries the same table
// for the popups, and that file is frozen (.agent-frozen) — it cannot import
// from here, and this module must not import from it (a client Leaflet module
// has no business in a server page's graph). Keep the two in sync BY HAND: if a
// rule slug is added to src/lib/data/parking.ts, add it in both places.
// tests/unit/parking-labels.test.ts fails when a slug used by the seed data has
// no label here, which is the guard that makes the duplication survivable.

import type { CostValue } from "@/lib/cost";
export const PARKING_RULE_LABELS: Record<string, string> = {
  "free-2hr": "Free · 2-hour limit",
  "free-unrestricted": "Free · no time limit",
  paid: "Paid lot",
  "park-and-ride-24h": "Park & ride · 24 hr",
  prohibited: "No parking",
  "load-zone": "Load zone",
  permit: "Permit parking",
};

/** The label a visitor reads. Falls back to the slug rather than to nothing —
 *  an unmapped rule should look wrong in review, not vanish from the page. */
export function parkingRuleLabel(rule: string): string {
  return PARKING_RULE_LABELS[rule] ?? rule;
}

/* ------------------------------------------------------------------ */
/* E27 — the free-vs-paid axis, projected off the parking rule         */
/* ------------------------------------------------------------------ */

/**
 * Maps a parking rule to the shared free-vs-paid badge, or `undefined` to
 * render NO badge for that rule.
 *
 * This is a projection, not a rename: `ParkingRule` encodes legal status
 * (permits, load zones, prohibitions), while `CostValue` answers only "does
 * this cost a visitor money?". Several rules do not answer that question at
 * all, which is why `undefined` is a first-class return value here.
 *
 * The rules, for reference (src/lib/data/parking.ts):
 *   free-2hr            free, but strictly enforced 2-hour limit ($40 overstay)
 *   free-unrestricted   free, no time limit
 *   paid                paid lot (Port text-to-pay / Diamond)
 *   park-and-ride-24h   Kitsap park & ride, free, 24 hr max
 *   permit              permit holders only — a visitor cannot park here at all
 *   load-zone           loading / dropoff only — not visitor parking
 *   prohibited          no parking
 *
 * TODO(mat): implement the mapping body. See the note in the E27 session for
 * the trade-offs — the interesting call is what the last three rules return.
 */
export function freeOrPaidFromRule(rule: string): CostValue | undefined {
  throw new Error("freeOrPaidFromRule: not implemented");
}
