// Claims-console data assembly (E17 charter step 6).
//
// One question, answered across all four claimable domains: which listings
// exist, and which of them does an organization already own? "Owned" is the
// governance column owner_org_id on the record row — set when a bound invite
// is redeemed — joined here to the org's name via the identity layer.
//
// Read shape (mirrors readMergedRecordsAdmin, but keeping the governance
// columns the merge helpers deliberately drop):
//   - git seeds participate as unclaimed 'live' rows with source "seed" —
//     a seed with no overlay row has never been written, so it cannot carry
//     an owner;
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
import { CLAIM_STORES, type ClaimStore } from "./roles";

export {
  CLAIM_STORES,
  CLAIM_INVITE_ROLE_BY_STORE,
  CLAIM_STORE_LABELS,
  type ClaimStore,
} from "./roles";

/** One console row. Plain JSON-serializable values only — the server page
 *  hands these straight to the client manager as props. */
export interface ClaimsConsoleRow {
  store: ClaimStore;
  id: string;
  name: string;
  status: RecordStatus;
  /** Row provenance; seed-only records (no overlay row) read as "seed". */
  source: RecordSource;
  claimed: boolean;
  ownerOrgId: string | null;
  /** Resolved org name; falls back to the raw id if the org row is gone. */
  ownerOrgName: string | null;
}

/** The seed universe per store. Directory is seedless by design (E17) —
 *  every record lives in the overlay. */
const SEEDS: Record<ClaimStore, { id: string; name: string }[]> = {
  restaurants: restaurantSeed,
  lodging: lodgingSeed,
  charities: charitySeed,
  directory: [],
};

/**
 * Assemble the console's rows: seeds + any-status overlay per store, owner
 * org names joined. Sorted store-order first (CLAIM_STORES), then by name.
 */
export async function getClaimsConsoleRows(): Promise<ClaimsConsoleRow[]> {
  const orgs = await listOrganizations();
  const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));

  const perStore = await Promise.all(
    CLAIM_STORES.map(async (store) => {
      const byId = new Map<string, ClaimsConsoleRow>();
      for (const seed of SEEDS[store]) {
        byId.set(seed.id, {
          store,
          id: seed.id,
          name: seed.name,
          status: "live",
          source: "seed",
          claimed: false,
          ownerOrgId: null,
          ownerOrgName: null,
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
        const ownerOrgId = row.ownerOrgId ?? null;
        byId.set(row.id, {
          store,
          id: row.id,
          name: typeof doc.name === "string" && doc.name ? doc.name : row.id,
          status: row.status,
          source: row.source,
          claimed: ownerOrgId !== null,
          ownerOrgId,
          ownerOrgName:
            ownerOrgId === null ? null : (orgNameById.get(ownerOrgId) ?? ownerOrgId),
        });
      }
      return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    }),
  );

  return perStore.flat();
}
