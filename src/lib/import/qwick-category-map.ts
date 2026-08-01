// Checked-in mapping from Qwick kiosk category strings → app directory
// categories (E17). Keys are compared case-insensitively after trimming.
// Unknown strings map to 'other' and the raw values are preserved verbatim
// on the record's `sourceCategories`, so a human can refine this file later.
//
// PROVENANCE CAVEAT: the vendor's API died before this map could be checked
// against the live feed (node.qwickmedia.com stopped resolving by
// 2026-08-01), so these keys are a best-effort seed from common tourism-
// directory vocabulary. When an export is recovered, extend this map from
// its real category strings — that is a data edit, not a code change.

import type { DirectoryCategory } from "../schemas/directory";

const MAP: Record<string, DirectoryCategory> = {
  // eat
  restaurants: "eat",
  restaurant: "eat",
  dining: "eat",
  food: "eat",
  "food & drink": "eat",
  cafes: "eat",
  cafe: "eat",
  coffee: "eat",
  bakery: "eat",
  bars: "eat",
  breweries: "eat",
  wineries: "eat",
  // stay
  lodging: "stay",
  accommodations: "stay",
  accommodation: "stay",
  hotels: "stay",
  hotel: "stay",
  "bed & breakfast": "stay",
  camping: "stay",
  rv: "stay",
  "vacation rentals": "stay",
  // shop
  shopping: "shop",
  shop: "shop",
  retail: "shop",
  "retail shops": "shop",
  gifts: "shop",
  galleries: "shop",
  antiques: "shop",
  grocery: "shop",
  marine: "shop",
  // services
  services: "services",
  "professional services": "services",
  health: "services",
  "health & wellness": "services",
  medical: "services",
  finance: "services",
  banking: "services",
  "real estate": "services",
  automotive: "services",
  construction: "services",
  legal: "services",
  insurance: "services",
  salon: "services",
  spa: "services",
  // activities
  activities: "activities",
  recreation: "activities",
  attractions: "activities",
  tours: "activities",
  outdoors: "activities",
  parks: "activities",
  arts: "activities",
  "arts & culture": "activities",
  entertainment: "activities",
  events: "activities",
  fitness: "activities",
  golf: "activities",
  marina: "activities",
  // community
  community: "community",
  nonprofit: "community",
  "non-profit": "community",
  churches: "community",
  education: "community",
  schools: "community",
  government: "community",
  library: "community",
};

/** Map upstream category strings to ONE app category: the first string with
 *  a known mapping wins; no known strings → 'other'. */
export function mapQwickCategories(raw: string[]): DirectoryCategory {
  for (const s of raw) {
    const hit = MAP[s.trim().toLowerCase()];
    if (hit) return hit;
  }
  return "other";
}
