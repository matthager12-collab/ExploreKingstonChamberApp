// E08 admin worklist API — the queue behind /admin/worklist.
//
// GET  ?type=&state=&assignee=me|unassigned&overdue=1&subjectStore=
//      → { items, counts } — items carry a `subject` snapshot (any-status
//      record or null) so the UI can diff a moderation proposal against
//      what is stored without a second round trip.
// POST { action, ... } — one verb per request:
//      claim {id} · due {id, dueAt|null} · approve {id} · reject {id, note}
//      · verify {id} (staleness) · resolve {id, resolution, note?}
//      · dismiss {id, note?} · takedown {store, subjectId, note?}
//
// Approve re-validates the proposal through the store write-gate AT APPROVAL
// TIME (schemas may have tightened since submission); a proposal that fails
// is auto-REJECTED with the validation message in the resolution note —
// never force-written (epic constraint).
//
// 401 signed out · 403 signed in but not admin. Route handlers bypass
// layouts, so this file gates itself with the single requireAdmin().

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import { markRecordVerified } from "@/lib/db/records";
import { RecordValidationError } from "@/lib/db/store-schemas";
import {
  ModerationActionError,
  approveModerationItem,
  getSubjectRecord,
  rejectModerationItem,
  takedownLiveRecord,
} from "@/lib/moderation";
import { revalidatePublicPathsForStore } from "@/lib/public-paths";
import {
  WORKLIST_STATES,
  WORKLIST_TYPES,
  WorklistValidationError,
  type WorklistState,
  type WorklistType,
} from "@/lib/schemas/worklist";
import {
  claimItem,
  dismissItem,
  getWorklistCounts,
  getWorklistItem,
  listWorklistItems,
  resolveItem,
  setDue,
  type WorklistFilters,
} from "@/lib/stores/worklist-store";

export const dynamic = "force-dynamic";

function bad(error: string, status = 400): NextResponse {
  return NextResponse.json({ error }, { status });
}

export async function GET(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const user = (await getSessionUser())!;

  const params = request.nextUrl.searchParams;
  const filters: WorklistFilters = {};

  const type = params.get("type");
  if (type) {
    if (!(WORKLIST_TYPES as readonly string[]).includes(type)) return bad("unknown type");
    filters.type = type as WorklistType;
  }
  const state = params.get("state");
  if (state === "active") filters.state = ["open", "in_progress"];
  else if (state) {
    if (!(WORKLIST_STATES as readonly string[]).includes(state)) return bad("unknown state");
    filters.state = state as WorklistState;
  }
  const assignee = params.get("assignee");
  if (assignee === "me") filters.assigneeUserId = user.id;
  else if (assignee === "unassigned") filters.unassignedOnly = true;
  if (params.get("overdue") === "1") filters.overdueOnly = true;
  const subjectStore = params.get("subjectStore");
  if (subjectStore) filters.subjectStore = subjectStore;

  const [items, counts] = await Promise.all([listWorklistItems(filters), getWorklistCounts()]);
  const withSubjects = await Promise.all(
    items.map(async (item) => ({
      ...item,
      subject: (await getSubjectRecord(item.subjectStore, item.subjectId)) ?? null,
    })),
  );
  return NextResponse.json({ items: withSubjects, counts });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const user = (await getSessionUser())!;
  const admin = { id: user.id, email: user.email };

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid request body");
  }
  const action = typeof body.action === "string" ? body.action : "";
  const meta = { actor: user.email, source: "admin" as const };

  // Takedown targets a RECORD, not an existing item (M-16-01 one-click).
  if (action === "takedown") {
    const store = typeof body.store === "string" ? body.store : "";
    const subjectId = typeof body.subjectId === "string" ? body.subjectId : "";
    if (!store || !subjectId) return bad("store and subjectId required");
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : undefined;
    try {
      const { label } = await takedownLiveRecord(store, subjectId, admin, note);
      // A takedown is the one action where the delay is worst: the record is
      // off the site the moment this returns, but a visitor could still be
      // served the cached page carrying it.
      await revalidatePublicPathsForStore(store);
      return NextResponse.json({ ok: true, label });
    } catch (err) {
      if (err instanceof ModerationActionError) return bad(err.message, 404);
      throw err;
    }
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return bad("id required");
  const item = await getWorklistItem(id);
  if (!item) return bad("item not found", 404);
  const note = typeof body.note === "string" ? body.note.trim() : "";

  switch (action) {
    case "claim": {
      const row = await claimItem(id, user.id, meta);
      return row ? NextResponse.json({ ok: true, item: row }) : bad("item is not active", 409);
    }
    case "due": {
      const dueAt =
        body.dueAt == null || body.dueAt === ""
          ? null
          : new Date(String(body.dueAt));
      if (dueAt !== null && Number.isNaN(dueAt.getTime())) return bad("invalid dueAt");
      const row = await setDue(id, dueAt, meta);
      return row ? NextResponse.json({ ok: true, item: row }) : bad("item is not active", 409);
    }
    case "approve": {
      if (item.type !== "moderation") return bad("only moderation items can be approved");
      if (item.state !== "open" && item.state !== "in_progress") {
        return bad("item is not active", 409);
      }
      try {
        await approveModerationItem(item, admin);
      } catch (err) {
        if (err instanceof RecordValidationError) {
          // Tightened schema caught the proposal: auto-reject, never force-write.
          await rejectModerationItem(item, `Failed re-validation: ${err.message}`, admin);
          return NextResponse.json(
            { error: err.message, rejected: true },
            { status: 409 },
          );
        }
        if (err instanceof ModerationActionError) return bad(err.message, 409);
        throw err;
      }
      // The approval published content — refresh the pages that render it so
      // the reviewer can see their own decision take effect.
      await revalidatePublicPathsForStore(item.subjectStore);
      return NextResponse.json({ ok: true });
    }
    case "reject": {
      if (item.type !== "moderation") return bad("only moderation items can be rejected");
      if (!note) return bad("a note is required to reject — tell the submitter why");
      await rejectModerationItem(item, note, admin);
      return NextResponse.json({ ok: true });
    }
    case "verify": {
      if (item.type !== "staleness") return bad("verify applies to staleness items");
      // Stamp first, resolve second — a stamp without a resolved item just
      // means the sweep skips it next run; the reverse would lose the stamp.
      await markRecordVerified(item.subjectStore, item.subjectId, meta);
      const row = await resolveItem(
        id,
        { resolution: "verified", note: note || undefined, resolvedBy: user.id },
        meta,
      );
      return row ? NextResponse.json({ ok: true }) : bad("item is not active", 409);
    }
    case "resolve": {
      const resolution = typeof body.resolution === "string" ? body.resolution : "";
      if (!resolution) return bad("resolution required");
      try {
        const row = await resolveItem(
          id,
          { resolution, note: note || undefined, resolvedBy: user.id },
          meta,
        );
        return row ? NextResponse.json({ ok: true }) : bad("item is not active", 409);
      } catch (err) {
        if (err instanceof WorklistValidationError) return bad(err.message);
        throw err;
      }
    }
    case "dismiss": {
      const row = await dismissItem(id, { note: note || undefined, resolvedBy: user.id }, meta);
      return row ? NextResponse.json({ ok: true }) : bad("item is not active", 409);
    }
    default:
      return bad("unknown action");
  }
}
