// Admin-only invite management (E06).
//
// GET    → every invite with its derived state (active / used / revoked /
//          expired), so the admin list shows WHY a code will not work.
// POST   → mint a code for a role, with an optional email binding, a 14-day
//          expiry, and either an existing org or a new one to create.
// DELETE → revoke an un-redeemed code (FR-A09: same-day revocation of a grant
//          that has not been used yet).
//
// v1 invites never expired, were not bound to an email, and could not be
// revoked — a forwarded code was a permanent bearer grant. All three are fixed
// here, and the DATABASE enforces the same rules
// (invites_admin_requires_email, invites_org_binding) so a second writer
// cannot bypass them.
//
// linkedIds are still validated against the real stores, so a typo'd or
// malicious id can never pre-grant edit rights over a listing created later.

import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  ROLES,
  createInvite,
  getSessionUser,
  inviteState,
  listInvites,
  requireRole,
  revokeInvite,
  type OrgKind,
  type Role,
} from "@/lib/auth";
import { getRestaurants } from "@/lib/stores/business-store";
import { getCharities } from "@/lib/stores/charity-store";

export async function GET() {
  const denied = await requireRole("admin");
  if (denied) return denied;
  const invites = (await listInvites()).map((i) => ({ ...i, state: inviteState(i) }));
  return NextResponse.json({ invites });
}

export async function POST(request: NextRequest) {
  const denied = await requireRole("admin");
  if (denied) return denied;
  const actor = (await getSessionUser())!;

  let body: {
    role?: unknown;
    linkedIds?: unknown;
    note?: unknown;
    email?: unknown;
    orgId?: unknown;
    newOrgName?: unknown;
    newOrgKind?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const role = body.role as Role;
  if (!ROLES.includes(role)) {
    return NextResponse.json(
      { error: `role must be one of: ${ROLES.join(", ")}` },
      { status: 400 },
    );
  }

  // Only org roles carry linked ids — staff (admin/moderator/viewer) either
  // edit everything or nothing, so a list would be meaningless.
  const isOrgRole = role === "org-editor" || role === "member-business";
  const linkedIds =
    isOrgRole && Array.isArray(body.linkedIds)
      ? [...new Set(body.linkedIds.filter((x): x is string => typeof x === "string"))]
      : [];

  // The org's kind is DERIVED from the role, never taken from the client.
  // It decides which store linked_ids point into, and linkedIds below are
  // validated against the store this same expression picks — so accepting a
  // client-sent kind would let an org-editor invite (charity ids, validated as
  // charities) create a kind:"business" org, permanently inconsistent with its
  // own contents. An input that cannot be wrong beats an input that is checked.
  const kind: OrgKind = role === "member-business" ? "business" : "nonprofit";

  if (linkedIds.length > 0) {
    const records = kind === "business" ? await getRestaurants() : await getCharities();
    const valid = new Set(records.map((r) => r.id));
    const unknown = linkedIds.filter((id) => !valid.has(id));
    if (unknown.length > 0) {
      return NextResponse.json(
        {
          error: `unknown ${kind === "business" ? "restaurant" : "charity"} id(s): ${unknown.join(", ")}`,
        },
        { status: 400 },
      );
    }
  }

  const note =
    typeof body.note === "string" && body.note.trim() !== ""
      ? body.note.trim().slice(0, 200)
      : null;

  try {
    // createInvite enforces admin-requires-email and org join-XOR-create, and
    // throws an AuthError whose message is meant for a human.
    const invite = await createInvite(
      {
        role,
        linkedIds,
        note,
        email: typeof body.email === "string" ? body.email : null,
        orgId: typeof body.orgId === "string" ? body.orgId : null,
        newOrgName: typeof body.newOrgName === "string" ? body.newOrgName : null,
        // Derived above from the role — body.newOrgKind is deliberately ignored.
        newOrgKind: isOrgRole ? kind : null,
      },
      actor.email,
    );
    return NextResponse.json({ ok: true, invite: { ...invite, state: inviteState(invite) } });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("invite mint failed", err);
    return NextResponse.json({ error: "could not mint that invite" }, { status: 500 });
  }
}

/** DELETE ?code=… — revoke an un-redeemed invite. */
export async function DELETE(request: NextRequest) {
  const denied = await requireRole("admin");
  if (denied) return denied;
  const actor = (await getSessionUser())!;

  const code = new URL(request.url).searchParams.get("code");
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });

  const revoked = await revokeInvite(code, actor.email);
  if (!revoked) {
    // Already used, already revoked, or never existed. One message for all
    // three: the admin's next step is identical, and it tells a caller nothing
    // about which codes exist.
    return NextResponse.json({ error: "that code is not an active invite" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
