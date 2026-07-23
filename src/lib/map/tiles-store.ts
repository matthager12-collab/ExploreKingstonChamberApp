// Read-only accessor for the self-hosted vector basemap PMTiles (E31 Phase 2,
// ADR-0006). The tiles live in a SEPARATE, private R2 bucket (`R2_TILES_*`),
// kept apart from the private user-image bucket (`R2_IMAGES_*` in blob-store.ts)
// so a public tiles route never shares a bucket with gated user uploads — the
// same distinct-bucket discipline the backup vs image split already follows.
//
// R2 is private and has no public URL here (a Cloudflare custom domain needs a
// nameserver move the binding decisions reject, and r2.dev is not for prod), so
// the public tiles route proxies range requests through this module — mirroring
// the image-proxy pattern. PMTiles is a single file read via HTTP Range, so the
// one thing this must get right is forwarding the Range header untouched and
// passing R2's 206 (status + Content-Range + ETag) straight back.

import { AwsClient } from "aws4fetch";

const R2_TILES_ENV = [
  "R2_TILES_ENDPOINT",
  "R2_TILES_BUCKET",
  "R2_TILES_ACCESS_KEY_ID",
  "R2_TILES_SECRET_ACCESS_KEY",
] as const;

/** True only when every R2_TILES_* setting is present. A half-configured store
 *  reads as "not configured" so a missing var fails loudly, never half-serves. */
export function hasTilesR2(): boolean {
  return R2_TILES_ENV.every((k) => Boolean(process.env[k]));
}

/** A single path segment ending in .pmtiles — no slashes, no traversal, no
 *  other extensions. This is the allowlist the public route trusts before it
 *  ever builds an object URL, so the proxy can only ever reach tile archives. */
export function isValidTileKey(name: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*\.pmtiles$/.test(name);
}

function tilesConfig(): { client: AwsClient; base: string } {
  if (!hasTilesR2()) throw new Error("tiles-store: R2_TILES_* is not configured");
  const client = new AwsClient({
    accessKeyId: process.env.R2_TILES_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_TILES_SECRET_ACCESS_KEY!,
    service: "s3",
    region: "auto", // R2 ignores region but SigV4 requires one
  });
  const endpoint = process.env.R2_TILES_ENDPOINT!.replace(/\/+$/, "");
  return { client, base: `${endpoint}/${process.env.R2_TILES_BUCKET!}` };
}

export interface TileResponse {
  /** 206 for a range request, 200 for a full read. */
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

/**
 * Fetch a tile archive from the private bucket, forwarding `range` verbatim.
 * Returns null when the object does not exist (a missing tile 404s the one
 * request, never 500s). Streams the body straight through — PMTiles asks for
 * small byte ranges, so nothing large is ever buffered.
 */
export async function getTileObject(
  key: string,
  range?: string,
): Promise<TileResponse | null> {
  const { client, base } = tilesConfig();
  const res = await client.fetch(`${base}/${encodeURIComponent(key)}`, {
    method: "GET",
    headers: range ? { Range: range } : undefined,
  });
  if (res.status === 404) return null;
  if (res.status !== 200 && res.status !== 206) {
    throw new Error(`tiles-store: R2 GET ${key} -> ${res.status}`);
  }

  const headers = new Headers();
  headers.set("Content-Type", "application/octet-stream");
  headers.set("Accept-Ranges", "bytes");
  // Public, immutable-ish basemap (OSM-derived, refreshed ~quarterly). A day of
  // caching is fine; the ETag lets PMTiles detect a mid-session file change and
  // keeps range reads of one archive consistent.
  headers.set("Cache-Control", "public, max-age=86400");
  headers.set("Access-Control-Allow-Origin", "*"); // public OSM tiles; enables embeds + the PWA precache
  for (const h of ["Content-Length", "Content-Range", "ETag", "Last-Modified"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return { status: res.status, headers, body: res.body };
}
