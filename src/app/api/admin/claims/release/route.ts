// POST /api/admin/claims/release — take a claim back off a listing (E17).
//
// Until this existed, `record.owner_org_id` was a ONE-WAY DOOR: nothing in the
// product ever set it back to null, so a claim minted to the wrong business
// bricked that listing forever — the owner could not be re-invited (the mint
// refusal 409s on the stamp) and the real owner could never be onboarded. The
// refusal message even told the admin to "revoke that organization's claim
// first", naming an action that did not exist. It now names this.
//
// Release moves BOTH halves of the claim, because they are one truth:
//   - clears record.owner_org_id (the stamp the console and the mint refusal
//     read), via writeRecord so it is validated and audited like any write,
//     passing the row's CURRENT status back — releasing a claimed draft must
//     not publish it;
//   - drops the id from the linked_ids of every org holding it (the grant
//     can(user, "edit-record", id) actually decides from). Clearing only the
//     stamp would leave the business still editing a listing the console
//     calls unclaimed.
// Every org that holds a grant is stripped, not just the stamped one: when
// the two halves disagree (the console's `mismatch` states), releasing only
// the stamped org would leave the other one editing.
//
// Destructive and admin-only: it revokes a business's access to its own
// listing. Route handlers bypass layouts, so this file gates itself with
// requireAdmin(). It never touches a record the caller did not name.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import { removeOrgLinkedIds } from "@/lib/auth/identity";
import { getClaimsConsoleRow } from "@/lib/claims/console-data";
import { isClaimStore } from "@/lib/claims/roles";
import { RecordValidationError } from "@/lib/db/store-schemas";
import { releaseRecordOwnership } from "@/lib/ownership";

export const dynamic = "force-dynamic";

function bad(error: string, status = 400): NextResponse {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const actor = (await getSessionUser())!;

  let body: { store?: unknown; id?: unknown };
  try {
    body = (await request.json()) as { store?: unknown; id?: unknown };
  } catch {
    return bad("invalid request");
  }

  const store = typeof body.store === "string" ? body.store : "";
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!isClaimStore(store)) return bad("store must be a claimable listing store");
  if (!id) return bad("id required");

  // Assembled the same way the console assembles it, so "is this claimed?"
  // has exactly one answer in the product — the UNION of stamp and grant.
  const before = await getClaimsConsoleRow(store, id);
  if (!before) return bad("that listing does not exist", 404);
  if (!before.claimed) {
    return bad("that listing is not claimed — there is nothing to release", 404);
  }

  let released;
  try {
    released = await releaseRecordOwnership(store, id, actor.email);
  } catch (err) {
    if (err instanceof RecordValidationError) {
      // The stored doc no longer satisfies its schema, so it cannot be
      // rewritten. Say so rather than half-releasing.
      return bad(`that listing cannot be rewritten: ${err.message}`, 409);
    }
    throw err;
  }

  // Grant half. A no-op for an org that holds no grant, and it writes no
  // audit row in that case.
  const orgIds = new Set(before.grantOrgs.map((g) => g.id));
  if (released.previousOwnerOrgId) orgIds.add(released.previousOwnerOrgId);
  const unlinked: string[] = [];
  for (const orgId of orgIds) {
    const hadGrant = before.grantOrgs.some((g) => g.id === orgId);
    const org = await removeOrgLinkedIds(orgId, [id], actor.email);
    if (hadGrant && org && !org.linkedIds.includes(id)) unlinked.push(orgId);
  }

  const row = await getClaimsConsoleRow(store, id);
  return NextResponse.json({
    ok: true,
    row,
    released: {
      ownerOrgId: released.previousOwnerOrgId,
      unlinkedOrgIds: unlinked,
    },
  });
}
