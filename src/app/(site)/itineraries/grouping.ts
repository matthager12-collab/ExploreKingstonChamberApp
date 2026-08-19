// How /itineraries sorts its cards into sections.
//
// Lives beside the page rather than inside it for two reasons: a `page.tsx`
// is a route-convention file whose extra named exports are not part of the
// documented contract, and this logic is worth unit-testing on its own
// (tests/unit/itinerary-grouping.test.ts).
//
// Everything here is DERIVED from the existing Itinerary shape — no schema
// change, so the admin builder, the API route, and the seed round-trip test
// are all untouched. E29 is chartered to add real structured fields
// (`layoverMinutes`, `pace`, a widened `audience`); when that lands, this
// grouping should be rebuilt on top of them and the string-sniffing below
// can go.

import type { Itinerary } from "@/lib/types";

/**
 * Multi-day plans are recognised by their stop times: a two- or three-day
 * itinerary times its stops "Day 1 10:25 AM" instead of "10:25 AM". That is a
 * convention, not a constraint — which is exactly why the page keeps a
 * leftover bucket for anything no group claims.
 */
const DAY_PREFIX = /^Day\s+\d/i;

export function isMultiDay(it: Itinerary): boolean {
  return it.stops.some((stop) => DAY_PREFIX.test(stop.time));
}

export interface ItineraryGroup {
  key: string;
  title: string;
  subtitle: string;
  match: (it: Itinerary) => boolean;
}

/**
 * Group order follows the order a ferry visitor actually asks the questions:
 * can I do this without a car, and how long have I got? The car-free section
 * comes first on purpose — it is the question this town gets asked most and
 * the one the regional guides never answer.
 */
export const GROUPS: ItineraryGroup[] = [
  {
    key: "walk-on",
    title: "Leave the car in Edmonds",
    subtitle:
      "Everything on these plans is within walking distance of the dock, or reachable by a shuttle or a bus.",
    match: (it) => !isMultiDay(it) && it.mode === "walk-on",
  },
  {
    key: "either",
    title: "Car optional",
    subtitle: "These work on foot, but a car opens up an extra stop or two.",
    match: (it) => !isMultiDay(it) && it.mode === "either",
  },
  {
    key: "car",
    title: "Worth bringing the car",
    subtitle:
      "Gardens, beaches, a mill town and a lighthouse — the parts of North Kitsap that need wheels.",
    match: (it) => !isMultiDay(it) && it.mode === "car",
  },
  {
    key: "multi-day",
    title: "Staying more than a day",
    subtitle: "Where to sleep, and how to spread the good stuff across two or three days.",
    match: isMultiDay,
  },
];

/**
 * Partition the itineraries into their sections. Returns the groups in display
 * order plus whatever matched nothing, so the caller can render leftovers
 * rather than drop them: an itinerary that silently fails to appear is the
 * worst outcome here — the Chamber saves it, it looks saved, and no visitor
 * ever sees it.
 */
export function groupItineraries(itineraries: Itinerary[]): {
  groups: (ItineraryGroup & { items: Itinerary[] })[];
  leftovers: Itinerary[];
} {
  const unclaimed = new Set(itineraries);
  const groups = GROUPS.map((group) => {
    const items = itineraries.filter((it) => unclaimed.has(it) && group.match(it));
    for (const it of items) unclaimed.delete(it);
    return { ...group, items };
  });
  return { groups, leftovers: itineraries.filter((it) => unclaimed.has(it)) };
}
