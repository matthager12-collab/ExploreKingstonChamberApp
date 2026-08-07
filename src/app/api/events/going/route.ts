// "I'm going" — the public tap, and the counts the events page reads back.
//
// POST { eventId, zip? }  → increment the tally, return the event's new total.
// GET  ?ids=a,b,c         → totals for those events (the ISR page fetches
//                           these client-side; a cached page cannot hold a
//                           live number).
//
// WHAT THIS ROUTE DELIBERATELY DOES NOT DO: read a coordinate, set a cookie,
// read a session, or store anything about the person tapping. The ZIP is
// whatever they chose to type, the count is a number, and that is the entire
// payload. Repeat taps are suppressed on the device, because catching them
// here would require an identifier — see src/lib/stores/event-going-store.ts.
//
// No auth: this is a public affordance on a public page, like the survey.

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import {
  getGoingCounts,
  normalizeZip,
  recordGoing,
} from "@/lib/stores/event-going-store";

export const dynamic = "force-dynamic";

/** Bound on ids per GET — the events page asks about one screenful. */
const MAX_IDS = 200;

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("ids") ?? "";
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);
  if (ids.length === 0) return NextResponse.json({ counts: {} });
  return NextResponse.json({ counts: await getGoingCounts(ids) });
}

export async function POST(request: NextRequest) {
  // Rate limit on the same coarse key the other public intakes use. It bounds
  // scripted inflation; it is not a uniqueness guarantee, and the count is
  // published as an interest signal rather than an attendance figure.
  const limited = await checkRateLimit(clientKey(request, "going"));
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many taps just now — try again in a moment." },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const eventId = typeof body.eventId === "string" ? body.eventId.trim().slice(0, 200) : "";
  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  // An unparseable ZIP becomes "" rather than a 400: the field is optional, and
  // refusing the whole tap over a typo would lose the attendance signal to
  // protect a number nobody had to give in the first place.
  const zip = normalizeZip(body.zip);

  return NextResponse.json({ ok: true, count: await recordGoing(eventId, zip) });
}
