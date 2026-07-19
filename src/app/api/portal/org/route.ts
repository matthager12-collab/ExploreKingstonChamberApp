// Nonprofit portal API: org profile updates plus a small event branch.
//
// PUT  — update a charity's profile (whitelisted fields, can(…, "edit-record")-gated).
// POST — { action: "saveEvent" } / { action: "deleteEvent" }: nonprofit
//        events go through here (not /api/portal/events, which belongs to
//        the business portal) so the two portals never collide on a file.
//
// Every write validates the session server-side and never trusts a
// client-sent id without can(…, "edit-record").

import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { can, getSessionUser } from "@/lib/auth";
import { getCharity, saveCharity } from "@/lib/stores/charity-store";
import {
  holdEditProposal,
  holdNewRecord,
  requestTakedown,
  updatePendingRecord,
  withdrawPendingRecord,
} from "@/lib/moderation";
import { RecordValidationError } from "@/lib/db/store-schemas";
import { deleteEvent, getEventAdmin, saveEvent } from "@/lib/stores/event-store";
import { pacificWallTimeToISO } from "@/lib/time";
import type { Charity, EventCategory, EventItem } from "@/lib/types";

const CATEGORIES: EventCategory[] = [
  "festival",
  "market",
  "music",
  "community",
  "charity",
  "sports",
  "arts",
];

/** Trimmed non-empty string, else undefined. */
function cleanStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function slugId(title: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "event";
  return `${slug}-${randomBytes(3).toString("hex")}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export async function PUT(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!can(user, "edit-record", id)) {
    return NextResponse.json({ error: "not allowed to edit this organization" }, { status: 403 });
  }

  const existing = await getCharity(id);
  if (!existing) return NextResponse.json({ error: "organization not found" }, { status: 404 });

  // Whitelist: only these four fields are portal-editable; id is pinned.
  const updated: Charity = {
    ...existing,
    id: existing.id,
    name: cleanStr(body.name) ?? existing.name,
    mission: typeof body.mission === "string" ? body.mission.trim() : existing.mission,
    website:
      typeof body.website === "string" ? body.website.trim() || undefined : existing.website,
    contactEmail:
      typeof body.contactEmail === "string"
        ? body.contactEmail.trim() || undefined
        : existing.contactEmail,
  };
  // MODERATION FLOOR (E08): the live profile keeps serving — a member's
  // proposed revision waits in the worklist; admin edits publish directly.
  try {
    if (user.role === "admin") {
      await saveCharity(updated, { actor: user.email, source: "admin" });
    } else {
      await holdEditProposal("charities", updated, updated.name, user);
    }
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json(
    user.role === "admin" ? { ok: true, org: updated } : { ok: true, org: updated, pending: true },
  );
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

  if (body.action === "saveEvent") {
    const orgId = typeof body.orgId === "string" ? body.orgId : "";
    if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });
    if (!can(user, "edit-record", orgId)) {
      return NextResponse.json(
        { error: "not allowed to post events for this organization" },
        { status: 403 },
      );
    }
    const org = await getCharity(orgId);
    if (!org) return NextResponse.json({ error: "organization not found" }, { status: 404 });

    const ev = (typeof body.event === "object" && body.event !== null ? body.event : {}) as Record<
      string,
      unknown
    >;
    const title = cleanStr(ev.title);
    const venue = cleanStr(ev.venue);
    const date = typeof ev.date === "string" && DATE_RE.test(ev.date) ? ev.date : "";
    const startTime =
      typeof ev.startTime === "string" && TIME_RE.test(ev.startTime) ? ev.startTime : "";
    const endTime = typeof ev.endTime === "string" && TIME_RE.test(ev.endTime) ? ev.endTime : "";
    if (!title || !date || !startTime || !venue) {
      return NextResponse.json(
        { error: "title, date, start time, and venue are required" },
        { status: 400 },
      );
    }

    // Existing id? Verify the caller actually owns that event before
    // overwriting — a client-sent id is never trusted on its own. Any-status
    // lookup (E08) so an org can still fix its own pending submission.
    let id: string;
    let storedStatus: "live" | "pending" | "other" | "none" = "none";
    if (typeof ev.id === "string" && ev.id) {
      const current = await getEventAdmin(ev.id);
      if (!current) return NextResponse.json({ error: "event not found" }, { status: 404 });
      if (!can(user, "edit-record", current.ownerId ?? current.charityId ?? "")) {
        return NextResponse.json({ error: "not allowed to edit this event" }, { status: 403 });
      }
      id = current.id;
      storedStatus =
        current.status === "live" ? "live" : current.status === "pending" ? "pending" : "other";
    } else {
      id = slugId(title);
    }

    const category = CATEGORIES.includes(ev.category as EventCategory)
      ? (ev.category as EventCategory)
      : "charity";

    const record: EventItem = {
      id,
      title,
      start: pacificWallTimeToISO(date, startTime),
      end: endTime ? pacificWallTimeToISO(date, endTime) : undefined,
      venue,
      address: cleanStr(ev.address),
      description: typeof ev.description === "string" ? ev.description.trim() : "",
      category,
      organizer: cleanStr(ev.organizer) ?? org.name,
      url: cleanStr(ev.url),
      charityId: orgId,
      ownerId: orgId,
    };
    // MODERATION FLOOR (E08): member writes hold for Chamber review; admin
    // writes publish directly (see src/lib/moderation.ts).
    const isAdmin = user.role === "admin";
    try {
      if (isAdmin) {
        await saveEvent(record, { actor: user.email, source: "admin" });
      } else if (storedStatus === "none") {
        await holdNewRecord("events", record, record.title, user);
      } else if (storedStatus === "pending") {
        await updatePendingRecord("events", record, record.title, user);
      } else {
        await holdEditProposal("events", record, record.title, user);
      }
    } catch (err) {
      if (err instanceof RecordValidationError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
    return NextResponse.json(
      isAdmin ? { ok: true, event: record } : { ok: true, event: record, pending: true },
    );
  }

  if (body.action === "deleteEvent") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const current = await getEventAdmin(id);
    if (!current) return NextResponse.json({ error: "event not found" }, { status: 404 });
    if (!can(user, "edit-record", current.ownerId ?? current.charityId ?? "")) {
      return NextResponse.json({ error: "not allowed to delete this event" }, { status: 403 });
    }
    // MODERATION FLOOR (E08): member removal of a live event holds for
    // review; withdrawing their own pending submission is immediate.
    try {
      if (user.role === "admin") {
        await deleteEvent(id, { actor: user.email, source: "admin" });
      } else if (current.status === "pending") {
        await withdrawPendingRecord("events", id, user);
      } else {
        await requestTakedown("events", id, current.title, user);
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

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
