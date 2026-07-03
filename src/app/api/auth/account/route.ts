// PUT /api/auth/account — self-service profile update (name and/or email).
//
// Session required; users can only edit themselves. updateOwnProfile keeps
// emails unique and falls back to the existing value when a field is blank.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, updateOwnProfile } from "@/lib/auth";
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
    const message = err instanceof Error ? err.message : "could not update profile";
    const status = message.includes("already uses") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
