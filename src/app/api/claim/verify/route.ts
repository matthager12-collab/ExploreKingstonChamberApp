// POST /api/claim/verify — step 2 of the self-serve claim (E17 claim-signup
// slice): { signupId, code } → the mailbox is proven, the account + org are
// created, and the response signs the new owner in (same cookie mint as
// /api/auth/login). `approved: true` means the roster matched and the claim
// landed; `approved: false` means it went to the Chamber worklist and the
// account is waiting, signed in but rights-free.
//
// Guess resistance lives in the DOMAIN module (per-row attempt cap, hashed
// code, 15-minute TTL, uniform invalid-code message); the IP bucket here
// only bounds how fast one source can churn the endpoint as a whole.

import { NextRequest, NextResponse } from "next/server";
import { recordLogin, sessionCookie, tokenFor } from "@/lib/auth";
import { AuthError } from "@/lib/auth/identity";
import { verifyClaimSignup } from "@/lib/claims/self-signup";
import { OwnershipConflictError } from "@/lib/ownership";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4_096;

function tooMany(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "too many attempts, please try again later" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

export async function POST(request: NextRequest) {
  const ipLimit = await checkRateLimit(clientKey(request, "claim-verify"), {
    limit: 15,
    windowMs: 10 * 60_000,
  });
  if (!ipLimit.ok) return tooMany(ipLimit.retryAfterSeconds);

  let body: { signupId?: unknown; code?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "request too large" }, { status: 413 });
    }
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const signupId = typeof body.signupId === "string" ? body.signupId.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!signupId || !code) {
    return NextResponse.json({ error: "signupId and code required" }, { status: 400 });
  }

  try {
    const result = await verifyClaimSignup({ signupId, code });

    // The person just set their password and proved their email — make the
    // account usable immediately (stamps last_login_at, audits the sign-in).
    const signedIn = await recordLogin(result.user);
    const res = NextResponse.json({
      ok: true,
      approved: result.approved,
      pending: !result.approved,
      role: signedIn.role,
    });
    res.cookies.set(sessionCookie.name, tokenFor(signedIn), sessionCookie.options);
    return res;
  } catch (err) {
    if (err instanceof OwnershipConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
