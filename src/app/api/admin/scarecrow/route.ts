// Admin-only removal of one Scarecrow Crawl vote and its photo.
//
// WHY THIS EXISTS: photos arrive from the street with no account behind them.
// They are never published — only the Chamber sees them — but "never published"
// is not the same as "must be kept", and waiting out a 12-month retention
// window is the wrong answer for a photo that should not have been sent.
// Deleting the vote with it is deliberate: leaving a countable vote attached to
// a removed photo would apply half the Chamber's decision.

import { NextRequest } from "next/server";

import { appendPrivacyAudit } from "@/lib/db/privacy-delete";
import { removeVote } from "@/lib/stores/scarecrow-store";

export async function DELETE(request: NextRequest) {
  const { requireAdmin, getSessionUser } = await import("@/lib/auth");
  const denied = await requireAdmin();
  if (denied) return denied;

  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const id = body.id;
  if (typeof id !== "string" || id === "" || id.length > 100) {
    return Response.json({ error: "id (string) required" }, { status: 400 });
  }

  const removed = await removeVote(id);

  // Log the fulfillment, not the content: the audit table is append-only and
  // never purged, so it records that a vote was removed and by whom — never
  // the photo, and nothing that could reconstruct it.
  if (removed) {
    const user = await getSessionUser();
    await appendPrivacyAudit({
      actor: user?.email ?? "admin",
      action: "scarecrow-vote-delete",
      store: "scarecrow_vote",
      recordId: id,
      detail: { reason: "Chamber removed a crawl photo" },
    });
  }

  // `removed: false` is not an error — retention got there first, or it was a
  // double-click. The UI says so rather than sending someone hunting a bug.
  return Response.json({ ok: true, removed });
}
