// Admin-only controls for the Scarecrow Crawl.
//
// POST   { voting: "auto" | "open" | "closed" }  — the voting switch.
// DELETE { id }                                  — remove one photo + its vote.
// DELETE { all: true }                           — clear every vote and photo.
//
// WHY REMOVAL EXISTS: photos arrive from the street with no account behind
// them. They are never published — only the Chamber sees them — but "never
// published" is not the same as "must be kept", and waiting out a 12-month
// retention window is the wrong answer for a photo that should not have been
// sent. Deleting the vote with it is deliberate: leaving a countable vote
// attached to a removed photo would apply half the Chamber's decision.
//
// WHY CLEAR-ALL EXISTS: the Chamber rehearses the crawl before it opens, and a
// rehearsal leaves real rows in the tally. The button empties it. It is
// irreversible, so the UI quotes the number first and the audit trail records
// who pressed it.
//
// 401 signed out · 403 signed in but not admin. The /admin layout gates the
// console; this handler re-checks because route handlers bypass layouts.

import { NextRequest } from "next/server";

import { isVotingOverride } from "@/lib/data/scarecrows";
import { appendPrivacyAudit } from "@/lib/db/privacy-delete";
import { clearAllVotes, removeVote, setVotingOverride } from "@/lib/stores/scarecrow-store";

export async function POST(request: NextRequest) {
  const { requireAdmin, getSessionUser } = await import("@/lib/auth");
  const denied = await requireAdmin();
  if (denied) return denied;
  const actor = (await getSessionUser())!.email;

  let body: { voting?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!isVotingOverride(body.voting)) {
    return Response.json(
      { error: "voting must be auto, open, or closed" },
      { status: 400 },
    );
  }

  await setVotingOverride(body.voting, { actor, source: "admin" });
  return Response.json({ ok: true, voting: body.voting });
}

export async function DELETE(request: NextRequest) {
  const { requireAdmin, getSessionUser } = await import("@/lib/auth");
  const denied = await requireAdmin();
  if (denied) return denied;
  const actor = (await getSessionUser())!.email;

  let body: { id?: unknown; all?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (body.all === true) {
    const deleted = await clearAllVotes();
    // The count and the actor, never the content: the audit table is
    // append-only and never purged.
    await appendPrivacyAudit({
      actor,
      action: "scarecrow-votes-clear",
      store: "scarecrow_vote",
      recordId: "all",
      detail: { deleted, reason: "Chamber cleared the crawl tally" },
    });
    return Response.json({ ok: true, deleted });
  }

  const id = body.id;
  if (typeof id !== "string" || id === "" || id.length > 100) {
    return Response.json({ error: "id (string) required" }, { status: 400 });
  }

  const removed = await removeVote(id);

  if (removed) {
    await appendPrivacyAudit({
      actor,
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
