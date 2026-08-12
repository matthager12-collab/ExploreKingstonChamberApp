// POST /api/claim/signup — step 1 of the self-serve claim (E17 claim-signup
// slice): validate the listing, hold the signup, email the code. Or, for a
// caller who is already signed in, decide the claim right away (their session
// already proved the mailbox — no code round-trip).
//
// Anonymous body:  { store, id, name, email, password }
// Signed-in body:  { store, id }
//
// ORACLE POSTURE: the response NEVER says whether the email is on the
// Chamber roster — start does not even look. Roster membership is only ever
// revealed by /api/claim/verify, to a caller who has just proven control of
// the mailbox. Existence checks answer through the same store views as the
// domain module (directory drafts are deliberately claimable; everything
// else live-only).
//
// Rate limiting mirrors /api/claim: an IP bucket before the body is read,
// then a per-(store,id) bucket so churn on one listing is bounded. Body is
// capped BEFORE JSON.parse, the house pattern for public intakes.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { AuthError } from "@/lib/auth/identity";
import {
  claimAsSignedIn,
  ClaimSubjectNotFoundError,
  CodeEmailUnavailableError,
  startClaimSignup,
} from "@/lib/claims/self-signup";
import { OwnershipConflictError } from "@/lib/ownership";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8_192;

/** Per-(store,id) churn bound — same numbers and reasoning as /api/claim's
 *  RECORD_BUCKET: tight enough to bound junk, loose enough that a stranger
 *  cannot lock the genuine owner out of the form. */
const RECORD_BUCKET = { limit: 60, windowMs: 10 * 60_000 } as const;

function tooMany(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "too many requests, please try again later" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

export async function POST(request: NextRequest) {
  const ipLimit = await checkRateLimit(clientKey(request, "claim-signup"), {
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (!ipLimit.ok) return tooMany(ipLimit.retryAfterSeconds);

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "request too large" }, { status: 413 });
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const store = typeof body.store === "string" ? body.store : "";
  const id = str(body.id);

  const recordLimit = await checkRateLimit(`claim-signup:${store}:${id}`, RECORD_BUCKET);
  if (!recordLimit.ok) return tooMany(recordLimit.retryAfterSeconds);

  try {
    const sessionUser = await getSessionUser();
    if (sessionUser) {
      const result = await claimAsSignedIn(sessionUser, { store, id });
      return NextResponse.json({
        ok: true,
        mode: "signed-in",
        approved: result.approved,
        pending: !result.approved,
      });
    }

    const result = await startClaimSignup({
      store,
      id,
      name: str(body.name),
      email: str(body.email),
      // Deliberately NOT trimmed: a password is whatever the person typed,
      // and login will compare the same raw string.
      password: typeof body.password === "string" ? body.password : "",
    });
    return NextResponse.json({
      ok: true,
      mode: "code-sent",
      signupId: result.signupId,
      emailSent: result.emailSent,
    });
  } catch (err) {
    if (err instanceof ClaimSubjectNotFoundError) {
      return NextResponse.json({ error: "record not found" }, { status: 404 });
    }
    if (err instanceof OwnershipConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof CodeEmailUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
