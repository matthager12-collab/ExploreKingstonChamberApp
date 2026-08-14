// One-time bootstrap: creates the FIRST account (admin) when none exist.
// Locked forever after — later accounts come from admin-minted invites.

import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createFirstAdmin, hasAnyUsers, sessionCookie, tokenFor } from "@/lib/auth";
import { landingFor } from "@/lib/auth/landing";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";

/** Constant-time string compare (rejects unequal lengths without comparing). */
function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export async function POST(request: NextRequest) {
  // Low limit: this endpoint is only ever hit a handful of times, once, during
  // first-run bootstrap. Cap it hard before touching the user store.
  const limit = await checkRateLimit(clientKey(request, "setup"), { limit: 5 });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too many attempts, please try again later" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  // Production is safe today (an admin already exists), but on a fresh
  // deploy of this public codebase, ANY visitor who finds this URL first
  // owns the site unless an operator-set token gates it. Checked after
  // hasAnyUsers() so already-bootstrapped deploys need no new env var.
  if (await hasAnyUsers()) {
    return NextResponse.json({ error: "setup already completed" }, { status: 403 });
  }

  let body: { email?: string; name?: string; password?: string; setupToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const expected = process.env.SETUP_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "setup is disabled — the operator must set SETUP_TOKEN" },
      { status: 403 },
    );
  }
  if (typeof body.setupToken !== "string" || !timingSafeEqualStr(body.setupToken, expected)) {
    return NextResponse.json({ error: "invalid setup token" }, { status: 403 });
  }
  if (!body.email || !body.name || !body.password || body.password.length < 8) {
    return NextResponse.json(
      { error: "email, name, and a password of 8+ characters required" },
      { status: 400 },
    );
  }
  // createFirstAdmin re-checks hasAnyUsers() inside, so the bootstrap cannot
  // be won twice by two concurrent requests slipping past the check above.
  const user = await createFirstAdmin({
    email: body.email,
    name: body.name,
    password: body.password,
  });
  // createFirstAdmin only ever mints an admin, so this is always the console —
  // but it goes through landingFor() with the returned role like the other two
  // routes, so there is ONE table to change and no hard-coded "/admin" to miss.
  const res = NextResponse.json({ ok: true, redirectTo: landingFor(user.role) });
  res.cookies.set(sessionCookie.name, tokenFor(user), sessionCookie.options);
  return res;
}
