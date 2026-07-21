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

import { del, put } from "@vercel/blob";

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

/**
 * True only for a URL this app itself could have produced via putImage():
 * https, and a hostname that is exactly (or a subdomain of) our Vercel Blob
 * store. Anything else — including other https URLs — must NOT be redirected
 * to, or the image routes are an open redirect on our own domain. Distinct
 * from the storage-form detectors named isBlobUrl() in map-store.ts /
 * hunt-store.ts, which only distinguish "URL" from "filesystem path" at other
 * call sites and must not be repurposed as a trust check.
 */
export function isTrustedBlobUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.hostname.endsWith(".public.blob.vercel-storage.com");
}

/**
 * Permanently delete a stored blob (E11 privacy retention / MHMDA-delete
 * fulfillment). Refuses anything that isn't a URL this store produced —
 * a privacy purge must never become an arbitrary-URL delete primitive.
 * Throws on failure: callers delete the artifact FIRST and only then remove
 * the referencing row, so a failed delete leaves a retryable row, never an
 * orphaned photo.
 */
export async function deleteBlob(url: string): Promise<void> {
  if (!isTrustedBlobUrl(url)) {
    throw new Error("deleteBlob: refusing to delete a non-blob-store URL");
  }
  await del(url);
}
