// Admin-editable parking map zones.
// Seed data ships in src/lib/data/parking.ts (georeferenced from the Port's
// schematic map, ±10–15 m); the Chamber admin drags shapes to reality at
// /admin/map and the edits overlay the seed here — local eyes beat any
// database. Overlay records win by id; { _deleted: true } hides a seed zone.

import type { MapZone } from "../data/parking";
import { parkingZones as seed } from "../data/parking";
import { readMerged, writeOverlayRecord, type WriteMeta } from "./json-store";

const STORE = "parking-zones";

const seedById = new Map(seed.map((z) => [z.id, z]));

/**
 * E31 phase-6 migration for overlay records that predate street geometry.
 *
 * readMerged is a WHOLE-RECORD merge (overlay wins by id), so a street zone an
 * admin saved before `streetPaths`/`curb` existed — or restored to an old
 * version from the audit UI — would permanently mask the seeded geometry: the
 * zone would keep rendering as the old centre circle. The editor can now draw
 * and reshape street lines, so an admin COULD retrace one by hand — but that is
 * a manual re-survey of geometry we already have, for a record that looks
 * merely stale rather than broken, and delete is a tombstone that hides the
 * zone rather than resetting it to seed. Instead of a one-off DB backfill
 * this merges the seed's street geometry into any overlay record missing it,
 * on every read: idempotent, a no-op where no overlay row exists, and
 * self-healing — the next editor save writes the merged record through (the
 * admin API whitelists both fields; tests/server/admin-parking-curb.test.ts).
 *
 * The absence of `streetPaths` is the pre-phase-6 marker. A record that HAS
 * paths but no curb is a deliberate post-phase-6 "side unknown" and is left
 * alone — clearing the side must keep persisting as absent.
 */
export function withSeedStreetGeometry(zone: MapZone): MapZone {
  if (zone.streetPaths?.length) return zone;
  const seedZone = seedById.get(zone.id);
  if (!seedZone?.streetPaths?.length) return zone;
  return {
    ...zone,
    streetPaths: seedZone.streetPaths,
    ...(zone.curb == null && seedZone.curb != null ? { curb: seedZone.curb } : {}),
  };
}

export async function getParkingZones(): Promise<MapZone[]> {
  return (await readMerged<MapZone>(STORE, seed)).map(withSeedStreetGeometry);
}

export async function getParkingZone(id: string): Promise<MapZone | undefined> {
  return (await getParkingZones()).find((z) => z.id === id);
}

export async function saveParkingZone(zone: MapZone, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(STORE, zone, meta);
}

export async function deleteParkingZone(id: string, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(STORE, { id, _deleted: true } as MapZone & { _deleted: true }, meta);
}
