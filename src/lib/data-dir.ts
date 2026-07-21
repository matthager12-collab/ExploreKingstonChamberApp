// Where filesystem state lives — LOCAL DEVELOPMENT ONLY since E15.
//
// Production no longer sets DATA_DIR and no longer mounts a disk. Everything
// durable moved off-box: structured state to Neon Postgres (E05) and uploaded
// images to the private Cloudflare R2 bucket (E15 slice 1). In the deployed
// container this resolves to an ephemeral <cwd>/.data that is discarded on
// every deploy — which is fine, because nothing that must survive is written
// there any more.
//
// This module is deliberately KEPT: `next dev` still writes to the repo's
// .data/ directory, and the store modules still resolve their paths through
// dataPath() for that path. Treat a NEW dataPath() caller that must persist in
// production as a bug — it would be writing to storage that evaporates on the
// next deploy. Durable writes belong in Postgres or R2.
//
// The migration seam this once described is now finished: the stores that used
// to be filesystem-backed read and write Postgres/R2 directly. See
// docs/DEPLOY.md and docs/OPERATIONS.md.

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
