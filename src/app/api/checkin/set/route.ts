// POST /api/checkin/set { id, checkedIn } — a volunteer taps a runner in
// (or undoes it). Gated by the race-day link cookie, re-validated against the
// current link version on every call. Set-state, not toggle, so a double tap
// or a retried request is harmless. SameSite=Lax on the cookie means a
// cross-site POST never carries it (CSRF).
//
// Rate limit is keyed on the LINK VERSION, not the client IP: every volunteer
// phone at the venue shares one Wi-Fi address, and a busy pickup table is
// exactly when this must keep working.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { setCheckedIn } from "@/lib/db/race-registrants";
import { readCheckinAccess } from "@/lib/race/checkin-access";
import { CHECKIN_COOKIE } from "@/lib/race/checkin-token";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ id: z.string().uuid(), checkedIn: z.boolean() }).strict();

export async function POST(request: NextRequest) {
  const claims = await readCheckinAccess(request.cookies.get(CHECKIN_COOKIE)?.value);
  if (!claims) {
    return NextResponse.json({ error: "This race-day link is no longer valid." }, { status: 401 });
  }

  const limited = await checkRateLimit(`race-checkin:${claims.raceId}:${claims.v}`, {
    limit: 600,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Slow down a moment." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const result = await setCheckedIn(body.id, body.checkedIn, "volunteer-link");
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason === "not-found" ? "No such runner." : "That registration was cancelled." },
      { status: result.reason === "not-found" ? 404 : 409 },
    );
  }
  return NextResponse.json({ changed: result.changed });
}
