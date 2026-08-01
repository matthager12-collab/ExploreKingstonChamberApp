// Invite-request validation + minting, in ONE place.
//
// Extracted from POST /api/portal/invites (E06) so the batch onboarding
// script (scripts/mint-invites.ts) mints through the exact same rules the
// admin UI does — same role check, same linked-id validation against the real
// stores, same note truncation, same createInvite call. Every rejection here
// throws an AuthError carrying the message the route used to inline, and the
// route still maps AuthError → 400.
//
// linkedIds are validated against the real stores, so a typo'd or malicious
// id can never pre-grant edit rights over a listing created later. For
// kind:"business" the valid universe is restaurants ∪ lodging (portal-lodging,
// PR #124) ∪ directory (E17; drafts included — imported drafts are what gets
// claimed) — one universe for BOTH writers, route and script alike. E17 also
// refuses at mint time any linked record that already carries owner_org_id.

// Submodule imports, not the "@/lib/auth" barrel: the barrel re-exports
// session.ts (next/headers), which a plain-Node script cannot load.
// identity.ts is explicitly request-scope-free for exactly this use.
import { AuthError, createInvite, getOrg, type InviteRow } from "@/lib/auth/identity";
import { ROLES, type OrgKind, type Role } from "@/lib/auth/roles";
import { findOwnedLinkedRecords, OwnershipConflictError } from "@/lib/ownership";
import { getRestaurants } from "@/lib/stores/business-store";
import { getCharities } from "@/lib/stores/charity-store";
import { getDirectoryListingsAdmin } from "@/lib/stores/directory-store";
import { getLodging } from "@/lib/stores/listing-stores";

/** The untrusted request shape — exactly what the route reads out of JSON. */
export interface InviteRequestBody {
  role?: unknown;
  linkedIds?: unknown;
  note?: unknown;
  email?: unknown;
  orgId?: unknown;
  newOrgName?: unknown;
}

/**
 * Validate an invite request and mint the invite.
 *
 * Throws AuthError (message meant for a human, caller maps it to a 400) for
 * every rejection — both the checks that used to live inline in the route
 * and the ones createInvite itself enforces (admin-requires-email, org
 * join-XOR-create).
 */
export async function mintInvite(
  body: InviteRequestBody,
  actor: string,
): Promise<InviteRow> {
  const role = body.role as Role;
  if (!ROLES.includes(role)) {
    throw new AuthError(`role must be one of: ${ROLES.join(", ")}`);
  }

  // Only org roles carry linked ids — staff (admin/moderator/viewer) either
  // edit everything or nothing, so a list would be meaningless.
  const isOrgRole = role === "org-editor" || role === "member-business";
  const linkedIds =
    isOrgRole && Array.isArray(body.linkedIds)
      ? [...new Set(body.linkedIds.filter((x): x is string => typeof x === "string"))]
      : [];

  // The org's kind is DERIVED from the role, never taken from the caller.
  // It decides which store linked_ids point into, and linkedIds below are
  // validated against the store this same expression picks — so accepting a
  // caller-sent kind would let an org-editor invite (charity ids, validated as
  // charities) create a kind:"business" org, permanently inconsistent with its
  // own contents. An input that cannot be wrong beats an input that is checked.
  const kind: OrgKind = role === "member-business" ? "business" : "nonprofit";

  if (linkedIds.length > 0) {
    // kind:"business" spans the member-editable listing stores — restaurants,
    // lodging, and (E17) the directory — so a hotel, marina, or imported
    // directory listing can be onboarded exactly like a restaurant. The
    // directory is read through its ADMIN getter on purpose: imported records
    // sit as drafts, and drafts are precisely what gets claimed. Ids the
    // union does not contain are still rejected outright.
    const records =
      kind === "business"
        ? [
            ...(await getRestaurants()),
            ...(await getLodging()),
            ...(await getDirectoryListingsAdmin()),
          ]
        : await getCharities();
    const valid = new Set(records.map((r) => r.id));
    const unknown = linkedIds.filter((id) => !valid.has(id));
    if (unknown.length > 0) {
      throw new AuthError(
        `unknown ${kind === "business" ? "business" : "charity"} id(s): ${unknown.join(", ")}`,
      );
    }

    // E17 mint-time refusal: a record an org already owns must not be minted
    // into a second claim. Named so the admin knows who holds it; the route
    // maps OwnershipConflictError to a 409.
    const owned = await findOwnedLinkedRecords(kind, linkedIds);
    if (owned.length > 0) {
      const parts = await Promise.all(
        owned.map(async (o) => {
          const org = await getOrg(o.ownerOrgId);
          return `${o.id} is already claimed by ${org?.name ?? o.ownerOrgId}`;
        }),
      );
      throw new OwnershipConflictError(
        `${parts.join("; ")} — revoke that organization's claim first, or invite this person into it instead.`,
      );
    }
  }

  const note =
    typeof body.note === "string" && body.note.trim() !== ""
      ? body.note.trim().slice(0, 200)
      : null;

  // createInvite enforces admin-requires-email and org join-XOR-create, and
  // throws an AuthError whose message is meant for a human.
  return createInvite(
    {
      role,
      linkedIds,
      note,
      email: typeof body.email === "string" ? body.email : null,
      orgId: typeof body.orgId === "string" ? body.orgId : null,
      newOrgName: typeof body.newOrgName === "string" ? body.newOrgName : null,
      // Derived above from the role — a caller-sent kind is deliberately ignored.
      newOrgKind: isOrgRole ? kind : null,
    },
    actor,
  );
}
