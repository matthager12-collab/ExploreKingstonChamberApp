#!/usr/bin/env node
// E31 Phase 2 (ADR-0006) — build + upload the Kingston vector basemap PMTiles.
//
// Extracts the Kingston bbox from the Protomaps hosted planet build using HTTP
// range reads (it never downloads the planet; output is ~1 MB, built in seconds)
// and uploads it to the PRIVATE R2 tiles bucket that the /api/map/tiles proxy
// (src/app/api/map/tiles/[file]/route.ts) serves.
//
// Prereqs:
//   - `pmtiles` CLI on PATH          (brew install pmtiles)
//   - R2_TILES_* in the environment  (.env.local locally; Render/CI in prod)
//       set -a; . ./.env.local; set +a   # to load .env.local into this shell
//
// Usage:
//   node scripts/build-tiles.mjs                  # newest planet build -> R2
//   node scripts/build-tiles.mjs --date 20260722  # pin a source build date
//   node scripts/build-tiles.mjs --dry-run        # extract only, skip the upload
//   node scripts/build-tiles.mjs --offline        # E31 Phase 7: rebuild the
//       PWA's precached offline slice (downtown bbox, capped zoom) into
//       public/offline-tiles/ — committed to the repo, never uploaded to R2.
//       REFRESHING IT REQUIRES A `VERSION` BUMP in public/sw.js: the worker
//       serves it cache-first under a stable URL (docs/PWA.md §3.1).
//
// Cadence: quarterly (OSM data drifts slowly). See docs/OPERATIONS.md §7.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AwsClient } from "aws4fetch";

// Kingston + the churches + the full Edmonds–Kingston ferry crossing (east edge
// past the Edmonds terminal at -122.383) so the live-vessel map has base tiles
// the whole way across Puget Sound. The extra span is mostly water, so the
// archive barely grows. bbox is the only knob — widen further (Hansville / Point
// No Point / Indianola) if the tourism map ever needs it (ADR-0006 resolved Q3).
const BBOX = "-122.530,47.770,-122.370,47.830";
const KEY = "kingston.pmtiles";
const R2_ENV = ["R2_TILES_ENDPOINT", "R2_TILES_BUCKET", "R2_TILES_ACCESS_KEY_ID", "R2_TILES_SECRET_ACCESS_KEY"];

// --offline (E31 Phase 7, charter AC 9): the SMALL slice the service worker
// precaches so the PWA has an offline basemap. Downtown + the ferry dock + the
// whole SR-104 holding-line approach (west past Lindvog Rd), and NOTHING more —
// this file downloads to every visitor's phone at worker install, so its size
// is a budget, not a detail. tests/unit/sw-contract.test.ts fails the build if
// it grows past its cap. Zoom is capped at the planet build's own max (15);
// MapLibre overzooms vector tiles beyond that, same as the online archive.
const OFFLINE_BBOX = "-122.528,47.780,-122.478,47.810";
const OFFLINE_MAXZOOM = 15;
const OFFLINE_OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "offline-tiles",
  "kingston-downtown.pmtiles",
);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const offline = args.includes("--offline");
const dateArg = args.includes("--date") ? args[args.indexOf("--date") + 1] : null;
const log = (...m) => console.log("[build-tiles]", ...m);

// Protomaps retains only the last few daily builds, so a fixed date rots. Walk
// back from today to the newest reachable build unless one is pinned.
async function resolveSource() {
  if (dateArg) return `https://build.protomaps.com/${dateArg}.pmtiles`;
  const today = new Date();
  for (let i = 0; i < 10; i++) {
    const stamp = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
    const url = `https://build.protomaps.com/${stamp}.pmtiles`;
    const r = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } });
    if (r.status === 206 || r.status === 200) return (log(`source build: ${stamp}`), url);
  }
  throw new Error("no reachable Protomaps build in the last 10 days");
}

async function upload(path) {
  for (const k of R2_ENV) if (!process.env[k]) throw new Error(`missing env ${k} (source .env.local, or set in Render/CI)`);
  const client = new AwsClient({
    accessKeyId: process.env.R2_TILES_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_TILES_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
  const base = process.env.R2_TILES_ENDPOINT.replace(/\/+$/, "") + "/" + process.env.R2_TILES_BUCKET;
  const body = readFileSync(path);
  const res = await client.fetch(`${base}/${KEY}`, {
    method: "PUT",
    body,
    headers: { "Content-Type": "application/octet-stream", "Content-Length": String(body.length) },
  });
  if (!res.ok) throw new Error(`R2 PUT ${KEY} -> ${res.status}: ${await res.text()}`);
  log(`uploaded ${KEY} (${body.length} bytes) to bucket ${process.env.R2_TILES_BUCKET}`);
}

const src = await resolveSource();

if (offline) {
  // Same source, same extract tool, different knobs + destination: the slice
  // is a repo-committed static file, not an R2 object, so `git diff --stat`
  // shows the size change on review and the deploy that ships it is the same
  // deploy that bumps the worker.
  log(`extracting OFFLINE slice bbox ${OFFLINE_BBOX} maxzoom ${OFFLINE_MAXZOOM}`);
  mkdirSync(dirname(OFFLINE_OUT), { recursive: true });
  rmSync(OFFLINE_OUT, { force: true }); // pmtiles extract refuses to overwrite
  execFileSync(
    "pmtiles",
    ["extract", src, OFFLINE_OUT, `--bbox=${OFFLINE_BBOX}`, `--maxzoom=${OFFLINE_MAXZOOM}`],
    { stdio: "inherit" },
  );
  log(`built ${OFFLINE_OUT} (${statSync(OFFLINE_OUT).size} bytes)`);
  log("commit the file AND bump VERSION in public/sw.js in the same PR (docs/PWA.md §3.1).");
  process.exit(0);
}

const out = join(mkdtempSync(join(tmpdir(), "vk-tiles-")), KEY);
log(`extracting bbox ${BBOX}`);
execFileSync("pmtiles", ["extract", src, out, `--bbox=${BBOX}`], { stdio: "inherit" });
log(`built ${out} (${statSync(out).size} bytes)`);
if (dryRun) { log("dry-run: skipping upload"); process.exit(0); }
await upload(out);
log("done — verify with:  curl -I -H 'Range: bytes=0-0' https://<host>/api/map/tiles/kingston.pmtiles  (expect 206)");
