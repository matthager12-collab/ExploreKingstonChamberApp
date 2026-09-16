import { NextRequest, NextResponse } from "next/server";
import { redeemInvite, sessionCookie, tokenFor } from "@/lib/auth";
import { landingFor } from "@/lib/auth/landing";
import { OwnershipConflictError } from "@/lib/ownership";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";

function tooMany(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "too many attempts, please try again later" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

export async function POST(request: NextRequest) {
  // Rate-limit by client IP so invite codes can't be enumerated from one source.
  const ipLimit = await checkRateLimit(clientKey(request, "redeem"));
  if (!ipLimit.ok) return tooMany(ipLimit.retryAfterSeconds);

  let body: { code?: string; email?: string; name?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (!body.code || !body.email || !body.name || !body.password || body.password.length < 8) {
    return NextResponse.json(
      { error: "invite code, email, name, and a password of 8+ characters required" },
      { status: 400 },
    );
  }

  // Also limit per submitted code so a specific code can't be guessed across
  // many IPs. Match redeemInvite's lookup, which trims the code.
  const codeLimit = await checkRateLimit("redeem:" + body.code.trim());
  if (!codeLimit.ok) return tooMany(codeLimit.retryAfterSeconds);
  try {
    // Creates the org (or joins an existing one) and the user atomically;
    // expired / revoked / used / email-mismatch all reject inside.
    const { user } = await redeemInvite(body.code.trim(), {
      email: body.email,
      name: body.name,
      password: body.password,
    });
    // Same role-based landing as login: an admin invite drops the new account
    // straight into the console. Most invites mint org roles, which fall
    // through to the portal — see src/lib/auth/landing.ts.
    const res = NextResponse.json({
      ok: true,
      role: user.role,
      redirectTo: landingFor(user.role),
    });
    res.cookies.set(sessionCookie.name, tokenFor(user), sessionCookie.options);
    return res;
  } catch (e) {
    if (e instanceof OwnershipConflictError) {
      // E17: the linked listing was claimed between mint and redeem.
      // redeemInvite only throws this from its PRE-CHECK, which runs before
      // redeemInviteTx opens — so today no user, no org, and (by falling
      // through here without touching cookies) no session. That guarantee is
      // the pre-check's ORDERING, not this branch's: if a future change ever
      // raises OwnershipConflictError from inside or after the transaction,
      // the account may already exist and this response would be a lie.
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "could not redeem invite" },
      { status: 400 },
    );
  }
}
