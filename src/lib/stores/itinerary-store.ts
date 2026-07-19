// Admin-editable itineraries.
// Seed data ships in src/lib/data/itineraries.ts; admin edits overlay it
// (custom-wins-by-id, { _deleted: true } tombstones hide seed records).

import type { Itinerary } from "../types";
import { itineraries as seed } from "../data/itineraries";
import {
  readMerged,
  readMergedAdmin,
  writeOverlayRecord,
  type WithStatus,
  type WriteMeta,
} from "./json-store";

const STORE = "itineraries";

export async function getItineraries(): Promise<Itinerary[]> {
  return readMerged<Itinerary>(STORE, seed);
}

/** PRIVILEGED (E08): every status, status surfaced — admin surfaces only. */
export async function getItinerariesAdmin(): Promise<WithStatus<Itinerary>[]> {
  return readMergedAdmin<Itinerary>(STORE, seed);
}

/** Match on slug across merged records (seed + overlay). */
export async function getItinerary(slug: string): Promise<Itinerary | undefined> {
  return (await getItineraries()).find((i) => i.slug === slug);
}

export async function saveItinerary(record: Itinerary, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(STORE, record, meta);
}

export async function deleteItinerary(id: string, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(
    STORE,
    { id, _deleted: true } as Itinerary & { _deleted: true },
    meta,
  );
}
