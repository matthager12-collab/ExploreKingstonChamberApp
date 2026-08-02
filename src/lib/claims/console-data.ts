// Claims-console data assembly (E17 charter step 6).
//
// One question, answered across all four claimable domains: which listings
// exist, and which of them does an organization already claim?
//
// A claim has TWO halves (src/lib/ownership.ts is the long version):
//   - the STAMP, record.owner_org_id, set when a bound invite is redeemed;
//   - the GRANT, the id sitting in orgs.linked_ids, which is what actually
//     decides can(user, "edit-record", id).
// The console reads the UNION. Reading only the stamp meant a redemption
// whose backfill failed rendered a confident "Unclaimed" over a listing its
// owner could already edit — and the mint refusal, keyed the same way, would
// then happily hand a second code to an unrelated business. When the two
// halves disagree the row says so (`mismatch`) instead of picking one.
//
// Read shape (mirrors readMergedRecordsAdmin, but keeping the governance
// columns the merge helpers deliberately drop):
//   - git seeds participate as 'live' rows with source "seed" — a seed with
//     no overlay row has never been written, so it cannot carry a stamp
//     (it can still carry a grant);
//   - overlay rows of EVERY status participate (directory drafts are that
//     store's normal state; a pending or hidden listing is still claimable);
//   - tombstoned rows hide their seed, exactly like the admin merge.
//
// This is a privileged read for the admin-gated console ONLY — nothing here
// is status-gated, so no public surface may import it (`server-only` plus
// the /admin layout + page role checks enforce that).

import "server-only";

import { listOrganizations } from "@/lib/auth/identity";
import { charities as charitySeed } from "@/lib/data/charities";
import { lodging as lodgingSeed } from "@/lib/data/lodging";
import { restaurants as restaurantSeed } from "@/lib/data/restaurants";
import { readRecordRows } from "@/lib/db/records";
import type { RecordSource, RecordStatus } from "@/lib/db/schema";
import type { ClaimGrantOrg } from "@/lib/ownership";
import { CLAIM_STORES, type ClaimStore } from "./roles";

export {
  CLAIM_STORES,
  CLAIM_INVITE_ROLE_BY_STORE,
  CLAIM_STORE_LABELS,
  type ClaimStore,
} from "./roles";

export type { ClaimGrantOrg } from "@/lib/ownership";

/**
 * The two halves of a claim disagreeing. Never rendered as a plain
 * "Claimed"/"Unclaimed" — each of these is a listing an admin has to look at:
 *
 *  - grant-without-owner: an org can edit it, but nothing is stamped. The
 *    usual cause is a redemption whose ownership backfill failed.
 *  - owner-without-grant: stamped, but the owning org has no edit grant, so
 *    the business gets a 403 on its own listing.
 *  - conflicting-orgs: more than one org involved, or the grant and the stamp
 *    name different orgs. Two businesses can edit one listing.
 */
export type ClaimMismatch =
  | "grant-without-owner"
  | "owner-without-grant"
  | "conflicting-orgs";

/** One console row. Plain JSON-serializable values only — the server page
 *  hands these straight to the client manager as props. */
export interface ClaimsConsoleRow {
  store: ClaimStore;
  id: string;
  name: string;
  status: RecordStatus;
  /** Row provenance; seed-only records (no overlay row) read as "seed". */
  source: RecordSource;
  /** The UNION: stamped OR granted. */
  claimed: boolean;
  ownerOrgId: string | null;
  /** Resolved org name; falls back to the raw id if the org row is gone. */
  ownerOrgName: string | null;
  /** Orgs whose linked_ids grant edit rights over this id. */
  grantOrgs: ClaimGrantOrg[];
  /** Set when the two halves disagree; null when they agree (either both
   *  absent, or one org holding both). */
  mismatch: ClaimMismatch | null;
}

/** The seed universe per store. Directory is seedless by design (E17) —
 *  every record lives in the overlay. */
const SEEDS: Record<ClaimStore, { id: string; name: string }[]> = {
  restaurants: restaurantSeed,
  lodging: lodgingSeed,
  charities: charitySeed,
  directory: [],
};

/** Resolved once per assembly and threaded through, so a console render
 *  makes ONE orgs read rather than one per store. */
interface ClaimContext {
  orgNameById: Map<string, string>;
  /** bare record id → orgs granting edit rights over it. Org linked_ids name
   *  no store, so a duplicated id shows the grant in both stores. */
  grantsById: Map<string, ClaimGrantOrg[]>;
}

async function loadClaimContext(): Promise<ClaimContext> {
  const orgs = await listOrganizations();
  const grantsById = new Map<string, ClaimGrantOrg[]>();
  for (const org of orgs) {
    for (const id of org.linkedIds) {
      const list = grantsById.get(id) ?? [];
      if (!list.some((g) => g.id === org.id)) list.push({ id: org.id, name: org.name });
      grantsById.set(id, list);
    }
  }
  return { orgNameById: new Map(orgs.map((o) => [o.id, o.name])), grantsById };
}

type ClaimStateFields = Pick<
  ClaimsConsoleRow,
  "claimed" | "ownerOrgId" | "ownerOrgName" | "grantOrgs" | "mismatch"
>;

function claimState(
  id: string,
  ownerOrgId: string | null,
  ctx: ClaimContext,
): ClaimStateFields {
  const grantOrgs = ctx.grantsById.get(id) ?? [];
  let mismatch: ClaimMismatch | null = null;
  if (grantOrgs.length > 1) mismatch = "conflicting-orgs";
  else if (ownerOrgId === null && grantOrgs.length === 1) mismatch = "grant-without-owner";
  else if (ownerOrgId !== null && grantOrgs.length === 0) mismatch = "owner-without-grant";
  else if (ownerOrgId !== null && grantOrgs[0]?.id !== ownerOrgId) mismatch = "conflicting-orgs";
  return {
    claimed: ownerOrgId !== null || grantOrgs.length > 0,
    ownerOrgId,
    ownerOrgName:
      ownerOrgId === null ? null : (ctx.orgNameById.get(ownerOrgId) ?? ownerOrgId),
    grantOrgs,
    mismatch,
  };
}

async function assembleStore(
  store: ClaimStore,
  ctx: ClaimContext,
): Promise<ClaimsConsoleRow[]> {
  const byId = new Map<string, ClaimsConsoleRow>();
  for (const seed of SEEDS[store]) {
    byId.set(seed.id, {
      store,
      id: seed.id,
      name: seed.name,
      status: "live",
      source: "seed",
      // A seed has no overlay row, so it can carry no stamp — but an org's
      // linked_ids can still grant edit rights over it.
      ...claimState(seed.id, null, ctx),
    });
  }
  for (const row of await readRecordRows(store)) {
    if (row.deleted) {
      // Tombstone: hides the record (and its seed) exactly like the
      // admin merge — a deleted listing is not claimable.
      byId.delete(row.id);
      continue;
    }
    const doc = row.doc as { name?: unknown };
    byId.set(row.id, {
      store,
      id: row.id,
      name: typeof doc.name === "string" && doc.name ? doc.name : row.id,
      status: row.status,
      source: row.source,
      ...claimState(row.id, row.ownerOrgId ?? null, ctx),
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Assemble the console's rows: seeds + any-status overlay per store, both
 * halves of every claim resolved to org names. Sorted store-order first
 * (CLAIM_STORES), then by name.
 */
export async function getClaimsConsoleRows(): Promise<ClaimsConsoleRow[]> {
  const ctx = await loadClaimContext();
  const perStore = await Promise.all(CLAIM_STORES.map((store) => assembleStore(store, ctx)));
  return perStore.flat();
}

/**
 * One row, assembled exactly the way the console assembles it — the release
 * route's answer to "what does this listing look like now?", so the console
 * and the API can never describe the same listing differently. Returns null
 * for an unknown or tombstoned id.
 */
export async function getClaimsConsoleRow(
  store: ClaimStore,
  id: string,
): Promise<ClaimsConsoleRow | null> {
  const rows = await assembleStore(store, await loadClaimContext());
  return rows.find((r) => r.id === id) ?? null;
}
