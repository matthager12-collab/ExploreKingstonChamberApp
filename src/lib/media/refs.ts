// Pure helpers and types for the shared photo library. No fs, no blob, no
// server-only — safe to import from client components (the library grid, the
// slot pickers) as well as from the server store.
//
// This split exists for the same reason events/attachment-refs.ts does: the
// store module imports fs/promises, so anything a "use client" file needs must
// live somewhere the bundler can follow without dragging Node built-ins into
// the browser bundle.

/** One item in the library. `id` IS the stored file name ("<sha1>.<ext>") — a
 *  content hash, so re-uploading identical bytes lands on the same record
 *  instead of creating a duplicate. */
export interface MediaItem {
  id: string;
  /** Admin-facing name — the original filename, for finding it again later. */
  title: string;
  /**
   * Default alternative text, describing what is IN the photo.
   *
   * Held on the library item rather than only at each placement because the
   * subject of a photo does not change when you move it from the hero to a
   * listing card. Placements may still override it where a slot needs context
   * the raw description lacks.
   */
  alt: string;
  /** Photographer / source, shown as a credit line where the design allows. */
  credit?: string;
  /** "YYYY-MM-DD" (Pacific) — when it entered the library. */
  addedAt: string;
  /** Byte size AFTER metadata stripping, for the library's weight warnings. */
  bytes: number;
}

/** Accepted upload types → the extension the store records. An explicit
 *  allowlist, not a regex on file.type, so an unexpected type can never reach
 *  the metadata stripper with an extension it does not understand. */
export const MEDIA_TYPE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const MEDIA_EXT_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/** Cap on one upload's bytes. */
export const MAX_MEDIA_BYTES = 12 * 1024 * 1024; // ~12 MB

/**
 * The one shape a stored media name may take: a bare content hash plus a known
 * extension. Duplicated as a regex in store-schemas.ts (`mediaNameId`) on
 * purpose — the record gate and the filesystem/R2 gate must agree, and a shared
 * import there would drag this module into the DB layer's dependency graph.
 */
export const MEDIA_NAME_RE = /^[a-f0-9]{8,}\.(jpg|jpeg|png|webp|gif)$/i;

export function isMediaName(value: unknown): value is string {
  return typeof value === "string" && MEDIA_NAME_RE.test(value);
}

/**
 * Public URL for a stored name — the one way any surface should reference a
 * library photo, so the private-bucket proxy stays the only read path.
 *
 * A PATH SEGMENT, deliberately, not `?p=<name>`: next/image rejects a local src
 * with a query string unless images.localPatterns allows it, and the page
 * rendering such an image 500s. See the note in api/media/[name]/route.ts.
 * Anything that changes this shape must keep it query-free.
 */
export function mediaUrl(name: string): string {
  return `/api/media/${encodeURIComponent(name)}`;
}
