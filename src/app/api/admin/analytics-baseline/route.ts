// Admin API for the analytics BASELINE — backs the "start counting from here"
// control on /admin.
//
// GET  — admin: { baseline } (the current watermark, or null if never set).
// POST — admin: sets it. Body shapes, and the absent/null distinction matters:
//          {}                        -> baseline = now (the reset button)
//          { since: null }           -> cleared; count the whole log again
//          { since: "<iso>" }        -> an explicit instant (backdating)
//        `note` is optional free text carried alongside ("soft launch").
//        Returns the refreshed state.
//
// 401 signed out · 403 signed in but not admin. The /admin layout gates the UI;
// this handler re-checks because API routes bypass layouts.
//
// This endpoint moves a watermark and destroys nothing — clearing it restores
// every number it was hiding. The destructive counterpart deliberately has no
// route: purging raw events is scripts/purge-analytics.mjs, run by a human with
// the database URL in front of them.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import {
  getAnalyticsBaseline,
  setAnalyticsBaseline,
} from "@/lib/stores/analytics-baseline-store";
import { RecordValidationError } from "@/lib/db/store-schemas";

export const dynamic = "force-dynamic";

const MAX_NOTE = 120;

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return NextResponse.json({ baseline: await getAnalyticsBaseline() });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  // The gate proved a session exists — this only re-reads it to attribute the change.
  const user = (await getSessionUser())!;

  let body: { since?: unknown; note?: unknown };
  try {
    body = (await request.json()) as { since?: unknown; note?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Absent means "now" (the common case: an admin pressing reset). Explicit
  // null means "clear it". They are different requests and JSON can express
  // both, so they are read apart rather than collapsed with ?? — collapsing
  // them would make the reset button and the clear button do the same thing.
  let since: string | null;
  if (!("since" in body) || body.since === undefined) {
    since = new Date().toISOString();
  } else if (body.since === null) {
    since = null;
  } else if (typeof body.since === "string") {
    since = body.since;
  } else {
    return NextResponse.json(
      { error: "since must be an ISO timestamp string, null, or omitted" },
      { status: 400 },
    );
  }

  if (body.note !== undefined && typeof body.note !== "string") {
    return NextResponse.json({ error: "note must be a string" }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note.slice(0, MAX_NOTE) : undefined;

  try {
    await setAnalyticsBaseline(since, user.name || user.email || "admin", note, {
      actor: user.email,
      source: "admin",
    });
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    // setAnalyticsBaseline rejects an unparseable timestamp — a 400, not a 500:
    // the caller sent a bad value, the server is fine.
    if (err instanceof Error && err.message.startsWith("Invalid baseline timestamp")) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true, baseline: await getAnalyticsBaseline() });
}
