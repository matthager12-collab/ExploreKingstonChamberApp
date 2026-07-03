// The single source of truth for where mutable state lives on disk.
//
// Every store (auth, portal overlays, hunts + photos, analytics, survey,
// maps) resolves its paths through dataPath(). In local dev this is the
// repo's .data/ directory; in production set DATA_DIR to an absolute path on
// a PERSISTENT volume (e.g. DATA_DIR=/data on a Render/Fly/Railway disk, or a
// path outside the app root on a VPS) so redeploys and container restarts do
// not wipe accounts, portal edits, and photos.
//
// Migration seam: this is also the boundary where the app moves off the
// filesystem entirely. When the app later goes serverless (Vercel), the store
// modules that call dataPath() are the exact set to reimplement against a
// database + object storage — nothing above them changes. See docs/DEPLOY.md.

import path from "path";

/** Absolute root for all runtime-written data. */
export function dataDir(): string {
  const configured = process.env.DATA_DIR?.trim();
  return configured && configured.length > 0
    ? path.resolve(configured)
    : path.join(process.cwd(), ".data");
}

/** Join path segments onto the data root, e.g. dataPath("auth", "users.json"). */
export function dataPath(...segments: string[]): string {
  return path.join(dataDir(), ...segments);
}
