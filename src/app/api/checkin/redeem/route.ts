// GET /api/checkin/redeem?token=… — a volunteer opens the race-day link.
// The token is verified (signature, expiry) and checked against the current
// link version, then stored in an HttpOnly cookie and the browser is sent to
// /checkin with the token stripped from the URL. A bad or stale link lands on
// /checkin?error=link, which explains itself. Public, so rate-limited per IP.

import { NextRequest, NextResponse } from "next/server";

import { readCheckinAccess } from "@/lib/race/checkin-access";
import { CHECKIN_COOKIE, checkinCookieOptions } from "@/lib/race/checkin-token";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limited = await checkRateLimit(clientKey(request, "race-redeem"), { limit: 20, windowMs: 60_000 });
  if (!limited.ok) {
    return new NextResponse("Too many attempts. Wait a minute and open the link again.", {
      status: 429,
      headers: { "Retry-After": String(limited.retryAfterSeconds) },
    });
  }

  const token = request.nextUrl.searchParams.get("token") ?? "";
  const dest = new URL("/checkin", request.nextUrl.origin);
  const claims = await readCheckinAccess(token);
  if (!claims) {
    dest.searchParams.set("error", "link");
    return NextResponse.redirect(dest, 303);
  }

  const res = NextResponse.redirect(dest, 303);
  res.cookies.set(CHECKIN_COOKIE, token, checkinCookieOptions(claims.exp));
  return res;
}
