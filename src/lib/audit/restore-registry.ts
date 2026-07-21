// E09 (vk/restore-registry) — the explicit allowlist of stores "restore this
// version" works for, and the audit-action gate that decides which rows are
// restorable at all.
//
// A store is registered when it has BOTH a zod schema and a save path. Since
// the 2026-07-19 strict swap, the write gate's STORE_SCHEMAS covers every
// record store (strict E07 DOMAIN_SCHEMAS for the four content domains,
// baseline structural rules elsewhere), so the registry names every
// admin-editable content store. Deliberately NOT registered (history and
// diff still work; the restore button is disabled):
//   ferry-prediction, boarding-pass-override, ferry-accuracy — system
//     singletons written by their own control flows, not content;
//   worklist — dedicated table, not a record store (E08 owns its lifecycle);
//   users / invites / orgs / auth-users / auth-invites — auth objects are a
//     role-escalation surface; structurally unregistrable (guard below).
//
// Restore always writes THROUGH writeRecord (choke point: validate → stamp
// metadata → upsert + fresh audit row) — never raw inserts. Raw
// audit-preserving inserts are reserved for whole-bundle restoreDb().

import "server-only";

import type { z } from "zod";

import {
  type OverlayRow,
  type WithId,
  type WriteMeta,
  writeRecord,
} from "@/lib/db/records";
import { schemaFor } from "@/lib/db/store-schemas";

import { isSensitiveStore } from "./read";

/** Audit actions whose `after` is a FULL document snapshot. Everything else
 *  (status-change, verify, auth and worklist lifecycle events) carries
 *  partial or allowlisted fragments that must never be replayed as a doc. */
export const RESTORABLE_ACTIONS: ReadonlySet<string> = new Set([
  "create",
  "update",
  "delete",
  "import",
  "restore",
]);

export function isRestorableAction(action: string): boolean {
  return RESTORABLE_ACTIONS.has(action);
}

export type RestoreEntry = {
  /** Human noun for dialog/error copy ("restaurant listing"). */
  label: string;
  /** The same schema the write gate enforces — a snapshot that fails here
   *  would be rejected by writeRecord anyway; checking first gives a 422
   *  with field errors instead of a late throw. */
  schema: z.ZodType;
  save: (
    doc: Record<string, unknown> & { _deleted?: boolean },
    meta: WriteMeta,
  ) => Promise<void>;
};

function entry(store: string, label: string): [string, RestoreEntry] {
  return [
    store,
    {
      label,
      schema: schemaFor(store),
      save: (doc, meta) => writeRecord(store, doc as OverlayRow<WithId>, meta),
    },
  ];
}

export const RESTORE_REGISTRY: ReadonlyMap<string, RestoreEntry> = new Map([
  entry("restaurants", "restaurant listing"),
  entry("lodging", "lodging listing"),
  entry("webcams", "webcam listing"),
  entry("itineraries", "itinerary"),
  entry("events", "event"),
  entry("charities", "charity"),
  entry("volunteer-needs", "volunteer need"),
  entry("parking-zones", "parking zone"),
  entry("map-views", "map view"),
  entry("map-features", "map feature"),
  entry("site-copy", "copy block"),
  entry("site-pages", "page visibility setting"),
  entry("ferry-info", "ferry info card"),
  entry("custom-hunts", "scavenger hunt"),
  // hunt-submissions DELISTED (E11, D-10): its audit snapshots are redacted
  // at write time (no lat/lng/photoPath — records.ts SNAPSHOT_STRIP_KEYS), so
  // a "restore" would resurrect a submission with no photo pointer and no
  // location: a broken record. You cannot simultaneously promise 12-month
  // destruction of GPS + photos and keep restorable full snapshots in the
  // never-purge audit table — the privacy floor wins.
]);

// Structural guard: an auth/user store in the registry is a role-escalation
// lever — refuse to even load. (The route also 400s sensitive stores before
// consulting the registry; this makes the mistake impossible to ship.)
for (const store of RESTORE_REGISTRY.keys()) {
  if (isSensitiveStore(store)) {
    throw new Error(
      `restore-registry: '${store}' is a sensitive store and can never be restorable`,
    );
  }
}

export function getRestoreEntry(store: string): RestoreEntry | undefined {
  return RESTORE_REGISTRY.get(store);
}

/** The volunteer-facing reason a store outside the registry can't restore. */
export const RESTORE_UNAVAILABLE_MESSAGE =
  "Restore isn't available for this content type yet";
