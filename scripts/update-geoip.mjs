#!/usr/bin/env node
// DB-IP City Lite installer for LOCAL DEVELOPMENT (E10 §6).
//
//   node scripts/update-geoip.mjs [--data-dir .data]
//   node scripts/update-geoip.mjs --help     # exits 0
//
// PRODUCTION DOES NOT USE THIS. There the .mmdb is baked into the Docker image
// at build time (the `geoip` stage in the Dockerfile) and located via
// GEOIP_DB_PATH. This script only populates a dev machine so `next dev` can
// exercise real geo instead of "Unknown".
//
// DB-IP City Lite is CC-BY-4.0 (redistributable) and ships as a plain gzipped
// .mmdb — no license key, no account, no tarball to unpack. Downloads the
// current month (falling back to the previous month, which DB-IP keeps
// available) and atomically installs <data-dir>/geoip/dbip-city-lite.mmdb, the
// path src/lib/geoip.ts falls back to when GEOIP_DB_PATH is unset.
//
// Attribution (CC-BY): the app credits DB-IP wherever the data is shown (admin
// ops + analytics pages). Keep that credit if you surface the data elsewhere.

import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(
    `Usage: node scripts/update-geoip.mjs [--data-dir .data]

Downloads DB-IP City Lite (CC-BY-4.0) and installs <data-dir>/geoip/dbip-city-lite.mmdb
for local dev. No license key needed. Production bakes this into the image
instead (see the Dockerfile 'geoip' stage). Details: docs/runbooks/GEOIP.md.`,
  );
  process.exit(0);
}

const dataDir = arg("--data-dir", process.env.DATA_DIR || ".data");
const FILE = "dbip-city-lite.mmdb";

/** "YYYY-MM" for the current month and the previous one (DB-IP publishes on the
 *  1st; the previous month stays downloadable, so it is the natural fallback). */
function candidateMonths() {
  const now = new Date();
  const cur = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const prevDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prev = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, "0")}`;
  return [cur, prev];
}

async function main() {
  const geoDir = path.join(dataDir, "geoip");
  await mkdir(geoDir, { recursive: true });
  const finalPath = path.join(geoDir, FILE);
  const tmpPath = path.join(geoDir, `.${FILE}.download`);

  let res;
  let used;
  for (const ym of candidateMonths()) {
    const url = `https://download.db-ip.com/free/dbip-city-lite-${ym}.mmdb.gz`;
    process.stdout.write(`trying ${url}\n`);
    res = await fetch(url);
    if (res.ok && res.body) {
      used = ym;
      break;
    }
  }
  if (!res || !res.ok || !res.body) {
    throw new Error(`DB-IP download failed for ${candidateMonths().join(" and ")}`);
  }

  try {
    // Gunzip the stream straight to disk — never buffer the ~125 MB file.
    await pipeline(Readable.fromWeb(res.body), createGunzip(), createWriteStream(tmpPath));
    await rename(tmpPath, finalPath); // atomic within the same directory
    const info = await stat(finalPath);
    console.log(
      `installed ${finalPath} (${(info.size / 1e6).toFixed(1)} MB, DB-IP ${used}, ${info.mtime.toISOString()})`,
    );
  } finally {
    await rm(tmpPath, { force: true });
  }
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
