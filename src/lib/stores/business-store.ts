// Portal-editable restaurant/business listings.
// Seed data ships in src/lib/data/restaurants.ts; portal edits overlay it.

import type { Restaurant } from "../types";
import { restaurants as seed } from "../data/restaurants";
import {
  readMerged,
  readMergedAdmin,
  writeOverlayRecord,
  type WithStatus,
  type WriteMeta,
} from "./json-store";

const STORE = "restaurants";

export async function getRestaurants(): Promise<Restaurant[]> {
  return readMerged<Restaurant>(STORE, seed);
}

export async function getRestaurant(id: string): Promise<Restaurant | undefined> {
  return (await getRestaurants()).find((r) => r.id === id);
}

/** PRIVILEGED (E08): every status, status surfaced — admin surfaces only. */
export async function getRestaurantsAdmin(): Promise<WithStatus<Restaurant>[]> {
  return readMergedAdmin<Restaurant>(STORE, seed);
}

export async function saveRestaurant(record: Restaurant, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(STORE, record, meta);
}

// Permanent removal: custom records vanish; seed records get a tombstone that
// hides them from the site (restorable by clearing the overlay row). For a
// reversible "take it off the page for now" use the `hidden` flag on the
// record instead — that keeps it in the admin list to switch back on.
export async function deleteRestaurant(id: string, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(
    STORE,
    { id, _deleted: true } as Restaurant & { _deleted: true },
    meta,
  );
}
