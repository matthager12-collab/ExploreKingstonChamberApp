// Which library photo (if any) fills each registered photo slot.
//
// Kept OUT of site-store.ts even though it is the same category of thing.
// site-store is imported by nearly every public page; this module needs the
// media library, and media-store is server-only. Merging them would drag that
// dependency onto every page that only wanted a copy override.
//
// The store holds ONLY overrides, exactly like site-copy: a slot nobody has
// touched costs nothing and always tracks the /brand/ asset the code ships,
// which is what makes "Reset to default" honest.

import "server-only";

import { readMerged, writeOverlayRecord, type WriteMeta } from "./json-store";
import { getMediaItems } from "./media-store";
import type { MediaItem } from "../media/refs";

const PHOTO_STORE = "site-photos";

export interface PhotoOverride {
  /** The slot key, e.g. "home.hero". */
  id: string;
  /** A media library name ("<sha1>.<ext>"). */
  name: string;
  /**
   * Alt text for THIS placement, when the library item's own description is
   * not the right thing to say here. Optional: most placements should just use
   * the library description, and a per-slot override that silently drifts from
   * the photo is worse than no override at all.
   */
  alt?: string;
}

/** Slot key → override, for the slots that have one. */
export async function getPhotoOverrides(): Promise<Record<string, PhotoOverride>> {
  const rows = await readMerged<PhotoOverride>(PHOTO_STORE, []);
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

export async function savePhotoOverride(
  override: PhotoOverride,
  meta?: WriteMeta,
): Promise<void> {
  await writeOverlayRecord(PHOTO_STORE, override, meta);
}

/** Send a slot back to the photo the code ships with. */
export async function clearPhotoOverride(slotKey: string, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(
    PHOTO_STORE,
    { id: slotKey, _deleted: true } as PhotoOverride & { _deleted: true },
    meta,
  );
}

/** Everything a render or the admin editor needs, in one pair of store reads. */
export async function getPhotoContext(): Promise<{
  overrides: Record<string, PhotoOverride>;
  library: Record<string, MediaItem>;
}> {
  const [overrides, items] = await Promise.all([getPhotoOverrides(), getMediaItems()]);
  return {
    overrides,
    library: Object.fromEntries(items.map((i) => [i.id, i])),
  };
}
