// Volunteer needs API for the nonprofit portal.
//
// GET  ?onDate=YYYY-MM-DD[&excludeId=] — public: other events on that
//        Pacific calendar date (the deconfliction check shown before an
//        org commits to a date).
// GET  ?charityId=                     — auth + can(…, "edit-record"): that org's needs.
// POST                                 — create/update a need, or
//        { id, action: "slots", delta: +1|-1 } for the quick signup stepper.
// DELETE ?id=                          — auth + can(…, "edit-record") on the need's org.

import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { can, getSessionUser } from "@/lib/auth";
import {
  deleteVolunteerNeed,
  getVolunteerNeedsAdmin,
  getVolunteerNeedsForCharity,
  saveVolunteerNeed,
} from "@/lib/stores/charity-store";
import {
  holdEditProposal,
  holdNewRecord,
  requestTakedown,
  updatePendingRecord,
  withdrawPendingRecord,
} from "@/lib/moderation";
import { RecordValidationError } from "@/lib/db/store-schemas";
import { eventsSharingDate } from "@/lib/stores/event-store";
import { pacificWallTimeToISO } from "@/lib/time";
import type { VolunteerNeed } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function slugId(title: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "shift";
  return `${slug}-${randomBytes(3).toString("hex")}`;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // Public deconfliction lookup: what else is on the calendar that day?
  const onDate = params.get("onDate");
  if (onDate) {
    if (!DATE_RE.test(onDate)) {
      return NextResponse.json({ error: "onDate must be YYYY-MM-DD" }, { status: 400 });
    }
    const events = await eventsSharingDate(onDate, params.get("excludeId") ?? undefined);
    return NextResponse.json({ ok: true, events });
  }

  const charityId = params.get("charityId");
  if (charityId) {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
    if (!can(user, "edit-record", charityId)) {
      return NextResponse.json({ error: "not allowed" }, { status: 403 });
    }
    // Owner-scoped read (E08): includes the org's own pending submissions,
    // each carrying `status` so the portal can badge "awaiting review".
    const needs = await getVolunteerNeedsForCharity(charityId);
    return NextResponse.json({ ok: true, needs });
  }

  return NextResponse.json({ error: "charityId or onDate required" }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  // Quick +/- stepper: track signups as they come in by email or phone.
  // MODERATION (E08): for members this is still a write to a live public
  // record (the slots-left count renders on /give), so it holds for review
  // like any other member edit — the moderation floor has no fast lanes.
  if (body.action === "slots") {
    const id = typeof body.id === "string" ? body.id : "";
    const delta = body.delta;
    if (!id || (delta !== 1 && delta !== -1)) {
      return NextResponse.json({ error: "id and delta of +1 or -1 required" }, { status: 400 });
    }
    const need = (await getVolunteerNeedsAdmin()).find((n) => n.id === id);
    if (!need) return NextResponse.json({ error: "shift not found" }, { status: 404 });
    if (!can(user, "edit-record", need.charityId)) {
      return NextResponse.json({ error: "not allowed to edit this shift" }, { status: 403 });
    }
    const { status: needStatus, ...needDoc } = need;
    const updated: VolunteerNeed = {
      ...needDoc,
      slotsFilled: Math.max(0, Math.min(need.slotsTotal, need.slotsFilled + delta)),
    };
    const isAdmin = user.role === "admin";
    try {
      if (isAdmin) {
        await saveVolunteerNeed(updated, { actor: user.email, source: "admin" });
      } else if (needStatus === "pending") {
        await updatePendingRecord("volunteer-needs", updated, updated.title, user);
      } else {
        await holdEditProposal("volunteer-needs", updated, updated.title, user);
      }
    } catch (err) {
      if (err instanceof RecordValidationError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
    return NextResponse.json(
      isAdmin || needStatus === "pending"
        ? { ok: true, need: updated }
        : { ok: true, need: updated, pending: true },
    );
  }

  // Create or update a shift.
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const timeRange = typeof body.timeRange === "string" ? body.timeRange.trim() : "";
  const rawDate = typeof body.date === "string" ? body.date.trim() : "";
  if (!title || !timeRange || !rawDate) {
    return NextResponse.json({ error: "title, date, and time range are required" }, { status: 400 });
  }

  // Accept a bare date from the form (anchor at Pacific midnight so it lands
  // on the right calendar day) or a full ISO instant from prior data.
  let date: string;
  if (DATE_RE.test(rawDate)) date = pacificWallTimeToISO(rawDate, "00:00");
  else if (/^\d{4}-\d{2}-\d{2}T/.test(rawDate)) date = rawDate;
  else return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const slotsTotal = Math.min(999, Math.max(1, Math.floor(Number(body.slotsTotal)) || 1));
  const slotsFilled = Math.min(
    slotsTotal,
    Math.max(0, Math.floor(Number(body.slotsFilled)) || 0),
  );

  let id: string;
  let charityId: string;
  let eventId: string | undefined;
  let storedStatus: "live" | "pending" | "other" | "none" = "none";
  if (typeof body.id === "string" && body.id) {
    // Update: ownership comes from the stored record, never the client.
    // Any-status lookup (E08) so an org can still fix its pending submission.
    const existing = (await getVolunteerNeedsAdmin()).find((n) => n.id === body.id);
    if (!existing) return NextResponse.json({ error: "shift not found" }, { status: 404 });
    if (!can(user, "edit-record", existing.charityId)) {
      return NextResponse.json({ error: "not allowed to edit this shift" }, { status: 403 });
    }
    id = existing.id;
    charityId = existing.charityId;
    eventId = existing.eventId;
    storedStatus =
      existing.status === "live" ? "live" : existing.status === "pending" ? "pending" : "other";
  } else {
    charityId = typeof body.charityId === "string" ? body.charityId : "";
    if (!charityId) return NextResponse.json({ error: "charityId required" }, { status: 400 });
    if (!can(user, "edit-record", charityId)) {
      return NextResponse.json(
        { error: "not allowed to add shifts for this organization" },
        { status: 403 },
      );
    }
    id = slugId(title);
  }

  const record: VolunteerNeed = {
    id,
    charityId,
    eventId,
    title,
    date,
    timeRange,
    slotsTotal,
    slotsFilled,
    description: typeof body.description === "string" ? body.description.trim() : "",
  };
  // MODERATION FLOOR (E08): admin saves publish directly; member writes hold
  // for Chamber review (see src/lib/moderation.ts).
  const isAdmin = user.role === "admin";
  try {
    if (isAdmin) {
      await saveVolunteerNeed(record, { actor: user.email, source: "admin" });
    } else if (storedStatus === "none") {
      await holdNewRecord("volunteer-needs", record, record.title, user);
    } else if (storedStatus === "pending") {
      await updatePendingRecord("volunteer-needs", record, record.title, user);
    } else {
      await holdEditProposal("volunteer-needs", record, record.title, user);
    }
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json(
    isAdmin ? { ok: true, need: record } : { ok: true, need: record, pending: true },
  );
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const need = (await getVolunteerNeedsAdmin()).find((n) => n.id === id);
  if (!need) return NextResponse.json({ error: "shift not found" }, { status: 404 });
  if (!can(user, "edit-record", need.charityId)) {
    return NextResponse.json({ error: "not allowed to delete this shift" }, { status: 403 });
  }
  // MODERATION FLOOR (E08): member removal of a live shift holds for review;
  // withdrawing their own pending submission is immediate; admin is direct.
  try {
    if (user.role === "admin") {
      await deleteVolunteerNeed(id, { actor: user.email, source: "admin" });
    } else if (need.status === "pending") {
      await withdrawPendingRecord("volunteer-needs", id, user);
    } else {
      await requestTakedown("volunteer-needs", id, need.title, user);
      return NextResponse.json({ ok: true, pending: true });
    }
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}
