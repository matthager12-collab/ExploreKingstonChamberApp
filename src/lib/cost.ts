// E27 — the one free-vs-paid vocabulary (M-04-06).
//
// Kept React-free so the zod schemas and the map types can import it without
// pulling a component into their graph; src/components/cost-badge.tsx is the
// only place it turns into pixels.
//
// This is a THIRD axis, deliberately separate from the two that already exist,
// because conflating them has already caused confusion once:
//   - Restaurant.priceLevel (1..3 "$") — how expensive, for places that are
//     paid by nature. Restaurants keep it and do NOT get a `cost`.
//   - ParkingRule / ParkingType — parking's own legal-status taxonomy, which
//     encodes far more than money (permits, load zones, prohibitions).
// `cost` answers only "does this cost a visitor money?", for the things where
// that is genuinely in question: amenities, attractions, itinerary stops.

export const COST_VALUES = ["free", "paid", "free-and-paid", "donation"] as const;

export type CostValue = (typeof COST_VALUES)[number];

/** Visitor-facing wording. The label is the signal — never colour alone
 *  (WCAG 1.4.1), so every badge renders one of these strings. */
export const COST_LABELS: Record<CostValue, string> = {
  free: "Free",
  paid: "Paid",
  "free-and-paid": "Free & paid",
  donation: "By donation",
};

export function isCostValue(v: unknown): v is CostValue {
  return typeof v === "string" && (COST_VALUES as readonly string[]).includes(v);
}
