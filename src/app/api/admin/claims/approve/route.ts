// POST /api/admin/claims/approve — decide a pending self-serve claim (E17
// claim-signup slice). The applicant already exists (account + org, created
// at code verification); this route lands or refuses the EDIT RIGHTS:
//
//   approve → grant (org.linked_ids) + ownership stamp (owner_org_id), the
//             same two halves as an invite redemption, via the same domain
//             helpers — then the worklist item resolves "approved";
//   decline → the worklist item resolves "declined" (note required: the
//             applicant may call and ask why); the account stands, rights-free.
//
// Sibling of /api/admin/claims/release, and self-gated the same way: route
// handlers bypass layouts, so requireAdmin() runs here.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import { AuthError } from "@/lib/auth/identity";
import {
  approvePendingClaimSignup,
  ClaimSubjectNotFoundError,
} from "@/lib/claims/self-signup";
import { OwnershipConflictError } from "@/lib/ownership";
import { claimSignupPayloadSchema, WorklistValidationError } from "@/lib/schemas/worklist";
import { getWorklistItem, resolveItem } from "@/lib/stores/worklist-store";

export const dynamic = "force-dynamic";

function bad(error: string, status = 400): NextResponse {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const actor = (await getSessionUser())!;

  let body: { itemId?: unknown; decision?: unknown; note?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad("invalid request");
  }
  const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
  const decision = body.decision === "approve" || body.decision === "decline" ? body.decision : null;
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!itemId) return bad("itemId required");
  if (!decision) return bad("decision must be approve or decline");

  const item = await getWorklistItem(itemId);
  if (!item || item.type !== "claim_signup") {
    return bad("that item is not a pending claim signup", 404);
  }
  if (item.state !== "open" && item.state !== "in_progress") {
    return bad("that claim has already been decided", 409);
  }
  const payload = claimSignupPayloadSchema.safeParse(item.payload);
  if (!payload.success) {
    return bad("that item's payload is malformed — resolve it from the worklist directly", 409);
  }

  if (decision === "decline") {
    if (!note) return bad("a note is required when declining — the applicant may ask why");
    const resolved = await resolveItem(
      itemId,
      { resolution: "declined", note, resolvedBy: actor.email },
      { actor: actor.email, source: "admin" },
    );
    if (!resolved) return bad("that claim has already been decided", 409);
    return NextResponse.json({ ok: true, decision });
  }

  try {
    await approvePendingClaimSignup({
      store: payload.data.store,
      id: payload.data.id,
      orgId: payload.data.orgId,
      actor: actor.email,
    });
  } catch (err) {
    if (err instanceof ClaimSubjectNotFoundError) {
      return bad("that listing no longer exists — decline the item instead", 404);
    }
    if (err instanceof OwnershipConflictError) return bad(err.message, 409);
    if (err instanceof AuthError) return bad(err.message);
    throw err;
  }

  // The claim has landed; the item resolving is bookkeeping. If it was
  // resolved by a racing admin between our state check and here, the grant
  // calls above were idempotent — report success rather than a scary error.
  try {
    await resolveItem(
      itemId,
      {
        resolution: "approved",
        note: note || undefined,
        resolvedBy: actor.email,
      },
      { actor: actor.email, source: "admin" },
    );
  } catch (err) {
    if (!(err instanceof WorklistValidationError)) throw err;
  }

  return NextResponse.json({ ok: true, decision });
}
