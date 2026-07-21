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
 * The last three return `undefined` ON PURPOSE. A visitor cannot park in a
 * permit row, a load zone, or a no-parking area at any price, so "Free" and
 * "Paid" are both wrong answers — and "Free" would be actively harmful, since
 * a permit row is free only to people who already hold a permit. The rule
 * label beside the badge already reads "Permit parking" / "Load zone" / "No
 * parking", which is the accurate thing to say; a cost badge would either
 * repeat it or contradict it. Stretching this into a "Restricted" value was
 * considered and rejected: it turns a money question into a legal-status
 * question, which is the exact conflation src/lib/cost.ts exists to prevent.
 */
export function freeOrPaidFromRule(rule: string): CostValue | undefined {
  switch (rule) {
    case "free-2hr":
    case "free-unrestricted":
    case "park-and-ride-24h":
      // "free-2hr" still reads plain "Free" even though its label says
      // "Free · 2-hour limit". The badge is the scannable money signal and is
      // meant to look identical everywhere; the label carries the nuance.
      // Suppressing it here would make the badge's ABSENCE mean two different
      // things — "costs nothing" and "you cannot park here".
      return "free";
    case "paid":
      return "paid";
    default:
      return undefined;
  }
}
