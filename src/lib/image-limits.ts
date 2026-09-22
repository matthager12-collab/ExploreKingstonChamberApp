// Shared image size limits and extension mapping.

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // ~8 MB

export const EXT_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

const MIME_EXTS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
};

/** jpeg/png/webp/heic only. Returns a safe file extension or null. */
export function imageExtension(mimeType: string, fileName?: string): string | null {
  const byMime = MIME_EXTS[mimeType.toLowerCase()];
  if (byMime) return byMime;
  const nameExt = fileName?.split(".").pop()?.toLowerCase() ?? "";
  return EXT_CONTENT_TYPES[nameExt] ? (nameExt === "jpeg" ? "jpg" : nameExt) : null;
}

export function contentTypeForPath(p: string): string {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return EXT_CONTENT_TYPES[ext] ?? "application/octet-stream";
}
