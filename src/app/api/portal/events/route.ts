// Portal events API.
//
// GET  ?onDate=YYYY-MM-DD[&exclude=id] — public: other events on that Pacific
//      calendar date (the "what else happens that day" deconfliction check).
// GET  ?ownerId=X                      — auth + can(…, "edit-record"): the events X manages,
//      including X's own pending submissions (status surfaced).
// POST                                 — auth: create/update an event whose
//      ownerId ∈ user.linkedIds (or admin). New events get a slug+random id.
//      MODERATION (E08): member writes hold for Chamber review — see
//      src/lib/moderation.ts; admin writes publish directly.
// DELETE ?id=X                         — auth: load the event, check can(…, "edit-record")
//      against its stored ownerId. Admin → tombstone now; member → takedown
//      request (live) or immediate withdrawal (their own pending record).

import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { can, getSessionUser } from "@/lib/auth";
import {
  deleteEvent,
  eventsSharingDate,
  getEventAdmin,
  getEventsForOwner,
  saveEvent,
} from "@/lib/stores/event-store";
import {
  holdEditProposal,
  holdNewRecord,
  requestTakedown,
  updatePendingRecord,
  withdrawPendingRecord,
} from "@/lib/moderation";
import { RecordValidationError } from "@/lib/db/store-schemas";
import { normalizeEventTimestamp } from "@/lib/time";
import type { EventCategory, EventItem } from "@/lib/types";

const CATEGORIES: EventCategory[] = [
  "festival",
  "market",
  "music",
  "community",
  "charity",
  "sports",
  "arts",
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // Public calendar lookup — no auth: this is the same data the events page shows.
  const onDate = params.get("onDate");
  if (onDate) {
    if (!DATE_RE.test(onDate)) {
      return NextResponse.json({ error: "onDate must be YYYY-MM-DD" }, { status: 400 });
    }
    const events = await eventsSharingDate(onDate, params.get("exclude") ?? undefined);
    return NextResponse.json({ events });
  }

  const ownerId = params.get("ownerId");
  if (ownerId) {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
    if (!can(user, "edit-record", ownerId)) {
      return NextResponse.json({ error: "You don't manage that listing" }, { status: 403 });
    }
    // Owner-scoped read (E08): includes the owner's own pending submissions,
    // each carrying `status` so the portal can badge "awaiting review".
    const events = await getEventsForOwner(ownerId);
    return NextResponse.json({ events });
  }

  return NextResponse.json({ error: "onDate or ownerId required" }, { status: 400 });
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "event"
  );
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const ownerId = typeof body.ownerId === "string" ? body.ownerId : "";
  if (!ownerId) return NextResponse.json({ error: "ownerId required" }, { status: 400 });
  if (!can(user, "edit-record", ownerId)) {
    return NextResponse.json({ error: "You don't manage that listing" }, { status: 403 });
  }

  const title = (typeof body.title === "string" ? body.title.trim() : "").slice(0, 200);
  const start = typeof body.start === "string" ? body.start.trim() : "";
  const category = body.category as EventCategory;
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  if (!DATETIME_RE.test(start)) {
    return NextResponse.json({ error: "start must be an ISO date-time" }, { status: 400 });
  }
  if (!CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "unknown category" }, { status: 400 });
  }
  // Normalize AFTER validation: DATETIME_RE only requires the naive prefix
  // the business editor submits; this attaches a real Pacific UTC offset so
  // downstream consumers (the ICS/JSON feed) don't parse it in server-local
  // time. The naive wall-time prefix is preserved, so the editor's
  // start.slice(0, 16) round-trip into its datetime-local input still works.
  const normalizedStart = normalizeEventTimestamp(start);

  const end =
    typeof body.end === "string" && DATETIME_RE.test(body.end.trim())
      ? normalizeEventTimestamp(body.end.trim())
      : undefined;
  const organizer = (
    typeof body.organizer === "string" && body.organizer.trim() ? body.organizer.trim() : user.name
  ).slice(0, 200);
  const venue = (
    typeof body.venue === "string" && body.venue.trim() ? body.venue.trim() : organizer
  ).slice(0, 200);
  const description = (typeof body.description === "string" ? body.description.trim() : "").slice(
    0,
    2000,
  );
  // Dropped, not 400'd, when absent or unsafe (matching the field-drop
  // convention used elsewhere in this route) — a bare scheme check here is
  // belt-and-suspenders for public/embed/kingston-events.js, which guards its
  // own a.href assignment independently.
  const url =
    typeof body.url === "string" && /^https?:\/\//i.test(body.url.trim()) && body.url.trim().length <= 500
      ? body.url.trim()
      : undefined;

  let event: EventItem;
  let storedStatus: "live" | "pending" | "other" | "none" = "none";
  if (typeof body.id === "string" && body.id) {
    // Update: the STORED event's owner decides who may touch it — never trust
    // the client-sent id alone. Any-status lookup so a member can still fix
    // their own pending (not-yet-public) submission.
    const existing = await getEventAdmin(body.id);
    if (!existing) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    if (!can(user, "edit-record", existing.ownerId ?? "")) {
      return NextResponse.json({ error: "You don't manage that event" }, { status: 403 });
    }
    storedStatus =
      existing.status === "live" ? "live" : existing.status === "pending" ? "pending" : "other";
    // `status` is record metadata, not part of the event doc — strip it
    // before building the proposal so it never lands inside the stored doc.
    const { status: _status, ...existingDoc } = existing;
    event = {
      ...existingDoc,
      title,
      start: normalizedStart,
      end,
      venue,
      description,
      category,
      organizer,
      url,
      ownerId,
    };
  } else {
    event = {
      id: `${slugify(title)}-${randomBytes(3).toString("hex")}`,
      title,
      start: normalizedStart,
      end,
      venue,
      description,
      category,
      organizer,
      url,
      ownerId,
    };
  }

  // MODERATION FLOOR (E08): admin saves publish directly; member writes hold
  // for Chamber review — new records land as 'pending' (publicly invisible),
  // edits of live records ride the worklist payload so the live record is
  // never touched, and edits of their own pending records update in place.
  const isAdmin = user.role === "admin";
  try {
    if (isAdmin) {
      await saveEvent(event, { actor: user.email, source: "admin" });
    } else if (storedStatus === "none") {
      await holdNewRecord("events", event, event.title, user);
    } else if (storedStatus === "pending") {
      await updatePendingRecord("events", event, event.title, user);
    } else {
      // Live (or seed/hidden) record: propose, never mutate.
      await holdEditProposal("events", event, event.title, user);
    }
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json(isAdmin ? { ok: true, event } : { ok: true, event, pending: true });
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await getEventAdmin(id);
  if (!existing) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (!can(user, "edit-record", existing.ownerId ?? "")) {
    return NextResponse.json({ error: "You don't manage that event" }, { status: 403 });
  }

  // MODERATION FLOOR (E08): removing a live record changes public content,
  // so member deletes hold for review; withdrawing their own pending
  // submission is immediate (it was never public). Admin deletes are direct.
  try {
    if (user.role === "admin") {
      await deleteEvent(id, { actor: user.email, source: "admin" });
    } else if (existing.status === "pending") {
      await withdrawPendingRecord("events", id, user);
    } else {
      await requestTakedown("events", id, existing.title, user);
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
