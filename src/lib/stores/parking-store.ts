// Admin-editable parking map zones.
// Seed data ships in src/lib/data/parking.ts (georeferenced from the Port's
// schematic map, ±10–15 m); the Chamber admin drags shapes to reality at
// /admin/map and the edits overlay the seed here — local eyes beat any
// database. Overlay records win by id; { _deleted: true } hides a seed zone.

import type { MapZone } from "../data/parking";
import { parkingZones as seed } from "../data/parking";
import { readMerged, writeOverlayRecord, type WriteMeta } from "./json-store";

const STORE = "parking-zones";

export async function getParkingZones(): Promise<MapZone[]> {
  return readMerged<MapZone>(STORE, seed);
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
