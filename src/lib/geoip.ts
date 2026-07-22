// Coarse geo-IP for the analytics tracker + the ops dashboard (E10 §6).
//
// On Render there are no platform geo headers (those are Vercel-only), so every
// visitor otherwise reads as "Unknown" and the Chamber's LTAC visitor-origin
// reporting starves. This resolves a COARSE {country, region, city} from a local
// IP database — and NEVER the raw IP: the lookup is in-memory and only the
// coarse strings are returned; the caller (src/app/api/track/route.ts) still
// stores no IP (MHMDA posture).
//
// SOURCE: DB-IP City Lite (https://db-ip.com), CC-BY-4.0. It replaced MaxMind
// GeoLite2 on 2026-07-22. The reason is the license: DB-IP Lite is
// REDISTRIBUTABLE, so the .mmdb is downloaded AT DOCKER BUILD TIME and baked
// into the image (see the `geoip` stage in the Dockerfile) instead of being
// fetched at runtime with a per-account license key. What that buys us:
//   - no MAXMIND_LICENSE_KEY, no MaxMind account, no annual EULA re-accept chore;
//   - the DB is on disk the instant the container boots — no post-deploy
//     "Unknown" window while a 125 MB file downloads (the old design re-fetched
//     it on every deploy once the disk was removed in E15);
//   - "refreshing" the data just means redeploying (each build grabs the
//     current month). No cron, no self-heal, no runtime network dependency.
//   - ATTRIBUTION IS REQUIRED wherever the data is shown (CC-BY) — rendered on
//     the admin ops + analytics pages. Do not remove it.
//
// DB-IP ships in the MaxMind DB format, so the `maxmind` reader still reads it.
// maxmind.open() is async, so the Reader loads in the BACKGROUND on first use
// and lookupGeo() stays SYNCHRONOUS — the first lookups return null until the
// file is loaded, then geo flows, with no async ripple into the tracker's hot
// path.
//
// FIELD NOTE — why deriveCoarseGeo() exists and is a pure exported function:
// DB-IP and GeoLite2 disagree on ONE field that happens to be THE LTAC signal.
// For a US visitor, GeoLite2 fills subdivisions[0].iso_code ("WA"); DB-IP leaves
// iso_code EMPTY and fills subdivisions[0].names.en ("Washington") instead. The
// pre-swap code read iso_code only, so a naïve source swap would have silently
// dropped every state. deriveCoarseGeo() falls back name<-iso, so it is correct
// for either database — and being pure + exported, that exact gap is unit-tested
// (tests/unit/geoip.test.ts) without shipping a 125 MB fixture.

import "server-only";

import { stat } from "node:fs/promises";

import maxmind, { type Reader, type CityResponse } from "maxmind";

import { dataPath } from "@/lib/data-dir";

/** Basename of the baked-in database (see the Dockerfile `geoip` stage). */
export const GEOIP_DB_FILE = "dbip-city-lite.mmdb";

/**
 * Absolute path to the .mmdb. In the deployed image the Dockerfile bakes the
 * file in and sets GEOIP_DB_PATH; local dev falls back to <dataDir>/geoip,
 * populated on demand by `node scripts/update-geoip.mjs`. Absence is not an
 * error anywhere — lookups just return null and geography shows "Unknown".
 */
export function geoipDbPath(): string {
  return process.env.GEOIP_DB_PATH?.trim() || dataPath("geoip", GEOIP_DB_FILE);
}

let reader: Reader<CityResponse> | null = null;
let loading = false; // single-flight guard for the background open()
let warned = false;

/** Open the reader once, in the background. Never throws: a missing or corrupt
 *  file leaves `reader` null and lookups degrade to "Unknown". */
async function ensureReader(): Promise<void> {
  if (reader || loading) return;
  loading = true;
  try {
    reader = await maxmind.open<CityResponse>(geoipDbPath());
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn(
        "geoip: database not loaded (visitor geography will show Unknown):",
        err instanceof Error ? err.message : err,
      );
    }
  } finally {
    loading = false;
  }
}

/**
 * Map a raw reader response to the coarse fields we keep. PURE and exported so
 * the field-compatibility logic — the DB-IP vs GeoLite2 subdivision gap
 * described in the header — is unit-tested without a real database. Returns
 * null when nothing usable resolved.
 */
export function deriveCoarseGeo(
  res: CityResponse | null,
): { country?: string; region?: string; city?: string } | null {
  if (!res) return null;
  const sub = res.subdivisions?.[0];
  const country = res.country?.iso_code;
  // iso_code first (GeoLite2), else the full subdivision name (DB-IP). Both are
  // valid LTAC region labels; downstream aggregates by exact string, not code.
  const region = sub?.iso_code ?? sub?.names?.en;
  // DB-IP appends a neighborhood, e.g. "Seattle (Northeast Seattle)". Strip the
  // trailing parenthetical so occurrences aggregate to the city, not to each
  // neighborhood (GeoLite2 city names have no parenthetical, so this is inert
  // there).
  const city = res.city?.names?.en?.replace(/\s*\([^)]*\)\s*$/, "").trim() || undefined;
  if (!country && !region && !city) return null;
  return { country, region, city };
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
    void ensureReader();
    return null;
  }
  let res: CityResponse | null;
  try {
    res = reader.get(ip);
  } catch {
    return null;
  }
  return deriveCoarseGeo(res);
}

export interface GeoipStatus {
  present: boolean;
  mtimeIso?: string;
  file: string;
}

/** File status for the ops dashboard. Never throws. The mtime is the baked
 *  file's timestamp — i.e. roughly when the image was last built, which is the
 *  freshness signal that matters (redeploy to refresh). */
export async function geoipStatus(): Promise<GeoipStatus> {
  try {
    const { mtimeMs } = await stat(geoipDbPath());
    return { present: true, mtimeIso: new Date(mtimeMs).toISOString(), file: GEOIP_DB_FILE };
  } catch {
    return { present: false, file: GEOIP_DB_FILE };
  }
}

/** Test-only reset of the module-level reader/single-flight state. */
export function __resetGeoipForTests(): void {
  reader = null;
  loading = false;
  warned = false;
}
