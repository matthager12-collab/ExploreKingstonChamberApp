// Admin-only user listing + password reset. Password hashes never leave the
// server.

import { NextRequest, NextResponse } from "next/server";
import { adminResetPassword, getSessionUser, listUsers } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "admin only" }, { status: 403 });

  const users = (await listUsers()).map(({ passwordHash: _passwordHash, ...safe }) => safe);
  return NextResponse.json({ users });
}

// POST { action: "reset-password", userId } — admin only.
//
// Generates a fresh temporary password and returns it in this response ONCE.
// Only the scrypt hash is persisted; the plaintext is never stored anywhere,
// so if the admin loses it before handing it over, the only recourse is
// another reset. (Viewing an existing password is impossible by design —
// hashes are one-way.)
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "admin only" }, { status: 403 });

  let body: { action?: unknown; userId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (body.action !== "reset-password" || typeof body.userId !== "string" || !body.userId) {
    return NextResponse.json({ error: "unsupported action" }, { status: 400 });
  }

  try {
    const tempPassword = await adminResetPassword(body.userId);
    return NextResponse.json({ ok: true, tempPassword });
  } catch (err) {
    const message = err instanceof Error ? err.message : "could not reset password";
    const status = message === "User not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
