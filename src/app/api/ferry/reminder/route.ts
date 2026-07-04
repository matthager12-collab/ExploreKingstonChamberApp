// Ferry reminder calendar feed — GET /api/ferry/reminder?dir=<>&departs=<ISO>.
//
// Returns a single-event .ics for one sailing with a VALARM 20 min before
// departure. Public (no auth): it's just a calendar event built from a
// direction + a departure instant, both re-emitted safely (see ferry-reminder).
// Tapping the link on a phone drops the event into Apple/Google Calendar.

import { buildFerryIcs, isFerryDir } from "@/lib/ferry-reminder";

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const params = new URL(request.url).searchParams;
  const dir = params.get("dir");
  const departs = params.get("departs");

  if (!isFerryDir(dir)) {
    return new Response("Bad direction", { status: 400 });
  }
  if (!departs) {
    return new Response("Missing departs", { status: 400 });
  }

  const ics = buildFerryIcs(dir, departs, new Date());
  if (ics === null) {
    return new Response("Bad departure time", { status: 400 });
  }

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8; method=PUBLISH",
      "Content-Disposition": 'attachment; filename="kingston-ferry.ics"',
      "Cache-Control": "public, max-age=300",
    },
  });
}
