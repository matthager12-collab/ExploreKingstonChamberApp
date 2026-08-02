// Admin-only invite management (E06).
//
// GET    → every invite with its derived state (active / used / revoked /
//          expired), so the admin list shows WHY a code will not work.
// POST   → mint a code for a role, with an optional email binding, a 14-day
//          expiry, and either an existing org or a new one to create.
//          Validation + minting live in src/lib/invite-mint.ts, shared with
//          the batch onboarding script (scripts/mint-invites.ts) so both
//          paths enforce identical rules.
// DELETE → revoke an un-redeemed code (FR-A09: same-day revocation of a grant
//          that has not been used yet).
//
// v1 invites never expired, were not bound to an email, and could not be
// revoked — a forwarded code was a permanent bearer grant. All three are fixed
// here, and the DATABASE enforces the same rules
// (invites_admin_requires_email, invites_org_binding) so a second writer
// cannot bypass them.

import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  getSessionUser,
  inviteState,
  listInvites,
  requireRole,
  revokeInvite,
} from "@/lib/auth";
import { mintInvite, type InviteRequestBody } from "@/lib/invite-mint";
import { OwnershipConflictError } from "@/lib/ownership";

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

  let body: InviteRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  try {
    // mintInvite rejects with an AuthError whose message is meant for a human
    // — both its own checks (role, linked-id validation) and createInvite's
    // (admin-requires-email, org join-XOR-create).
    const invite = await mintInvite(body, actor.email);
    return NextResponse.json({ ok: true, invite: { ...invite, state: inviteState(invite) } });
  } catch (err) {
    if (err instanceof OwnershipConflictError) {
      // E17: a linked record is already owned by an org — the message names
      // it. 409, not 400: the request was well-formed, the state conflicts.
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
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
