import { NextRequest } from "next/server";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { surveyStore } from "@/lib/survey-store";
import type { SurveyResponse } from "@/lib/types";

const DISTANCE_BANDS = ["local", "10-50mi", "50mi-plus", "out-of-state", "international"];

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
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!body.distanceBand || !DISTANCE_BANDS.includes(body.distanceBand)) {
    return Response.json({ error: "distanceBand required" }, { status: 400 });
  }

  const response: SurveyResponse = {
    submittedAt: new Date().toISOString(),
    distanceBand: body.distanceBand,
    overnight: Boolean(body.overnight),
    homeZip: typeof body.homeZip === "string" ? body.homeZip.slice(0, 5) : undefined,
    homeState: typeof body.homeState === "string" ? body.homeState.slice(0, 20) : undefined,
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

  const summary = await surveyStore.summarize();
  return Response.json(summary);
}
