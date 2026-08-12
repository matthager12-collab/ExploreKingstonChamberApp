// Directory geocoder (directory-public slice, 2026-08-12): give every
// directory listing a pin position, three ways in priority order:
//
//   1. ADOPT — a hand-placed map pin (MapFeature marker) whose normalized
//      name matches the listing donates its point. These pins were geocoded
//      by a human one at a time (src/lib/data/map-features.ts), so they beat
//      any automated lookup. Each adoption is reported as a (feature →
//      listing) pair: that list is the phase-3 retirement worklist — once
//      the `directory` map source renders the listing, the hand pin is
//      redundant.
//   2. GEOCODE — Nominatim (the OpenStreetMap geocoder), one request per
//      1.1 s (their usage policy), results accepted only INSIDE the greater
//      Kingston bounding box — a geocoder that confidently places a business
//      in Kingston, Jamaica must be refused, not written.
//   3. FLAG — everything else lands in the "unplaced" report for hand
//      placement via /admin/listings (the workbench now has lat/lng fields).
//
//   npm run geocode:directory                  # dry-run (default)
//   npm run geocode:directory -- --apply [--yes]
//                                [--report-out geocode-report.json]
//                                [--limit N]     # first N unplaced (testing)
//
// Writes preserve each record's current status (a geocode must never publish
// a draft) and use actor "script:geocode-directory" — which flips
// updated_by, deliberately ending importer refresh rights over the record
// (the coordinates must not be clobbered by the next roster import; the
// importer's local-wins precedence handles that automatically).
//
// Network note: the ONLY external call is Nominatim, and the only data sent
// is the business address already destined for a public listing. Runs under
// tsx with NODE_OPTIONS=--conditions=react-server (import-growthzone
// conventions). Exit codes: 0 clean · 1 halt · 2 completed with unplaced rows.

import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

import { normalizeName } from "../src/lib/import/qwick";
import {
  getDirectoryListingsAdmin,
  saveDirectoryListing,
} from "../src/lib/stores/directory-store";
import { getMapFeatures } from "../src/lib/stores/map-store";
import type { DirectoryListing } from "../src/lib/types";

const ACTOR = "script:geocode-directory";

/** Greater Kingston, WA — generous enough for Hansville/Indianola members,
 *  tight enough to refuse a same-named business in another state. */
const BOUNDS = { latMin: 47.65, latMax: 47.95, lngMin: -122.65, lngMax: -122.3 };

/** Nominatim usage policy: absolute max 1 req/s. */
const NOMINATIM_DELAY_MS = 1_100;
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT =
  "ExploreKingstonChamberApp/1.0 (directory geocode; contact: mat@arda.cards)";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function inBounds(lat: number, lng: number): boolean {
  return (
    lat >= BOUNDS.latMin && lat <= BOUNDS.latMax && lng >= BOUNDS.lngMin && lng <= BOUNDS.lngMax
  );
}

/** The query Nominatim sees: the listing's address, anchored to Kingston WA
 *  when the free-text address doesn't already carry a state. */
function geocodeQuery(listing: DirectoryListing): string | null {
  const addr = listing.address?.trim();
  if (!addr) return null;
  return /\bwa\b|\bwashington\b/i.test(addr) ? addr : `${addr}, Kingston, WA`;
}

async function nominatim(query: string): Promise<{ lat: number; lng: number } | null> {
  const url = `${NOMINATIM_URL}?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => [])) as { lat?: string; lon?: string }[];
  const hit = body[0];
  if (!hit?.lat || !hit?.lon) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return inBounds(lat, lng) ? { lat, lng } : null;
}

interface Placement {
  id: string;
  name: string;
  lat: number;
  lng: number;
  via: "adopted" | "geocoded";
  /** Adoptions only: the donating hand pin — the phase-3 retirement list. */
  featureId?: string;
  featureTitle?: string;
}

async function main(): Promise<number> {
  const apply = flag("--apply");
  const limit = opt("--limit") ? Number(opt("--limit")) : Infinity;

  if (!process.env.DATABASE_URL) {
    console.error("HALT: DATABASE_URL must be set.");
    return 1;
  }

  const [listings, features] = await Promise.all([
    getDirectoryListingsAdmin(),
    getMapFeatures(),
  ]);
  const unplacedListings = listings.filter(
    (l) => l.lat === undefined || l.lng === undefined,
  );
  console.log(
    `${listings.length} directory listings; ${listings.length - unplacedListings.length} already placed, ${unplacedListings.length} to do.`,
  );

  // Hand pins by normalized title. Markers only — a trail or parking area
  // must never donate its geometry to a storefront. Ambiguous names (two
  // markers, same normalized title) are skipped: adopting either would be a
  // coin flip, and coin flips don't belong in a data migration.
  const byName = new Map<string, { id: string; title: string; point: [number, number] }[]>();
  for (const f of features) {
    if (f.kind !== "marker" || !f.point) continue;
    const key = normalizeName(f.title ?? "");
    if (!key) continue;
    const bucket = byName.get(key) ?? [];
    bucket.push({ id: f.id, title: f.title, point: f.point });
    byName.set(key, bucket);
  }

  const placements: Placement[] = [];
  const unplaced: { id: string; name: string; reason: string }[] = [];
  let geocodeBudgetUsed = 0;

  for (const listing of unplacedListings.slice(0, limit)) {
    const matches = byName.get(normalizeName(listing.name)) ?? [];
    if (matches.length === 1) {
      const [m] = matches;
      const [lat, lng] = m.point;
      if (inBounds(lat, lng)) {
        placements.push({
          id: listing.id,
          name: listing.name,
          lat,
          lng,
          via: "adopted",
          featureId: m.id,
          featureTitle: m.title,
        });
        continue;
      }
    }
    if (matches.length > 1) {
      unplaced.push({ id: listing.id, name: listing.name, reason: "ambiguous hand-pin match" });
      continue;
    }

    const query = geocodeQuery(listing);
    if (!query) {
      unplaced.push({ id: listing.id, name: listing.name, reason: "no address on record" });
      continue;
    }
    if (geocodeBudgetUsed > 0) await sleep(NOMINATIM_DELAY_MS);
    geocodeBudgetUsed += 1;
    let hit: { lat: number; lng: number } | null = null;
    try {
      hit = await nominatim(query);
    } catch {
      hit = null;
    }
    if (hit) {
      placements.push({ id: listing.id, name: listing.name, ...hit, via: "geocoded" });
    } else {
      unplaced.push({
        id: listing.id,
        name: listing.name,
        reason: "no in-bounds geocoder result",
      });
    }
  }

  const adopted = placements.filter((p) => p.via === "adopted");
  const geocoded = placements.filter((p) => p.via === "geocoded");
  console.log(
    `plan: adopted=${adopted.length} geocoded=${geocoded.length} unplaced=${unplaced.length}`,
  );
  for (const p of adopted) {
    console.log(`  adopt   ${p.id}  ← hand pin «${p.featureTitle}» (${p.featureId})`);
  }
  for (const p of geocoded) console.log(`  geocode ${p.id}  (${p.lat}, ${p.lng})`);
  for (const u of unplaced) console.log(`  UNPLACED ${u.id} — ${u.reason}`);

  const reportOut = opt("--report-out");
  if (reportOut) {
    await writeFile(
      reportOut,
      JSON.stringify({ placements, unplaced, generatedBy: ACTOR }, null, 2) + "\n",
    );
    console.log(`report written to ${reportOut} (adoptions = the hand-pin retirement list).`);
  }

  if (!apply) {
    console.log("dry run — nothing written. Re-run with --apply to write coordinates.");
    return unplaced.length ? 2 : 0;
  }

  if (!flag("--yes")) {
    const host = (() => {
      try {
        return new URL(process.env.DATABASE_URL!).host;
      } catch {
        return "<unparseable DATABASE_URL>";
      }
    })();
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `About to write ${placements.length} coordinate pairs to ${host}. Type the host to confirm: `,
    );
    rl.close();
    if (answer.trim() !== host) {
      console.error("aborted — host mismatch.");
      return 1;
    }
  }

  const byId = new Map(listings.map((l) => [l.id, l]));
  for (const p of placements) {
    const current = byId.get(p.id);
    if (!current) continue;
    const { status, ...doc } = current;
    // Preserve status: placing a pin must never publish a draft.
    await saveDirectoryListing(
      { ...(doc as DirectoryListing), lat: p.lat, lng: p.lng },
      { actor: ACTOR, source: "admin", status },
    );
  }
  console.log(`applied — ${placements.length} listings placed.`);
  return unplaced.length ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("HALT:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
