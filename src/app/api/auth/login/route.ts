import { NextRequest, NextResponse } from "next/server";
import { recordLogin, sessionCookie, tokenFor, verifyCredentials } from "@/lib/auth";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";

function tooMany(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "too many attempts, please try again later" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

export async function POST(request: NextRequest) {
  // Rate-limit by client IP so no single source can brute-force scrypt hashes.
  const ipLimit = await checkRateLimit(clientKey(request, "login"));
  if (!ipLimit.ok) return tooMany(ipLimit.retryAfterSeconds);

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (!body.email || !body.password) {
    return NextResponse.json({ error: "email and password required" }, { status: 400 });
  }

  // Also rate-limit per submitted account so a single targeted email can't be
  // ground down from many IPs. Normalize to match findUserByEmail's lookup.
  const emailLimit = await checkRateLimit("login:" + body.email.trim().toLowerCase());
  if (!emailLimit.ok) return tooMany(emailLimit.retryAfterSeconds);

  // verifyCredentials returns null for an unknown email, a wrong password, AND
  // a disabled account — all three collapse into the one uniform 401 below, so
  // the endpoint never reveals that an address exists or has been switched off.
  const user = await verifyCredentials(body.email, body.password);
  if (!user) {
    return NextResponse.json({ error: "wrong email or password" }, { status: 401 });
  }

  // Stamps last_login_at (FR-A09's account list) and audits the sign-in.
  const signedIn = await recordLogin(user);

  const res = NextResponse.json({ ok: true, role: signedIn.role });
  // Minted at the user's CURRENT session_version: any token issued before a
  // revocation is already dead.
  res.cookies.set(sessionCookie.name, tokenFor(signedIn), sessionCookie.options);
  return res;
}
