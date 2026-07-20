// GeoLite2 geo-IP for the analytics tracker + the ops dashboard (E10 §6).
//
// On Render there are no platform geo headers (those are Vercel-only), so every
// visitor otherwise reads as "Unknown" and the Chamber's LTAC visitor-origin
// reporting starves. This resolves a COARSE {country, region, city} from a local
// MaxMind GeoLite2 .mmdb — and NEVER the raw IP: the lookup is in-memory and only
// the coarse strings are returned; the caller (src/app/api/track/route.ts) still
// stores no IP (MHMDA posture).
//
// The .mmdb is NOT in the repo or the Docker image — MaxMind's license forbids
// redistribution and output:'standalone' wouldn't trace it anyway. It lives on
// the mounted /data disk at dataPath('geoip', '<edition>.mmdb'), installed by the
// ops-page refresh button, scripts/update-geolite2.mjs, or the self-heal below.
//
// maxmind.open() is async (openSync is disabled in v5), so the Reader loads in
// the BACKGROUND and lookupGeo() stays SYNCHRONOUS — the first lookups return
// null until the ~70 MB City DB is loaded, then geo flows. That keeps
// deriveGeo() synchronous, with no async ripple into the tracker's hot path.
//
// Self-heal: when a lookup sees the file missing or older than 30 days AND
// MAXMIND_LICENSE_KEY is set, a single-flight background refresh downloads and
// atomically installs a fresh copy while the old one keeps serving. No cron.

import "server-only";

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import maxmind, { type Reader, type CityResponse } from "maxmind";

import { dataPath } from "@/lib/data-dir";

const STALE_MS = 30 * 24 * 60 * 60 * 1000; // refresh a copy older than 30 days

/** Default City; GeoLite2-Country (~6 MB) is the documented fallback if Render
 *  memory alarms fire (docs/runbooks/GEOIP.md). */
export function geoipEdition(): string {
  return process.env.GEOIP_EDITION || "GeoLite2-City";
}
function mmdbPath(edition = geoipEdition()): string {
  return dataPath("geoip", `${edition}.mmdb`);
}

let reader: Reader<CityResponse> | null = null;
let readerMtime = 0;
let refreshing = false; // single-flight guard for the background job
let warned = false;

function logOnce(msg: string, err: unknown): void {
  if (warned) return;
  warned = true;
  console.warn(`geoip: ${msg}:`, err instanceof Error ? err.message : err);
}

async function mtimeMs(p: string): Promise<number | null> {
  try {
    return (await stat(p)).mtimeMs;
  } catch {
    return null;
  }
}

/** Load/reload the Reader from disk when a file is present and newer than what
 *  we hold. Async — never on the sync lookup path directly. */
async function loadReader(): Promise<void> {
  const p = mmdbPath();
  const m = await mtimeMs(p);
  if (m === null) return; // no file yet
  if (reader && m <= readerMtime) return; // already have this copy (or newer)
  reader = await maxmind.open<CityResponse>(p);
  readerMtime = m;
}

/** Background: self-heal a missing/stale file (only when a key is set), then
 *  ensure the reader is loaded. Single-flight so concurrent lookups trigger at
 *  most one download/load. */
async function ensureReady(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const m = await mtimeMs(mmdbPath());
    const stale = m === null || Date.now() - m > STALE_MS;
    if (stale && process.env.MAXMIND_LICENSE_KEY) {
      await installEdition(geoipEdition());
    }
    await loadReader();
  } catch (err) {
    logOnce("background refresh/load failed", err);
  } finally {
    refreshing = false;
  }
}

/**
 * Coarse geography for an IP, or null. NEVER throws, NEVER stores the IP.
 * Synchronous: uses the loaded Reader; if none is loaded yet it kicks off a
 * background load and returns null (best-effort — the next requests get geo).
 */
export function lookupGeo(
  ip: string,
): { country?: string; region?: string; city?: string } | null {
  if (!reader) {
    void ensureReady();
    return null;
  }
  if (Date.now() - readerMtime > STALE_MS) {
    void ensureReady(); // self-heal in the background; keep serving the old file
  }
  let res: CityResponse | null;
  try {
    res = reader.get(ip);
  } catch {
    return null;
  }
  if (!res) return null;
  const country = res.country?.iso_code;
  const region = res.subdivisions?.[0]?.iso_code;
  const city = res.city?.names?.en;
  if (!country && !region && !city) return null;
  return { country, region, city };
}

export interface GeoipStatus {
  present: boolean;
  mtimeIso?: string;
  edition: string;
}

/** File status for the ops dashboard. Never throws. */
export async function geoipStatus(): Promise<GeoipStatus> {
  const edition = geoipEdition();
  const m = await mtimeMs(mmdbPath(edition));
  return m === null
    ? { present: false, edition }
    : { present: true, mtimeIso: new Date(m).toISOString(), edition };
}

/**
 * Download `edition` from MaxMind and ATOMICALLY install it at
 * dataPath('geoip', '<edition>.mmdb'). Throws on any failure (no license key,
 * HTTP error, missing tar, no .mmdb inside the archive). Awaited by the refresh
 * route + update script; fired in the background by the self-heal path. The
 * standalone scripts/update-geolite2.mjs mirrors this logic for manual installs.
 */
export async function installEdition(edition = geoipEdition()): Promise<string> {
  const key = process.env.MAXMIND_LICENSE_KEY;
  if (!key) throw new Error("MAXMIND_LICENSE_KEY is not set");
  const dir = dataPath("geoip");
  await mkdir(dir, { recursive: true });

  const url =
    `https://download.maxmind.com/app/geoip_download` +
    `?edition_id=${encodeURIComponent(edition)}` +
    `&license_key=${encodeURIComponent(key)}&suffix=tar.gz`;
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`MaxMind download failed: HTTP ${res.status}`);
  }

  const tarPath = path.join(dir, `.${edition}.download.tar.gz`);
  const extractDir = path.join(dir, `.${edition}.extract`);
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  try {
    // Stream the download to disk — never buffer the whole ~40 MB archive.
    // Cast bridges the DOM ReadableStream (fetch's res.body) to Node's.
    const webStream = res.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>;
    await pipeline(Readable.fromWeb(webStream), createWriteStream(tarPath));
    await runTar(["-xzf", tarPath, "-C", extractDir]);
    const mmdb = await findMmdb(extractDir, `${edition}.mmdb`);
    if (!mmdb) throw new Error(`no ${edition}.mmdb inside the downloaded archive`);
    const finalPath = mmdbPath(edition);
    await rename(mmdb, finalPath); // atomic within /data/geoip (same filesystem)
    reader = null; // force a reload on the next lookup
    readerMtime = 0;
    warned = false;
    return finalPath;
  } finally {
    await rm(tarPath, { force: true });
    await rm(extractDir, { recursive: true, force: true });
  }
}

function runTar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`tar exited with code ${code}`)),
    );
  });
}

/** Find <name> anywhere under dir — MaxMind nests it in GeoLite2-City_YYYYMMDD/. */
async function findMmdb(dir: string, name: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
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

/** Force a refresh NOW (awaited) — the ops-page button and the update script. */
export async function refreshGeoip(): Promise<GeoipStatus> {
  await installEdition(geoipEdition());
  return geoipStatus();
}

/** Test-only reset of the module-level reader/single-flight state. */
export function __resetGeoipForTests(): void {
  reader = null;
  readerMtime = 0;
  refreshing = false;
  warned = false;
}
