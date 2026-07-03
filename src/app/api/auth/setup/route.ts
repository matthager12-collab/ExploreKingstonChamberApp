// One-time bootstrap: creates the FIRST account (admin) when none exist.
// Locked forever after — later accounts come from admin-minted invites.

import { NextRequest, NextResponse } from "next/server";
import { createUser, hasAnyUsers, makeSessionToken, sessionCookie } from "@/lib/auth";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  // Low limit: this endpoint is only ever hit a handful of times, once, during
  // first-run bootstrap. Cap it hard before touching the user store.
  const limit = checkRateLimit(clientKey(request, "setup"), { limit: 5 });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too many attempts, please try again later" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  if (await hasAnyUsers()) {
    return NextResponse.json({ error: "setup already completed" }, { status: 403 });
  }
  let body: { email?: string; name?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (!body.email || !body.name || !body.password || body.password.length < 8) {
    return NextResponse.json(
      { error: "email, name, and a password of 8+ characters required" },
      { status: 400 },
    );
  }
  const user = await createUser({
    email: body.email,
    name: body.name,
    role: "admin",
    linkedIds: [],
    password: body.password,
  });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie.name, makeSessionToken(user.id), sessionCookie.options);
  return res;
}
