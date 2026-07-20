// E10 ops dashboard — operational heartbeat/marker store.
//
// A pure overlay store (src/lib/stores/json-store.ts → the Postgres record
// table, no git seed): every marker is written at runtime and rides the same
// seam as the content stores, so it works identically on the file and Neon
// backends and lands in the backup bundle for free — no separate DDL, no
// migration.
//
// CONVENTION for later epics: any scheduled job records a `job:<name>` marker on
// each successful run, and /admin/ops renders every marker it finds — so E16's
// AMS-sync "last synced" heartbeat is a one-liner here with no ops-page change.
// Reserved id today: `backup:last-success` (written by the backup route, E10 §4).
//
// ID SHAPE — read before adding a delete: marker ids are namespaced with a colon
// (`backup:last-success`, `job:ams-sync`). The record-id regex (store-schemas
// RECORD_ID_RE) forbids colons, but the LIVE write path only requires a non-empty
// id, so colon ids write fine. The one path that WOULD reject them is a tombstone
// (delete), which validates the id against the entity regex. Markers are
// therefore OVERWRITE-ONLY and MUST NEVER be deleted: recordMarker upserts the
// same id in place, and this module deliberately exposes no delete. Don't add one
// without first switching to slug-safe ids.
import { readMerged, writeOverlayRecord, type WriteMeta } from "./json-store";

const STORE = "ops-markers";

/** A single operational marker: a stable id, an `at` ISO stamp, plus whatever
 *  the writer attached (fileCount, kind, note, …). */
export type OpsMarker = { id: string; at: string } & Record<string, unknown>;

/**
 * Upsert a marker in place, stamping `at` with the current time. Returns the
 * written marker. Overwrite-only — see the file header on why markers are never
 * deleted. Explicit id/at win over anything in `data`.
 */
export async function recordMarker(
  id: string,
  data: Record<string, unknown> = {},
  meta?: WriteMeta,
): Promise<OpsMarker> {
  const marker: OpsMarker = { ...data, id, at: new Date().toISOString() };
  await writeOverlayRecord<OpsMarker>(STORE, marker, meta);
  return marker;
}

/** Every recorded marker (live rows only — but nothing tombstones these). */
export async function getMarkers(): Promise<OpsMarker[]> {
  return readMerged<OpsMarker>(STORE, []);
}

/** One marker by id, or undefined if it was never recorded. */
export async function getMarker(id: string): Promise<OpsMarker | undefined> {
  return (await getMarkers()).find((m) => m.id === id);
}
