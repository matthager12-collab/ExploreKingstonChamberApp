#!/usr/bin/env node
// Standalone GeoLite2 installer (E10 §6) — first-time / manual installs and the
// occasional forced update.
//
//   MAXMIND_LICENSE_KEY=... node scripts/update-geolite2.mjs [--edition GeoLite2-City] [--data-dir .data]
//   node scripts/update-geolite2.mjs --help        # exits 0, no key needed
//
// Mirrors the self-refresh logic in src/lib/geoip.ts (which can't be imported
// here — it's server-only TS behind the Next build). Downloads the edition from
// MaxMind, extracts the .mmdb, and ATOMICALLY installs it under <data-dir>/geoip/.
// Prints the installed path + date on success; exits non-zero on failure.
//
// NEVER commit the .mmdb — MaxMind's license forbids redistribution. See
// docs/runbooks/GEOIP.md for the account/license-key setup.

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(
    `Usage: MAXMIND_LICENSE_KEY=<key> node scripts/update-geolite2.mjs [--edition GeoLite2-City] [--data-dir .data]

Downloads a MaxMind GeoLite2 edition and installs <data-dir>/geoip/<edition>.mmdb.
Get a free license key at https://www.maxmind.com/ (see docs/runbooks/GEOIP.md).
GeoLite2-Country (~6 MB) is the lower-memory fallback to GeoLite2-City (~70 MB).
Never commit the .mmdb — MaxMind's license forbids redistribution.`,
  );
  process.exit(0);
}

const edition = arg("--edition", "GeoLite2-City");
const dataDir = arg("--data-dir", process.env.DATA_DIR || ".data");
const key = process.env.MAXMIND_LICENSE_KEY;

if (!key) {
  console.error("error: MAXMIND_LICENSE_KEY is not set. See docs/runbooks/GEOIP.md.");
  process.exit(1);
}

function runTar(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`tar exited with code ${code}`)),
    );
  });
}

async function findMmdb(dir, name) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const found = await findMmdb(full, name);
      if (found) return found;
    } else if (e.name === name) {
      return full;
    }
  }
  return null;
}

async function main() {
  const geoDir = path.join(dataDir, "geoip");
  await mkdir(geoDir, { recursive: true });

  const url =
    `https://download.maxmind.com/app/geoip_download` +
    `?edition_id=${encodeURIComponent(edition)}` +
    `&license_key=${encodeURIComponent(key)}&suffix=tar.gz`;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`MaxMind download failed: HTTP ${res.status}`);

  const tarPath = path.join(geoDir, `.${edition}.download.tar.gz`);
  const extractDir = path.join(geoDir, `.${edition}.extract`);
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tarPath));
    await runTar(["-xzf", tarPath, "-C", extractDir]);
    const mmdb = await findMmdb(extractDir, `${edition}.mmdb`);
    if (!mmdb) throw new Error(`no ${edition}.mmdb inside the downloaded archive`);
    const finalPath = path.join(geoDir, `${edition}.mmdb`);
    await rename(mmdb, finalPath);
    const info = await stat(finalPath);
    console.log(
      `installed ${finalPath} (${(info.size / 1e6).toFixed(1)} MB, ${info.mtime.toISOString()})`,
    );
  } finally {
    await rm(tarPath, { force: true });
    await rm(extractDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
