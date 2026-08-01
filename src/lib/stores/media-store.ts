// The shared media library — one place photos are uploaded, and the pool every
// other surface picks from (site photo slots, kiosk carousel, listing photos).
//
// WHY A LIBRARY RATHER THAN PER-RECORD UPLOADS. Before this, the only uploadable
// images were map-feature photos (map-store) and hunt reference photos
// (hunt-store), each with its own upload route and its own copy of the bytes.
// That is fine while there are two of them and terrible at eight: the same
// harbour photo would be uploaded once for the home hero, again for the kiosk,
// again for a listing card, and a re-crop would have to be re-done in three
// places. Here the BYTES are stored once, content-addressed, and every consumer
// stores only the short name. Two surfaces using the same photo genuinely share
// one object.
//
// WHAT IS DELIBERATELY *NOT* MIGRATED. map-feature and hunt images keep their
// existing namespaces and routes. They already work, their records are live in
// production, and folding them in would mean rewriting stored record values for
// no visitor-visible gain. The library is additive; unifying them later is a
// pure data migration if it ever earns its keep.
//
// STORAGE MIRRORS map-store EXACTLY — R2 in production under "media/<name>",
// .data/media/ in local dev, bare content-hashed name on the record either way.
// That is not copy-paste laziness: keeping the two layouts identical means the
// E15 migration tooling, the path-sanitisation regexes and the backup job all
// keep working without learning a second shape.

import "server-only";

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { dataPath } from "../data-dir";
import { readMerged, writeOverlayRecord, type WriteMeta } from "./json-store";
import { getObject, hasR2, putObject } from "../blob-store";
import { stripImageMetadata } from "../image-sanitize";
import { MEDIA_EXT_CONTENT_TYPES, MEDIA_NAME_RE, type MediaItem } from "../media/refs";

const MEDIA_STORE = "media";
const IMAGE_DIR = dataPath("media");

export type { MediaItem };

/** Every library item, newest first. */
export async function getMediaItems(): Promise<MediaItem[]> {
  const rows = await readMerged<MediaItem>(MEDIA_STORE, []);
  return rows.slice().sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0));
}

export async function getMediaItem(id: string): Promise<MediaItem | undefined> {
  return (await getMediaItems()).find((m) => m.id === id);
}

export async function saveMediaItem(item: MediaItem, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(MEDIA_STORE, item, meta);
}

/**
 * Remove an item from the library.
 *
 * The BYTES are intentionally left in place. A tombstoned row can be restored
 * from the audit log (E09), and a restore that brought back a record pointing at
 * deleted bytes would be a broken image with no way back. Object storage is
 * cheap; a silently-broken restore is not. Genuine byte deletion belongs to the
 * privacy-purge path (E11), which is the only caller that must guarantee
 * erasure.
 */
export async function deleteMediaItem(id: string, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(
    MEDIA_STORE,
    { id, _deleted: true } as MediaItem & { _deleted: true },
    meta,
  );
}

// ---------- bytes ----------

/**
 * Store uploaded image bytes and return the name to record.
 *
 * Order matters and is load-bearing: strip metadata FIRST, then hash the
 * CLEANED bytes. Hashing the original would name the object after content it no
 * longer contains, and the same photo re-uploaded from a phone (whose EXIF
 * differs run to run) would hash differently every time and defeat dedupe.
 * Copied deliberately from saveFeatureImage() — see the note at the top of this
 * file about keeping the two layouts identical.
 */
export async function saveMediaImage(bytes: Buffer, ext: string): Promise<string> {
  const safeExt = /^(jpg|jpeg|png|webp|gif)$/i.test(ext) ? ext.toLowerCase() : "jpg";
  const contentType = MEDIA_EXT_CONTENT_TYPES[safeExt] ?? "image/jpeg";
  const clean = stripImageMetadata(bytes, contentType);
  const { createHash } = await import("crypto");
  const hash = createHash("sha1").update(clean).digest("hex").slice(0, 16);
  const name = `${hash}.${safeExt}`;
  if (hasR2()) {
    await putObject(`media/${name}`, clean, contentType);
    return name;
  }
  await mkdir(IMAGE_DIR, { recursive: true });
  await writeFile(path.join(IMAGE_DIR, name), clean);
  return name;
}

/**
 * The strict validator for anything that reaches the filesystem or an R2 key.
 * A stored name is a bare content hash plus a known extension — no separators,
 * no traversal, nothing else. Returns null for anything that fails, and the
 * callers treat null as "404 this one image".
 *
 * Unlike map-store's equivalent there is no https-URL branch: the library was
 * born after the E15 R2 cutover, so it never had a Vercel Blob era to be
 * backwards compatible with.
 */
export function mediaImagePath(name: string): string | null {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  if (!MEDIA_NAME_RE.test(name)) return null;
  return path.join(IMAGE_DIR, name);
}

/** Content type implied by a validated name. */
function typeOf(name: string): string {
  const ext = name.split(".").pop()!.toLowerCase();
  return MEDIA_EXT_CONTENT_TYPES[ext] ?? "image/jpeg";
}

/**
 * Read stored bytes. Disk first, R2 as the fallback, and NEVER throws — a store
 * blip must 404 the single image request rather than 500 the page that embeds
 * it. Health checks gate on Postgres only, by design, so an image-store outage
 * must not be able to take the service out of rotation.
 */
export async function readMediaImage(
  name: string,
): Promise<{ bytes: Buffer; type: string } | null> {
  const abs = mediaImagePath(name);
  if (!abs) return null;
  const type = typeOf(name);
  try {
    return { bytes: await readFile(abs), type };
  } catch {
    if (!hasR2()) return null;
    try {
      const obj = await getObject(`media/${name}`);
      return obj ? { bytes: Buffer.from(obj.bytes), type } : null;
    } catch {
      return null;
    }
  }
}
