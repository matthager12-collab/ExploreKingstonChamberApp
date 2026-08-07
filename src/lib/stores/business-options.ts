// The store-reading half of the business picker (the pure half, including the
// matching rule and the de-dupe, is src/lib/businesses.ts — which stays
// importable from client components).
//
// Live-only: every getter here is the public variant, so a pending or draft
// listing is never offered as a choice.

import "server-only";

import {
  dedupeBusinessOptions,
  type BusinessOption,
} from "../businesses";
import { getCharities } from "./charity-store";
import { getDirectoryListings } from "./directory-store";
import { getLodging } from "./listing-stores";
import { getRestaurants } from "./business-store";

/** Every live listing across the four stores, as one sorted picker list. */
export async function getBusinessOptions(): Promise<BusinessOption[]> {
  const [restaurants, lodging, charities, directory] = await Promise.all([
    getRestaurants(),
    getLodging(),
    getCharities(),
    getDirectoryListings(),
  ]);

  return dedupeBusinessOptions([
    ...restaurants.map((r) => ({ value: `eat:${r.id}`, label: r.name, kind: "eat" as const })),
    ...lodging.map((l) => ({ value: `stay:${l.id}`, label: l.name, kind: "stay" as const })),
    ...charities.map((c) => ({ value: `give:${c.id}`, label: c.name, kind: "give" as const })),
    ...directory.map((d) => ({
      value: `directory:${d.id}`,
      label: d.name,
      kind: "directory" as const,
    })),
  ]);
}
