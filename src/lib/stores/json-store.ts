// Tiny document store used by the portal-editable data layers — since E05 a
// thin delegate over the Postgres data layer (src/lib/db/records.ts).
//
// The contract every store module rides is unchanged:
//  - readOverlay(name)            → every overlay row, tombstones re-attached
//                                   as { _deleted: true } (any status);
//  - writeOverlayRecord(name, r)  → upsert one record ({ _deleted: true } is a
//                                   tombstone), now zod-validated + audited via
//                                   the writeRecord choke point;
//  - readMerged(name, seed)       → seed+overlay merge: overlay wins by id,
//                                   tombstones hide, `_deleted` stripped — and
//                                   (new in E05) only `live` overlay rows
//                                   participate.
// The optional trailing `meta` on writes carries actor/source for the audit
// trail; existing call sites compile unchanged.

import {
  readMergedRecords,
  readMergedRecordsAdmin,
  readRecords,
  writeRecord,
  type OverlayRow,
  type RecordStatus,
  type WriteMeta,
} from "../db/records";

export type { RecordStatus, WriteMeta, WithStatus } from "../db/records";

export type WithId = { id: string };
export type Overlay<T extends WithId> = (T & { _deleted?: boolean })[];

export async function readOverlay<T extends WithId>(name: string): Promise<Overlay<T>> {
  return readRecords<T>(name);
}

export async function writeOverlayRecord<T extends WithId>(
  name: string,
  record: T & { _deleted?: boolean },
  meta?: WriteMeta,
): Promise<void> {
  return writeRecord(name, record as OverlayRow<T>, meta);
}

/** Seed + overlay merge: overlay wins by id; _deleted hides a record. */
export async function readMerged<T extends WithId>(name: string, seed: T[]): Promise<T[]> {
  return readMergedRecords(name, seed);
}

/** PRIVILEGED merge (E08): every status participates (or the ones named in
 *  opts.statuses) and records carry their status. For admin pages and
 *  owner-scoped portal reads only — public surfaces use readMerged. */
export async function readMergedAdmin<T extends WithId>(
  name: string,
  seed: T[],
  opts?: { statuses?: RecordStatus[] },
) {
  return readMergedRecordsAdmin(name, seed, opts);
}
