// POST /api/auth/logout — clear the session cookie.
//
// Clearing the cookie is the whole logout: sessions are stateless, so there is
// nothing server-side to destroy. (To kill sessions the user does NOT control
// — a stolen cookie — an admin bumps session_version via disable or reset.)

import { NextResponse } from "next/server";
import { getSessionUser, recordLogout, sessionCookie } from "@/lib/auth";

export async function POST() {
  // Read the session BEFORE clearing so the audit entry has an actor. An
  // already-signed-out caller is a no-op, not an error.
  const user = await getSessionUser();
  if (user) await recordLogout(user);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie.name, "", { ...sessionCookie.options, maxAge: 0 });
  return res;
}
