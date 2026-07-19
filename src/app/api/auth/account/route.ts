// PUT /api/auth/account — self-service profile update (name and/or email).
//
// Session required; users can only edit themselves. updateOwnProfile keeps
// emails unique and falls back to the existing value when a field is blank.

import { NextRequest, NextResponse } from "next/server";
import { AuthError, getSessionUser, updateOwnProfile } from "@/lib/auth";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";

export async function PUT(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  // Light limit — profile edits are low-risk, but shouldn't be spammable.
  const limit = await checkRateLimit(clientKey(request, "profile"), { limit: 10 });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too many attempts, please try again later" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: { name?: unknown; email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name : undefined;
  const email = typeof body.email === "string" ? body.email : undefined;
  if (email?.trim() && !email.includes("@")) {
    return NextResponse.json({ error: "enter a valid email address" }, { status: 400 });
  }

  try {
    const updated = await updateOwnProfile(user.id, { name, email });
    return NextResponse.json({ ok: true, name: updated.name, email: updated.email });
  } catch (err) {
    if (err instanceof AuthError) {
      // 409 specifically for the email clash — the client distinguishes it.
      const status = err.message.includes("already uses") ? 409 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    // A raw DB error here would be the unique index firing on a race the
    // pre-check missed; report it as the same conflict rather than a 500.
    console.error("profile update failed", err);
    return NextResponse.json({ error: "could not update profile" }, { status: 409 });
  }
}
