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

/**
 * Restore the seed's payment hand-off onto an overlay record that predates it.
 *
 * Same trap as withSeedStreetGeometry above, and it shipped broken: the merge is
 * whole-record, and every Port zone already had an overlay row (the Chamber had
 * attached lot photos), so the seeded `pay` was masked and every pay card on
 * /parking silently vanished.
 *
 * THE DIFFERENCE FROM streetPaths, and why absence alone cannot be the marker:
 * an admin can legitimately remove a lot's last hand-off, and that has to keep
 * persisting as removed. So the two states are distinguished explicitly —
 * `undefined` means "this record predates the field", an empty ARRAY means "an
 * admin cleared it". The editor always sends the array (JSON.stringify drops
 * `undefined`, so an omitted key really does mean "not specified"), and the
 * admin API preserves `[]` rather than folding it back to undefined.
 */
export function withSeedPay(zone: MapZone): MapZone {
  if (zone.pay !== undefined) return zone;
  const seedZone = seedById.get(zone.id);
  if (!seedZone?.pay?.length) return zone;
  return { ...zone, pay: seedZone.pay };
}

export async function getParkingZones(): Promise<MapZone[]> {
  return (await readMerged<MapZone>(STORE, seed))
    .map(withSeedStreetGeometry)
    .map(withSeedPay);
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
