// Linked-record ownership (E17 step 6, M-10-02 / FR-A11): the one place that
// knows how an invite's linked_ids map onto `record.owner_org_id`.
//
// A claim has TWO halves and they are one truth:
//   - the GRANT — the id sitting in `orgs.linked_ids`, which is what
//     getSessionUser() turns into `editableIds` and therefore what
//     can(user, "edit-record", id) actually decides from;
//   - the OWNERSHIP STAMP — `record.owner_org_id`, which is what the claims
//     console displays and what the mint refusal keys on.
// Neither half alone is a claim. A grant without a stamp reads "Unclaimed" and
// lets the Chamber mint a SECOND invite over a listing someone already edits;
// a stamp without a grant shows "Claimed" while the owner gets a 403. So every
// question here ("is this claimed?", "release it") is asked of the UNION, and
// every mutation moves both halves.
//
// Four moments care:
//   - MINT (src/lib/invite-mint.ts): refuse to mint an invite whose linked
//     records are already claimed — a second claim over the same listing must
//     fail before a code ever leaves the Chamber.
//   - REDEEM (src/lib/auth/identity.ts): re-check just before the account is
//     created (the record may have been claimed between mint and redeem), and
//     on success backfill owner_org_id onto every linked record — so a claim
//     lands ownership in the same minute, with no orphaned half-state.
//   - RELEASE (src/app/api/admin/claims/release/route.ts): the way back out.
//     A mis-minted claim used to brick a listing permanently; this module's
//     releaseRecordOwnership clears the stamp and the route strips the grant.
//   - CONSOLE (src/lib/claims/console-data.ts): shows both halves, and says so
//     when they disagree.
//
// The org kind decides which stores linked ids point into — the SAME mapping
// mintInvite validates against: kind "business" spans the member-editable
// listing stores (restaurants ∪ lodging ∪ directory — directory drafts are
// precisely what the Qwick import leaves to be claimed), kind "nonprofit" is
// charities. owner_org_id is read via readRecordRows — the admin getters
// deliberately do not expose governance columns.
//
// Org rows are passed IN, never read here: src/lib/auth/identity.ts imports
// this module, so importing identity back would be a dependency cycle
// (dependency-cruiser `no-circular`, severity error).

import type { OrgKind } from "@/lib/auth/roles";
import {
  readRecordRows,
  writeRecord,
  type OverlayRow,
  type WithId,
  type WriteMeta,
} from "@/lib/db/records";
import { getRestaurants } from "@/lib/stores/business-store";
import { getCharities } from "@/lib/stores/charity-store";
import { getDirectoryListings } from "@/lib/stores/directory-store";
import { getLodging } from "@/lib/stores/listing-stores";

/** Thrown when a linked record is already claimed by an organization. Routes
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

/** Composite key. Ownership is per (store, id) — the bare id is NOT unique
 *  across a kind's stores, and keying bookkeeping by it stamped only the
 *  first store a duplicated id appeared in. */
function key(store: string, id: string): string {
  return `${store}/${id}`;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** writeRecord's upsert only leaves owner_org_id alone when the field is
 *  ABSENT; an explicit null IS "provided", and is what clears the column.
 *  WriteMeta types it `string | undefined`, so clearing needs this one cast —
 *  widening WriteMeta to `string | null` belongs to src/lib/db/records.ts,
 *  which this change does not own. The release test asserts the column
 *  really goes null, so the cast cannot rot silently. */
const CLEAR_OWNER = null as unknown as WriteMeta["ownerOrgId"];

export interface OwnedLinkedRecord {
  id: string;
  store: string;
  ownerOrgId: string;
}

/**
 * The linked records that already carry an owner_org_id. Tombstoned rows are
 * skipped: a deleted listing is not claimable, and it is invisible to the
 * mint validation anyway. Seed-only records have no row, hence no owner.
 *
 * This is the STAMP half only. Callers deciding "is this claimed?" want
 * findClaimedLinkedRecords(), which adds the grant half.
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

/** An org reduced to the two things ownership cares about. Structurally
 *  satisfied by OrgRow, so callers pass `await listOrganizations()`. */
export interface OrgGrantSource {
  id: string;
  name: string;
  linkedIds: readonly string[];
}

/** An org that holds the GRANT half over a record id. */
export interface ClaimGrantOrg {
  id: string;
  name: string;
}

/** One already-claimed linked id, with both halves of the claim spelled out.
 *  `store` is the store the stamp lives on — null when only a grant fired
 *  (org linked_ids are bare ids and name no store). */
export interface ClaimedLinkedRecord {
  id: string;
  store: string | null;
  ownerOrgId: string | null;
  ownerOrgName: string | null;
  grantOrgs: ClaimGrantOrg[];
}

/**
 * "Which of these linked ids are ALREADY claimed?" — asked of the union of
 * both halves, so a backfill that failed after the grant landed can no longer
 * present a listing as free to claim.
 *
 * `ignoreOrgId` excludes one organization from both halves: an invite that
 * JOINS an existing org is not in conflict with that org's own claim — that
 * is exactly the "invite this person into that organization instead" remedy,
 * and refusing it would make the refusal message a second lie.
 */
export async function findClaimedLinkedRecords(
  kind: OrgKind,
  linkedIds: string[],
  orgs: readonly OrgGrantSource[],
  opts?: { ignoreOrgId?: string | null },
): Promise<ClaimedLinkedRecord[]> {
  if (linkedIds.length === 0) return [];
  const ignore = opts?.ignoreOrgId ?? null;
  const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));
  const byId = new Map<string, ClaimedLinkedRecord>();

  for (const owned of await findOwnedLinkedRecords(kind, linkedIds)) {
    if (ignore !== null && owned.ownerOrgId === ignore) continue;
    byId.set(owned.id, {
      id: owned.id,
      store: owned.store,
      ownerOrgId: owned.ownerOrgId,
      ownerOrgName: orgNameById.get(owned.ownerOrgId) ?? null,
      grantOrgs: [],
    });
  }

  const wanted = new Set(linkedIds);
  for (const org of orgs) {
    if (ignore !== null && org.id === ignore) continue;
    for (const linked of org.linkedIds) {
      if (!wanted.has(linked)) continue;
      const entry = byId.get(linked) ?? {
        id: linked,
        store: null,
        ownerOrgId: null,
        ownerOrgName: null,
        grantOrgs: [],
      };
      if (!entry.grantOrgs.some((g) => g.id === org.id)) {
        entry.grantOrgs.push({ id: org.id, name: org.name });
      }
      byId.set(linked, entry);
    }
  }

  return [...byId.values()];
}

/** Why a linked id was not stamped. None of these are failures — they are the
 *  reasons an id legitimately has nothing to own. */
export type BackfillSkipReason = "tombstoned" | "already-owned" | "no-such-record";

export interface OwnershipBackfillResult {
  orgId: string;
  requested: string[];
  stamped: { store: string; id: string; via: "overlay" | "seed" }[];
  skipped: {
    store: string | null;
    id: string;
    reason: BackfillSkipReason;
    ownerOrgId?: string;
  }[];
  failed: { store: string; id: string; error: string }[];
  /** false when ANY write threw. The caller logs the detail; it must not
   *  throw after the redemption transaction has already committed. */
  ok: boolean;
  /** false when any requested id did NOT end up owned by this org — a write
   *  failed, the record vanished, or another org already holds it. The one
   *  boolean worth alerting on; a record this org already owned is a no-op,
   *  not an incident. */
  complete: boolean;
}

/**
 * Stamp owner_org_id = orgId onto every linked record where it is null —
 * the redeem success path. Each write goes through writeRecord, so it is
 * validated and audited like any other.
 *
 * Bookkeeping is per (store, id), NOT per bare id: the same id may exist in
 * two of a kind's stores, and the earlier bare-id key stamped only whichever
 * store happened to be read first.
 *
 *   - overlay row exists → re-write its CURRENT doc with its CURRENT status
 *     (writeRecord's upsert always overwrites status from meta — passing the
 *     row's own status back is what keeps a draft a draft and a live row
 *     live) plus ownerOrgId;
 *   - seed-only record (no row — e.g. a curated restaurant) → create the
 *     overlay row from the seed doc as status "live" (a seed IS live),
 *     source "portal", owner set;
 *   - tombstoned or already-owned rows are left alone (ownership only moves
 *     off null here; anything else is an admin operation).
 *
 * Returns a STRUCTURED result instead of void, and never lets one bad record
 * abort the rest: this runs after the redemption committed, so the caller can
 * only log — and "backfill failed" with no detail is the log line that let a
 * half-applied claim go unnoticed until two orgs were editing one listing.
 */
export async function backfillLinkedOwnership(
  kind: OrgKind,
  linkedIds: string[],
  orgId: string,
  actor: string,
): Promise<OwnershipBackfillResult> {
  const result: OwnershipBackfillResult = {
    orgId,
    requested: [...linkedIds],
    stamped: [],
    skipped: [],
    failed: [],
    ok: true,
    complete: true,
  };
  if (linkedIds.length === 0) return result;

  const wanted = new Set(linkedIds);
  /** (store, id) pairs that had an overlay row — the seed pass skips these. */
  const withRow = new Set<string>();
  /** ids found somewhere, so "matched nothing at all" can be reported. */
  const matched = new Set<string>();

  for (const store of KIND_STORES[kind]) {
    for (const row of await readRecordRows(store)) {
      if (!wanted.has(row.id)) continue;
      withRow.add(key(store, row.id));
      matched.add(row.id);
      if (row.deleted) {
        result.skipped.push({ store, id: row.id, reason: "tombstoned" });
        continue;
      }
      if (row.ownerOrgId) {
        result.skipped.push({
          store,
          id: row.id,
          reason: "already-owned",
          ownerOrgId: row.ownerOrgId,
        });
        continue;
      }
      try {
        await writeRecord(store, row.doc as OverlayRow<WithId>, {
          actor,
          source: "portal",
          status: row.status,
          ownerOrgId: orgId,
        });
        result.stamped.push({ store, id: row.id, via: "overlay" });
      } catch (err) {
        result.ok = false;
        result.failed.push({ store, id: row.id, error: errText(err) });
      }
    }
  }

  for (const store of KIND_STORES[kind]) {
    const pending = linkedIds.filter((id) => !withRow.has(key(store, id)));
    if (pending.length === 0) continue;
    let docs: WithId[];
    try {
      docs = await PUBLIC_GETTERS[store]();
    } catch (err) {
      result.ok = false;
      for (const id of pending) result.failed.push({ store, id, error: errText(err) });
      continue;
    }
    for (const id of pending) {
      const doc = docs.find((r) => r.id === id);
      if (!doc) continue;
      matched.add(id);
      try {
        await writeRecord(store, doc as OverlayRow<WithId>, {
          actor,
          source: "portal",
          status: "live",
          ownerOrgId: orgId,
        });
        result.stamped.push({ store, id, via: "seed" });
      } catch (err) {
        result.ok = false;
        result.failed.push({ store, id, error: errText(err) });
      }
    }
  }

  // An id in neither rows nor seeds (deleted since mint) is REPORTED, not
  // thrown: there is nothing to own, and refusing here would strand a real
  // redemption whose account already exists.
  for (const id of linkedIds) {
    if (!matched.has(id)) {
      result.skipped.push({ store: null, id, reason: "no-such-record" });
    }
  }

  result.complete =
    result.ok &&
    result.skipped.every((s) => s.reason === "already-owned" && s.ownerOrgId === orgId);
  return result;
}

export interface OwnershipReleaseResult {
  released: boolean;
  previousOwnerOrgId: string | null;
  /** Present when nothing was released. */
  reason?: "no-record" | "tombstoned" | "not-owned";
}

/**
 * Clear owner_org_id on ONE named record — the stamp half of a release.
 *
 * The caller (POST /api/admin/claims/release) strips the matching grant from
 * the org's linked_ids in the same request; clearing only the stamp would
 * leave the org still able to edit the listing while the console called it
 * unclaimed, which is the exact inconsistency this file exists to prevent.
 *
 * The row's CURRENT status is passed back (writeRecord's upsert overwrites
 * status from meta), so releasing a claimed draft does not publish it. Source
 * is "admin" and the actor is the acting admin — a human write, which by the
 * E17 precedence law also takes the record out of the Qwick importer's
 * ownership. That is intended: a released listing is Chamber-curated until
 * someone claims it again.
 *
 * Seed-only records return released:false — a record with no overlay row has
 * no owner_org_id to clear.
 */
export async function releaseRecordOwnership(
  store: string,
  id: string,
  actor: string,
): Promise<OwnershipReleaseResult> {
  const row = (await readRecordRows(store)).find((r) => r.id === id);
  if (!row) return { released: false, previousOwnerOrgId: null, reason: "no-record" };
  if (row.deleted) {
    return {
      released: false,
      previousOwnerOrgId: row.ownerOrgId ?? null,
      reason: "tombstoned",
    };
  }
  if (!row.ownerOrgId) {
    return { released: false, previousOwnerOrgId: null, reason: "not-owned" };
  }

  await writeRecord(store, row.doc as OverlayRow<WithId>, {
    actor,
    source: "admin",
    status: row.status,
    ownerOrgId: CLEAR_OWNER,
  });
  return { released: true, previousOwnerOrgId: row.ownerOrgId };
}
