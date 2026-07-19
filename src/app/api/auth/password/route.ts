// POST /api/auth/password — self-service password change.
//
// Passwords are one-way scrypt hashes: nobody (Chamber admins included) can
// view them, so the only honest operations are "prove you know the current
// password and set a new one" (this endpoint) and an admin reset. Both the
// client IP and the user id are rate-limited so a hijacked session can't be
// used to grind the current-password check.

import { NextRequest, NextResponse } from "next/server";
import { changeOwnPassword, getSessionUser, sessionCookie, tokenFor } from "@/lib/auth";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";

function tooMany(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "too many attempts, please try again later" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ipLimit = await checkRateLimit(clientKey(request, "pwchange"), { limit: 5 });
  if (!ipLimit.ok) return tooMany(ipLimit.retryAfterSeconds);
  const userLimit = await checkRateLimit("pwchange:" + user.id, { limit: 5 });
  if (!userLimit.ok) return tooMany(userLimit.retryAfterSeconds);

  let body: { current?: unknown; next?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (typeof body.current !== "string" || typeof body.next !== "string") {
    return NextResponse.json(
      { error: "current and new password required" },
      { status: 400 },
    );
  }

  let updated;
  try {
    updated = await changeOwnPassword(user.id, body.current, body.next);
  } catch (err) {
    const message = err instanceof Error ? err.message : "could not change password";
    const status = message === "Current password is incorrect" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }

  // changeOwnPassword bumped session_version, which just invalidated EVERY
  // outstanding token for this user — including the cookie this request
  // arrived with. Re-issue one at the new version or the user silently logs
  // themselves out by changing their own password. Every OTHER session (a
  // second browser, or an attacker's stolen cookie) stays dead, which is the
  // entire point of the bump.
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie.name, tokenFor(updated), sessionCookie.options);
  return res;
}
