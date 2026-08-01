// Turning a photo slot into something you can hand to <Image>.
//
// Pure and client-safe (no fs, no server-only) so a Server Component render
// path and the admin preview can share one implementation — if the admin
// preview resolved differently from the live page, the editor would be lying
// about what visitors will see.

import { photoSlot, type PhotoSlotKey, type ResolvedPhoto } from "./photo-slots";
import { mediaUrl, type MediaItem } from "./media/refs";

export interface PhotoOverrideLike {
  name: string;
  alt?: string;
}

/**
 * Resolve one slot to a src + alt.
 *
 * The SRC half is simple: an override points at a library photo, otherwise the
 * /brand/ asset from the registry.
 *
 * The ALT half is where the real decision lives — see resolveAlt below.
 */
export function resolvePhoto(
  key: PhotoSlotKey,
  override: PhotoOverrideLike | undefined,
  library: Record<string, MediaItem>,
): ResolvedPhoto {
  const slot = photoSlot(key);

  // An override naming a photo that is no longer in the library (removed, or a
  // restore that brought back a stale row) falls back to the shipped asset
  // rather than rendering a broken image.
  const item = override ? library[override.name] : undefined;
  if (!override || !item) {
    return {
      src: slot.fallback,
      alt: slot.decorative ? "" : (slot.fallbackAlt ?? ""),
    };
  }

  return {
    src: mediaUrl(item.id),
    alt: resolveAlt(key, override, item),
    ...(item.credit ? { credit: item.credit } : {}),
  };
}

/**
 * Decide what a placed photo announces to a screen reader.
 *
 * The inputs, in priority order, and why each exists:
 *   1. slot.decorative — the photo is a backdrop; the page says everything
 *      already (the home hero sits behind the headline). Announcing anything
 *      here adds noise between the title and the content.
 *   2. override.alt    — alt written FOR THIS SLOT, when the library
 *      description is not the right thing to say in this position.
 *   3. item.alt        — the library's description of what is in the photo.
 *      Usually the right answer, and the reason alt lives on the library item.
 *   4. slot.fallbackAlt — see the decision below.
 *
 * DECISION (Mat, 2026-07-31): a CONTENT slot holding a photo with no
 * description anywhere falls back to the SLOT's shipped alt text. The
 * placement UI gates against creating that state, but a restore, an import, or
 * a description cleared after placement can still reach here.
 *
 * The known cost, recorded so nobody "fixes" this by accident: the slot's alt
 * describes the photo that SHIPPED in that position, not the one now in it. A
 * listener can be told about a lighthouse while a picture of a restaurant is on
 * screen. That was chosen over silence (an empty alt is skipped entirely, and
 * nothing ever surfaces the gap) — so the mitigation has to be that the gap is
 * VISIBLE and gets fixed: the admin picker flags any content slot whose photo
 * has no description, and photo-resolve.test.ts pins this branch so a change
 * here is deliberate.
 *
 * Note E14's axe gate cannot help either way — every branch here emits valid
 * markup. Only the admin UI and these tests police it.
 */
export function resolveAlt(
  key: PhotoSlotKey,
  override: PhotoOverrideLike,
  item: MediaItem,
): string {
  const slot = photoSlot(key);
  if (slot.decorative) return "";

  const placed = override.alt?.trim();
  if (placed) return placed;

  const described = item.alt.trim();
  if (described) return described;

  return slot.fallbackAlt ?? "";
}

/**
 * True when a placement is relying on the fallback above — i.e. a content slot
 * whose photo carries no description. This is the signal the admin UI raises,
 * and it exists because the resolved alt alone cannot be distinguished from a
 * correct one at the call site.
 */
export function isAltStale(
  key: PhotoSlotKey,
  override: PhotoOverrideLike | undefined,
  library: Record<string, MediaItem>,
): boolean {
  const slot = photoSlot(key);
  if (slot.decorative || !override) return false;
  const item = library[override.name];
  if (!item) return false;
  return !override.alt?.trim() && !item.alt.trim();
}
