// Admin-only deletion of a single feedback submission.
//
// WHY THIS EXISTS: the public privacy notice (version 2026-08, "Feedback you
// send us") tells visitors they can have a comment removed before the 12-month
// window runs out. feedback_response has no identifier to look a person up by,
// so the notice is worded around the visitor quoting their own wording back —
// an admin finds that comment on /admin/feedback and deletes it here. Without
// this route that published promise would have no mechanism behind it, which
// is worse than not having made it.
//
// Rows are addressed by their append timestamp: the table is (ts, response)
// with no id, deliberately, because it is a log and not a record.

import { NextRequest } from "next/server";

import { appendPrivacyAudit } from "@/lib/db/privacy-delete";
import { feedbackStore } from "@/lib/feedback-store";

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

  // Integer-checked, not just truthy: a non-integer would reach the DELETE as
  // a malformed bigint and error, and `0`/negative ids never exist.
  const id = body.id;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "id (positive integer) required" }, { status: 400 });
  }

  const removed = await feedbackStore.remove(id);

  // Log the fulfillment, not the content. The audit table is append-only and
  // never purged, so writing the deleted comment into it would re-immortalize
  // the exact text a visitor just asked us to destroy — the same trap
  // scrubRecordDocFields avoids for charity contact emails. The timestamp and
  // the actor are what an auditor needs; the words are what they must not get.
  if (removed) {
    const user = await getSessionUser();
    await appendPrivacyAudit({
      actor: user?.email ?? "admin",
      action: "feedback-delete",
      store: "feedback_response",
      recordId: String(id),
      detail: { reason: "visitor deletion request (privacy notice 2026-08)" },
    });
  }

  // `removed: false` is not an error — the row was already gone (retention got
  // there first, or a double-click). The admin UI says so rather than
  // reporting a failure that would send someone looking for a bug.
  return Response.json({ ok: true, removed });
}
