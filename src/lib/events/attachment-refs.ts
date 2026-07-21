// Pure helpers for event-attachment references (E12 follow-up). No fs, no
// blob, no server-only — safe to import from a Server Component render path
// (the event card, the feed) as well as the server store below.
//
// A stored attachment ref is one of two shapes, mirroring hunt photos:
//   - a full https Vercel Blob URL (production), or
//   - a path relative to .data/events (local dev), e.g. "<eventId>/<file>.jpg".
// Either way the ref carries a real file extension at the end, so kind and
// content-type derive from it.

/** Cap on a single attachment's bytes (matches the suggest route + hunt photos). */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // ~8 MB

/** The allowlist (E12 follow-up, Mat's call 2026-07-21): images + PDF only.
 *  Deliberately NOT "all formats" — an anonymous public upload served from the
 *  Chamber's own domain must never be an executable, HTML, or SVG (script)
 *  vector. Office docs are excluded too (macro vector, not web-displayable). */
export const ATTACHMENT_EXT_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  pdf: "application/pdf",
};

const MIME_EXTS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heic",
  "application/pdf": "pdf",
};

/** A safe file extension for the given upload, or null when it isn't in the
 *  allowlist. Trusts the MIME first, then the filename extension. */
export function attachmentExtension(mimeType: string, fileName?: string): string | null {
  const byMime = MIME_EXTS[mimeType.toLowerCase()];
  if (byMime) return byMime;
  const nameExt = fileName?.split(".").pop()?.toLowerCase() ?? "";
  if (!ATTACHMENT_EXT_CONTENT_TYPES[nameExt]) return null;
  return nameExt === "jpeg" ? "jpg" : nameExt;
}

export function attachmentContentType(ref: string): string {
  const ext = extensionOf(ref);
  return ATTACHMENT_EXT_CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** The extension at the end of a ref, ignoring any query string (blob URLs
 *  keep the extension after addRandomSuffix: ".../123-abc123.pdf"). */
function extensionOf(ref: string): string {
  const noQuery = ref.split("?")[0];
  return noQuery.split(".").pop()?.toLowerCase() ?? "";
}

/** True when the stored value is a full https URL (a Vercel Blob URL) rather
 *  than a .data/events-relative path. */
export function isStoredBlobRef(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("https://");
}

/** How the card should render this attachment. */
export function attachmentKind(ref: string): "image" | "pdf" {
  return extensionOf(ref) === "pdf" ? "pdf" : "image";
}

/** The public URL the browser loads: a blob URL serves directly; a dev
 *  filesystem path streams through the attachment route. */
export function attachmentPublicUrl(ref: string): string {
  if (isStoredBlobRef(ref)) return ref;
  return `/api/events/attachment?p=${encodeURIComponent(ref)}`;
}
