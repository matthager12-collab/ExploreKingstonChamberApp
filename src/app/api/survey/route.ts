import { NextRequest } from "next/server";
import { claimIdempotencyKey, releaseIdempotencyKey } from "@/lib/db/idempotency";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { surveyStore } from "@/lib/survey-store";
import type { SurveyResponse } from "@/lib/types";

const DISTANCE_BANDS = ["local", "10-50mi", "50mi-plus", "out-of-state", "international"];

// E11 (precondition-2 gap closed): cap the raw body before parsing — field
// truncation below only bounds what we keep, not what we buffer.
const MAX_BODY_BYTES = 8_192;

export async function POST(request: NextRequest) {
  const limit = await checkRateLimit(clientKey(request, "survey"), {
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too many submissions, please try again later" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: Partial<SurveyResponse>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return Response.json({ error: "body too large" }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!body.distanceBand || !DISTANCE_BANDS.includes(body.distanceBand)) {
    return Response.json({ error: "distanceBand required" }, { status: 400 });
  }

  // E13 idempotent intake for the offline outbox. Placement is load-bearing:
  // AFTER validation (a claim taken on a body we then reject would burn the
  // key — the outbox deletes its copy on a 400, so the answer is gone and the
  // replay can never land) and BEFORE the save. No header = today's behavior,
  // byte for byte: the /embed widget and clients running an old cached bundle
  // never send one and must keep working.
  const idempotencyKey = request.headers.get("X-Idempotency-Key");
  if (idempotencyKey) {
    const claim = await claimIdempotencyKey(idempotencyKey, "survey");
    if (claim === "invalid") {
      return Response.json({ error: "invalid idempotency key" }, { status: 400 });
    }
    if (claim === "duplicate") {
      // A replay of a submission we already stored. Success, without a second
      // row — that is the whole point of letting the outbox retry blindly.
      return Response.json({ ok: true, duplicate: true });
    }
  }

  // E11: the dead zip/state fields are gone — the survey UI never asked for
  // them (audit-confirmed dead PII surface); the route no longer accepts them.
  const response: SurveyResponse = {
    submittedAt: new Date().toISOString(),
    distanceBand: body.distanceBand,
    overnight: Boolean(body.overnight),
    lodgingNights:
      typeof body.lodgingNights === "number" && body.lodgingNights >= 0
        ? Math.min(body.lodgingNights, 60)
        : undefined,
    lodgingType: typeof body.lodgingType === "string" ? body.lodgingType.slice(0, 40) : undefined,
    partySize:
      typeof body.partySize === "number" && body.partySize > 0
        ? Math.min(body.partySize, 50)
        : undefined,
    primaryReason:
      typeof body.primaryReason === "string" ? body.primaryReason.slice(0, 60) : undefined,
  };

  try {
    await surveyStore.save(response);
  } catch {
    // Read-only filesystem (e.g. serverless without a DB store configured):
    // don't fail the visitor's request over telemetry.
    //
    // E13 compensation: hand the key back first. This path still answers
    // {ok:true}, so the outbox deletes its copy — and a claim left standing
    // would turn a transient store outage into PERMANENT loss, because every
    // later replay of that key answers "duplicate" for a row that was never
    // written. Best-effort by contract: releaseIdempotencyKey never throws.
    if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey);
    console.warn("survey: store unavailable, response dropped");
  }
  return Response.json({ ok: true });
}

/** Aggregate summary for the Chamber's LTAC/JLARC reporting. Admin-only —
 *  the same numbers render on the gated /admin dashboard. Only GET is gated:
 *  POST is the anonymous visitor submission and must stay public. */
export async function GET() {
  // Imported lazily so the public POST path above never pulls the auth/DB
  // module graph in at module scope.
  const { requireAdmin } = await import("@/lib/auth");
  const denied = await requireAdmin();
  if (denied) return denied;

  // Windowed by the analytics baseline, because the doc comment above promises
  // "the same numbers render on the gated /admin dashboard" — and that page is
  // windowed. Two endpoints claiming to be the same numbers have to move
  // together, or the promise quietly becomes a bug report from whoever
  // compares them. Lazily imported for the same reason as the auth module.
  const { getAnalyticsSince } = await import("@/lib/stores/analytics-baseline-store");
  const summary = await surveyStore.summarize(await getAnalyticsSince());
  return Response.json(summary);
}
