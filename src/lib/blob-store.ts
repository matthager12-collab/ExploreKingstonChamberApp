// Blob-storage seam for user/admin-uploaded images (hunt photos, reference
// photos, map-builder images).
//
// Local dev (no BLOB_READ_WRITE_TOKEN) writes image bytes under .data/ via the
// filesystem, exactly as before. Production stores them in Vercel Blob (a
// PUBLIC store) and serves them directly from the returned CDN URL — no
// Function needed to serve.
//
// The contract the stores rely on: putImage() returns a STRING that is either
// a full https blob URL (prod) or a relative path the app's existing image
// routes serve (dev). Either way the value is stored on the record and handed
// to <img src>, so callers don't branch.

import { put } from "@vercel/blob";

/** True when Vercel Blob is configured (prod). */
export function hasBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Upload image bytes to Vercel Blob and return the public CDN URL.
 * `key` is a stable pathname (e.g. "hunts/<huntId>/<stopId>/<ts>.jpg"); with
 * addRandomSuffix the final URL is unique so replacing an image never serves a
 * stale cached copy.
 */
export async function putImage(
  key: string,
  bytes: Buffer | ArrayBuffer,
  contentType: string,
): Promise<string> {
  const { url } = await put(key, bytes, {
    access: "public",
    addRandomSuffix: true,
    contentType,
  });
  return url;
}
