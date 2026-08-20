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
  detachOverlayRecord as detachRecord,
  readMergedRecords,
  readMergedRecordsAdmin,
  readRecords,
  writeRecord,
  type DetachResult,
  type OverlayRow,
  type RecordStatus,
  type WriteMeta,
} from "../db/records";
import { isSeedNoop, sameDoc } from "./seed-overlay";

export type { RecordStatus, WriteMeta, WithStatus } from "../db/records";
export type { DetachResult } from "../db/records";
export { isSeedNoop, sameDoc } from "./seed-overlay";

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


/* ------------------------- seed re-attachment (E36) ------------------------- */

/** Drop a record's overlay row so it reads from the shipped seed again.
 *  Guarded — see detachOverlayRecord in db/records.ts for what it refuses. */
export async function detachOverlayRecord(
  name: string,
  id: string,
  meta?: WriteMeta,
): Promise<DetachResult> {
  return detachRecord(name, id, meta);
}

/**
 * Seed-aware save: the write path for any store that HAS a seed.
 *
 * Identical to writeOverlayRecord except that a save which would say nothing
 * the shipped seed doesn't already say re-attaches the record to the seed
 * instead of shadowing it. Without this, opening a record in an admin editor
 * and pressing Save with no edits silently detaches it from the codebase
 * forever — the 2026-08-19 itinerary incident.
 *
 * The no-op path only ever applies to a plain live save. A non-live write is
 * the E08 moderation flow (submissions, and takedowns, which are literally
 * "the seed doc at a non-live status"); those always write a real row. If the
 * existing row carries ownership or AMS metadata the detach refuses and we
 * fall through to a normal write, so nothing is ever silently discarded.
 */
export async function writeOverlayRecordSeedAware<T extends WithId>(
  name: string,
  seed: readonly T[],
  record: T & { _deleted?: boolean },
  meta?: WriteMeta,
): Promise<void> {
  const status = meta?.status ?? "live";
  if (status === "live" && isSeedNoop(seed, record)) {
    // "absent" means there was no row to begin with — the record is already
    // reading from the seed, so writing one now would create the exact
    // problem this function exists to prevent.
    if ((await detachRecord(name, record.id, meta)) !== "refused") return;
  }
  await writeOverlayRecord(name, record, meta);
}

/** Whether a record currently shadows a shipped seed record, and whether its
 *  content actually differs from it. `differsFromSeed: false` is the smoking
 *  gun of a no-op save — the overlay is pure dead weight and reverting it is
 *  guaranteed lossless. Keyed by record id; ids with no overlay row (or a
 *  tombstoned one — those are already hidden from admin lists) are absent. */
export type SeedOverrideFlags = { overridesSeed: true; differsFromSeed: boolean };

export async function readSeedOverrides<T extends WithId>(
  name: string,
  seed: readonly T[],
): Promise<Record<string, SeedOverrideFlags>> {
  if (!seed.length) return {};
  const seedById = new Map(seed.map((s) => [s.id, s]));
  const out: Record<string, SeedOverrideFlags> = {};
  for (const row of await readOverlay<T>(name)) {
    const twin = seedById.get(row.id);
    if (!twin || row._deleted) continue;
    const { _deleted: _ignored, ...doc } = row as { _deleted?: boolean } & Record<
      string,
      unknown
    >;
    out[row.id] = { overridesSeed: true, differsFromSeed: !sameDoc(doc, twin) };
  }
  return out;
}
