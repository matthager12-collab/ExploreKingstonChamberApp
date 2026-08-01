// Directory listings (E17): imported / hand-created business listings that
// are not curated restaurant, lodging, or charity records. No git seed —
// every record lives in the overlay, so the merge helpers get an empty seed
// array. Default getters are live-only (E08 fail-closed floor); admin
// surfaces use the *Admin variant. NOTE: no public page renders this store
// yet (E17 non-goal) — the live-only default exists so whichever epic adds
// one inherits the gate instead of a leak.

import type { DirectoryListing } from "../types";
import {
  readMerged,
  readMergedAdmin,
  writeOverlayRecord,
  type WithStatus,
  type WriteMeta,
} from "./json-store";

const STORE = "directory";

const NO_SEED: DirectoryListing[] = [];

export async function getDirectoryListings(): Promise<DirectoryListing[]> {
  return readMerged<DirectoryListing>(STORE, NO_SEED);
}

export async function getDirectoryListing(
  id: string,
): Promise<DirectoryListing | undefined> {
  return (await getDirectoryListings()).find((r) => r.id === id);
}

/** PRIVILEGED (E08): every status, status surfaced — admin surfaces only. */
export async function getDirectoryListingsAdmin(): Promise<
  WithStatus<DirectoryListing>[]
> {
  return readMergedAdmin<DirectoryListing>(STORE, NO_SEED);
}

export async function saveDirectoryListing(
  record: DirectoryListing,
  meta?: WriteMeta,
): Promise<void> {
  await writeOverlayRecord(STORE, record, meta);
}

export async function deleteDirectoryListing(
  id: string,
  meta?: WriteMeta,
): Promise<void> {
  await writeOverlayRecord(
    STORE,
    { id, _deleted: true } as DirectoryListing & { _deleted: true },
    meta,
  );
}
