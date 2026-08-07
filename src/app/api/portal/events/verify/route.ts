// "Yes, this series is still right" — the business owner's half of the
// quarterly repeating-event check.
//
// The sweep (src/app/api/admin/worklist/sweep/route.ts) assigns a staleness
// item for each repeating event to the owning account, with a 14-day deadline.
// This route is the only way an owner can answer it; missing the deadline
// hands the task back to the Chamber instead.
//
// AUTHORISATION is the assignment itself, not the listing ownership. The item
// carries an assigneeUserId; only that user (or an admin) may resolve it. That
// way a re-assignment — an escalation, or the Chamber taking it over — moves
// the right to answer with it, and an owner cannot resolve a task that is no
// longer theirs.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { markRecordVerified } from "@/lib/db/records";
import { getWorklistItem, resolveItem } from "@/lib/stores/worklist-store";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });

  const item = await getWorklistItem(itemId);
  // One 404 for "no such item" and "not yours": a portal user should not be
  // able to probe which worklist ids exist.
  const mine = item && (item.assigneeUserId === user.id || user.role === "admin");
  if (!item || !mine) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (item.type !== "staleness" || item.subjectStore !== "events") {
    return NextResponse.json({ error: "not an event check" }, { status: 400 });
  }
  if (item.state === "resolved" || item.state === "dismissed") {
    return NextResponse.json({ error: "already answered" }, { status: 409 });
  }

  const meta = { actor: user.email, source: "portal" as const };
  // Stamp the record FIRST: last_verified_at is what stops the next sweep
  // re-raising this series, so a failure between the two must leave the task
  // open rather than closing it with the clock unreset.
  await markRecordVerified("events", item.subjectId, meta);
  await resolveItem(
    item.id,
    { resolution: "verified", resolvedBy: user.email },
    meta,
  );

  return NextResponse.json({ ok: true });
}
