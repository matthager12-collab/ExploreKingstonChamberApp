// Blob-storage seam for user/admin-uploaded images (hunt photos, reference
// photos, map-builder images, event attachments).
//
// THREE BACKENDS, in the order writers prefer them (E15):
//
//   1. Cloudflare R2 (production). A PRIVATE bucket reached over the S3 API.
//      Stored record values stay in the SAME fs-relative format filesystem mode
//      uses, and the app's own image routes proxy the reads — see below.
//   2. Vercel Blob (legacy). Kept working so an existing deployment does not
//      break mid-migration, but nothing new should choose it.
//   3. Filesystem under .data/ (local dev, and production before the E15 disk
//      cutover).
//
// WHY R2 IS PRIVATE AND PROXIED, rather than served from a public URL:
//   - An R2 custom domain requires the DNS zone to be hosted on Cloudflare.
//     Chamber DNS and EMAIL live at NameHero and a nameserver move is rejected
//     in the binding decisions, so that option does not exist here.
//   - `r2.dev` public URLs are rate-limited and documented by Cloudflare as not
//     for production.
//   So the bucket stays private and /api/hunts/photo + /api/map/image +
//   /api/events/attachment read through it. That is also a PRIVACY UPGRADE:
//   hunt player submissions stop being "unguessable but public" (the caveat the
//   old Vercel Blob comments carried) and become genuinely admin-gated, because
//   the gate runs before the read instead of being bypassed by a public URL.
//
// THE CONTRACT EVERY CALLER RELIES ON is unchanged: the value stored on a
// record is a STRING that is either a full https URL (legacy Vercel Blob) or a
// relative path the image routes serve. R2 keys deliberately MIRROR the disk
// layout, so migration is a pure byte copy with zero record rewrites and every
// existing path-sanitisation regex keeps working untouched.

import { AwsClient } from "aws4fetch";
import { del, put } from "@vercel/blob";

/** True when Vercel Blob is configured (legacy prod path). */
export function hasBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

// ---------------------------------------------------------------------------
// Cloudflare R2 (private bucket, S3 API)
// ---------------------------------------------------------------------------
//
// Deliberately named R2_IMAGES_* rather than the R2_* the epic sketched: the
// off-site BACKUP job (.github/workflows/backup-offsite.yml) already owns
// R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ENDPOINT / R2_BUCKET for the
// encrypted-backup bucket. Those live in GitHub Actions and these live in
// Render, so there is no technical collision — but one operator pasting a
// backup credential into an image slot (or the reverse) would either break
// backups or put served images in the backup bucket. Distinct names make that
// mistake impossible to make silently. The two buckets also have opposite
// lifecycles: backups are write-once and retained, images are read-hot.

const R2_ENV = [
  "R2_IMAGES_ENDPOINT",
  "R2_IMAGES_BUCKET",
  "R2_IMAGES_ACCESS_KEY_ID",
  "R2_IMAGES_SECRET_ACCESS_KEY",
] as const;

/** True only when every R2 setting is present — a half-configured store must
 *  not silently swallow writes, so partial config reads as "not configured". */
export function hasR2(): boolean {
  return R2_ENV.every((k) => Boolean(process.env[k]));
}

function r2Config(): { client: AwsClient; base: string } {
  if (!hasR2()) throw new Error("blob-store: R2 is not configured");
  const client = new AwsClient({
    accessKeyId: process.env.R2_IMAGES_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_IMAGES_SECRET_ACCESS_KEY!,
    service: "s3",
    region: "auto", // R2 ignores region but SigV4 requires one
  });
  const endpoint = process.env.R2_IMAGES_ENDPOINT!.replace(/\/+$/, "");
  return { client, base: `${endpoint}/${process.env.R2_IMAGES_BUCKET!}` };
}

/**
 * Object keys mirror the on-disk layout exactly ("hunts/refs/x.jpg",
 * "map/images/<sha1>.jpg", "events/<id>/<file>"). Each PATH SEGMENT is encoded
 * separately: encodeURIComponent on the whole key would turn the slashes into
 * %2F and flatten the hierarchy into one long object name.
 */
function keyUrl(base: string, key: string): string {
  return `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** Upload bytes to the private bucket. Throws on any non-2xx. */
export async function putObject(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const { client, base } = r2Config();
  const res = await client.fetch(keyUrl(base, key), {
    method: "PUT",
    body: bytes as BodyInit,
    headers: { "Content-Type": contentType, "Content-Length": String(bytes.byteLength) },
  });
  if (!res.ok) throw new Error(`R2 PUT ${key} failed: ${res.status}`);
}

/**
 * Read bytes back. Returns null when the object does not exist — a MISSING
 * image must 404 the one request, never 500 a page or take the service out of
 * rotation (health gates on Postgres only, by design).
 */
export async function getObject(
  key: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const { client, base } = r2Config();
  const res = await client.fetch(keyUrl(base, key), { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 GET ${key} failed: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return {
    bytes: buf,
    contentType: res.headers.get("content-type") || "application/octet-stream",
  };
}

/**
 * Permanently remove an object (E11 MHMDA delete fulfilment and the event
 * attachment cleanup both depend on this).
 *
 * An already-absent object counts as success — the artifact is gone either way.
 * Anything else THROWS, because callers delete the bytes FIRST and only then
 * drop the referencing row: a failed delete must leave a retryable row rather
 * than an orphaned photo with no record pointing at it.
 */
export async function deleteObject(key: string): Promise<void> {
  const { client, base } = r2Config();
  const res = await client.fetch(keyUrl(base, key), { method: "DELETE" });
  // S3 DELETE is idempotent and answers 204 even for a missing key; 404 is
  // accepted too so this does not depend on that nicety.
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${key} failed: ${res.status}`);
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
