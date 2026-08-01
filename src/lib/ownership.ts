// Linked-record ownership (E17 step 6, M-10-02 / FR-A11): the one place that
// knows how an invite's linked_ids map onto `record.owner_org_id`.
//
// Two moments care:
//   - MINT (src/lib/invite-mint.ts): refuse to mint an invite whose linked
//     records are already owned by an org — a second claim over the same
//     listing must fail before a code ever leaves the Chamber.
//   - REDEEM (src/lib/auth/identity.ts): re-check just before the account is
//     created (the record may have been claimed between mint and redeem), and
//     on success backfill owner_org_id onto every linked record — so a claim
//     lands ownership in the same minute, with no orphaned half-state.
//
// The org kind decides which stores linked ids point into — the SAME mapping
// mintInvite validates against: kind "business" spans the member-editable
// listing stores (restaurants ∪ lodging ∪ directory — directory drafts are
// precisely what the Qwick import leaves to be claimed), kind "nonprofit" is
// charities. owner_org_id is read via readRecordRows — the admin getters
// deliberately do not expose governance columns.

import type { OrgKind } from "@/lib/auth/roles";
import {
  readRecordRows,
  writeRecord,
  type OverlayRow,
  type WithId,
} from "@/lib/db/records";
import { getRestaurants } from "@/lib/stores/business-store";
import { getCharities } from "@/lib/stores/charity-store";
import { getDirectoryListings } from "@/lib/stores/directory-store";
import { getLodging } from "@/lib/stores/listing-stores";

/** Thrown when a linked record is already owned by an organization. Routes
 *  map it to a 409 (mint: names the owning org for the admin; redeem: a
 *  fixed "contact the Chamber" message for the visitor). Deliberately NOT an
 *  AuthError — the 400 mapping must not swallow it. */
export class OwnershipConflictError extends Error {}

/** Which stores an org kind's linked ids point into. Must stay in lockstep
 *  with mintInvite's validation universe. */
const KIND_STORES: Record<OrgKind, readonly string[]> = {
  business: ["restaurants", "lodging", "directory"],
  nonprofit: ["charities"],
};

/** Public (seed+live-overlay) getter per store — the doc source for records
 *  that exist only in the git seed. Directory has no seed, so its entry can
 *  only ever confirm absence. */
const PUBLIC_GETTERS: Record<string, () => Promise<WithId[]>> = {
  restaurants: getRestaurants,
  lodging: getLodging,
  directory: getDirectoryListings,
  charities: getCharities,
};

export interface OwnedLinkedRecord {
  id: string;
  store: string;
  ownerOrgId: string;
}

/**
 * The linked records that already carry an owner_org_id. Tombstoned rows are
 * skipped: a deleted listing is not claimable, and it is invisible to the
 * mint validation anyway. Seed-only records have no row, hence no owner.
 */
export async function findOwnedLinkedRecords(
  kind: OrgKind,
  linkedIds: string[],
): Promise<OwnedLinkedRecord[]> {
  if (linkedIds.length === 0) return [];
  const wanted = new Set(linkedIds);
  const owned: OwnedLinkedRecord[] = [];
  for (const store of KIND_STORES[kind]) {
    for (const row of await readRecordRows(store)) {
      if (!wanted.has(row.id) || row.deleted || !row.ownerOrgId) continue;
      owned.push({ id: row.id, store, ownerOrgId: row.ownerOrgId });
    }
  }
  return owned;
}

/**
 * Stamp owner_org_id = orgId onto every linked record where it is null —
 * the redeem success path. Each write goes through writeRecord, so it is
 * validated and audited like any other.
 *
 * Per record:
 *   - overlay row exists → re-write its CURRENT doc with its CURRENT status
 *     (writeRecord's upsert always overwrites status from meta — passing the
 *     row's own status back is what keeps a draft a draft and a live row
 *     live) plus ownerOrgId;
 *   - seed-only record (no row — e.g. a curated restaurant) → create the
 *     overlay row from the seed doc as status "live" (a seed IS live),
 *     source "portal", owner set;
 *   - tombstoned or already-owned rows are left alone (ownership only moves
 *     off null here; anything else is an admin operation).
 */
export async function backfillLinkedOwnership(
  kind: OrgKind,
  linkedIds: string[],
  orgId: string,
  actor: string,
): Promise<void> {
  if (linkedIds.length === 0) return;
  const wanted = new Set(linkedIds);
  const seedOnly = new Set(linkedIds);
  for (const store of KIND_STORES[kind]) {
    for (const row of await readRecordRows(store)) {
      if (!wanted.has(row.id) || !seedOnly.has(row.id)) continue;
      seedOnly.delete(row.id);
      if (row.deleted || row.ownerOrgId) continue;
      await writeRecord(store, row.doc as OverlayRow<WithId>, {
        actor,
        source: "portal",
        status: row.status,
        ownerOrgId: orgId,
      });
    }
  }
  for (const id of seedOnly) {
    for (const store of KIND_STORES[kind]) {
      const doc = (await PUBLIC_GETTERS[store]()).find((r) => r.id === id);
      if (!doc) continue;
      await writeRecord(store, doc as OverlayRow<WithId>, {
        actor,
        source: "portal",
        status: "live",
        ownerOrgId: orgId,
      });
      break;
    }
    // An id in neither rows nor seeds (deleted since mint) is skipped: there
    // is nothing to own, and refusing here would strand a real redemption.
  }
}
