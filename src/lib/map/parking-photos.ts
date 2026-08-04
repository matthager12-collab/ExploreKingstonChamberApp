// Turning a parking zone's library photo names into something renderable.
//
// Pure and client-safe (no fs, no server-only), for the same reason
// photo-resolve.ts is: the /parking page renders these server-side, the map
// popup renders them from a payload the client already holds, and the admin
// editor previews them — three call sites that must agree on what a visitor
// sees, which only holds if they share one implementation.
//
// Sister module to src/lib/photo-resolve.ts. That one resolves a NAMED SLOT
// (the home hero, a kiosk panel) which ships with its own fallback image and
// fallback alt text. A parking zone has neither: nothing ships in this
// position, so there is no shipped description to fall back to. That single
// difference is why these are two modules and not one, and it is the whole
// reason resolveParkingPhotoAlt() below has a decision to make at all.

import { mediaUrl, type MediaItem } from "../media/refs";

/** One zone photo, resolved for rendering. */
export interface ParkingPhoto {
  /** Library name, kept so a caller can key on the underlying object. */
  name: string;
  src: string;
  alt: string;
  credit?: string;
}

/**
 * What a parking-zone photo announces to a screen reader when the library item
 * carries no description of its own.
 *
 * THE TRADE-OFF, because the three answers are all defensible:
 *
 *   a) `""` (decorative) — a screen reader skips the image entirely. Quietest,
 *      and honest that we do not know what is in the photo. But a listener is
 *      never told a photo exists, so the gap is invisible forever and the sighted
 *      visitor gets information the blind visitor does not.
 *   b) the zone's name — "Diamond lot D515". Says a photo of this lot exists and
 *      what it is OF, without claiming to describe what is IN it. It is a label,
 *      not a description, and it repeats text already on screen beside it.
 *   c) drop the photo — show nothing to anybody until somebody writes a
 *      description. Strongest forcing function, and it makes the Chamber's
 *      unfinished work cost sighted visitors too.
 *
 * CURRENT DEFAULT: (b). It is the only one that leaves nobody with strictly less
 * than everybody else, and the admin picker flags an undescribed photo so the
 * gap is visible and gets fixed — the same mitigation photo-resolve.ts relies on.
 *
 * Mat: this is the call worth making yourself — it is a product judgment about
 * whose experience degrades, not a technical one, and you have ruled on the
 * analogous slot case before (see the DECISION note in photo-resolve.ts).
 */
export function resolveParkingPhotoAlt(zoneName: string, item: MediaItem): string {
  const described = item.alt.trim();
  if (described) return described;
  return zoneName.trim();
}

/**
 * Resolve a zone's stored photo names against the library.
 *
 * A name with no library row is DROPPED rather than rendered: the item was
 * removed, or a record was restored from an older version that references bytes
 * the library no longer lists. Rendering it would be a broken image icon inside
 * a map popup, which is worse than one fewer photo.
 */
export function resolveParkingPhotos(
  zoneName: string,
  names: string[] | undefined,
  library: Map<string, MediaItem>,
): ParkingPhoto[] {
  if (!names?.length) return [];
  const out: ParkingPhoto[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    const item = library.get(name);
    if (!item) continue;
    out.push({
      name: item.id,
      src: mediaUrl(item.id),
      alt: resolveParkingPhotoAlt(zoneName, item),
      ...(item.credit ? { credit: item.credit } : {}),
    });
  }
  return out;
}

/**
 * True when a placement is leaning on the fallback above — i.e. a zone photo
 * whose library item has no description. The signal the admin editor raises, and
 * it exists for the same reason isAltStale() does in photo-resolve.ts: once the
 * fallback has run, the resolved alt is indistinguishable from a real one at the
 * call site, so the gap has to be detected here or not at all.
 */
export function hasUndescribedPhoto(
  names: string[] | undefined,
  library: Map<string, MediaItem>,
): boolean {
  return (names ?? []).some((n) => {
    const item = library.get(n);
    return !!item && !item.alt.trim();
  });
}
