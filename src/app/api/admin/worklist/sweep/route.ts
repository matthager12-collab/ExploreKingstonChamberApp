// E08 staleness sweep — POST enqueues one worklist item per live record whose
// verify-by window has lapsed (see STALENESS_DEFAULTS for the per-store
// intervals). Idempotent by construction: the worklist's partial unique index
// makes a re-run of an already-open subject a no-op, so the cron can fire as
// often as it likes.
//
// Auth: an admin session OR `Authorization: Bearer $WORKLIST_SWEEP_TOKEN`
// (?token= also accepted — cron schedulers vary; pattern from
// src/app/api/ferry/observe/route.ts). UNLIKE the ferry route this gate
// FAILS CLOSED: with the env var unset the token path simply doesn't exist —
// a worklist write is not public-data telemetry, so open-when-unset would be
// wrong here. The scheduler registration lives in docs/OPERATIONS.md.
//
// Seed-only records carry no governance row and are not swept until a write
// overlays them — docs/OPERATIONS.md "Worklist & moderation" explains.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, listUsers, requireAdmin } from "@/lib/auth";
import { listVerifyDue } from "@/lib/db/records";
import {
  createWorklistItem,
  escalateItem,
  listWorklistItems,
  STALENESS_DEFAULTS,
} from "@/lib/stores/worklist-store";

export const dynamic = "force-dynamic";

/** How long a business owner has to confirm their own series before the task
 *  goes back to the Chamber. Two weeks covers a holiday or a busy fortnight
 *  without letting a stale series sit unchallenged for a whole quarter. */
export const OWNER_VERIFY_DAYS = 14;

export async function POST(request: NextRequest) {
  const expected = process.env.WORKLIST_SWEEP_TOKEN;
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.nextUrl.searchParams.get("token") ??
    "";
  const tokenOk = Boolean(expected && provided && provided === expected);

  let actor = "system";
  if (!tokenOk) {
    const denied = await requireAdmin();
    if (denied) return denied;
    actor = (await getSessionUser())!.email;
  }

  const due = await listVerifyDue(STALENESS_DEFAULTS);
  // Owner lookup for event series. One read, not one per record: the Chamber
  // has tens of accounts, and the sweep can carry hundreds of records.
  const usersByOrg = new Map<string, string>();
  if (due.some((r) => r.store === "events")) {
    for (const u of await listUsers()) {
      if (u.orgId && !usersByOrg.has(u.orgId)) usersByOrg.set(u.orgId, u.id);
    }
  }

  let created = 0;
  let alreadyOpen = 0;
  let skippedSingleEvents = 0;
  let assignedToOwner = 0;
  for (const record of due) {
    // A single-occurrence event expires on its own; only a SERIES goes stale
    // while still on the calendar. See STALENESS_DEFAULTS for the reasoning.
    if (record.store === "events" && !record.doc.rrule) {
      skippedSingleEvents += 1;
      continue;
    }

    const label =
      String(record.doc.name ?? record.doc.title ?? record.id) || record.id;

    // A series the business runs is a question for the business. Assign it to
    // them with a deadline; escalateOverdue below hands it back to the Chamber
    // if nothing happens. An ownerless series (Chamber-created, or an owner
    // with no account) skips straight to the Chamber's unassigned queue.
    const ownerUserId =
      record.store === "events" && typeof record.doc.ownerId === "string"
        ? usersByOrg.get(record.doc.ownerId)
        : undefined;

    const result = await createWorklistItem(
      {
        type: "staleness",
        subjectStore: record.store,
        subjectId: record.id,
        subjectLabel: label,
        payload: {
          lastVerifiedAt: record.lastVerifiedAt?.toISOString() ?? null,
          intervalDays: record.intervalDays,
        },
        ...(ownerUserId
          ? {
              assigneeUserId: ownerUserId,
              dueAt: new Date(Date.now() + OWNER_VERIFY_DAYS * 86_400_000),
            }
          : {}),
      },
      { actor, source: "system" },
    );
    if (result.created) created += 1;
    else alreadyOpen += 1;
    if (ownerUserId && result.created) assignedToOwner += 1;
  }

  const escalated = await escalateOverdue(actor);

  return NextResponse.json({
    ok: true,
    // Records this sweep actually weighed. A one-off event is filtered as
    // not-applicable rather than judged fresh, so it is reported under
    // skippedSingleEvents instead of inflating this count.
    scanned: due.length - skippedSingleEvents,
    created,
    alreadyOpen,
    skippedSingleEvents,
    assignedToOwner,
    escalated,
  });
}

/**
 * Hand back every assigned staleness item whose deadline has passed.
 *
 * Runs on the same pass as the sweep rather than on its own schedule: the two
 * are the same job seen from both ends ("ask the owner" / "stop waiting"), and
 * one cron is one thing to keep alive. Doing nothing must not be a way to hold
 * a task forever, so the deadline expiring IS the answer.
 */
async function escalateOverdue(actor: string): Promise<number> {
  // Both active states: opening a task is not answering it, so an owner who
  // claimed it and then went quiet escalates on the same deadline as one who
  // never looked.
  const overdue = await listWorklistItems({
    type: "staleness",
    state: ["open", "in_progress"],
    overdueOnly: true,
  });
  let escalated = 0;
  for (const item of overdue) {
    if (!item.assigneeUserId) continue; // already the Chamber's
    const moved = await escalateItem(item.id, { actor, source: "system" });
    if (moved) escalated += 1;
  }
  return escalated;
}
