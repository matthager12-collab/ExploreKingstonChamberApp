// The shared gate for the two FERRY_OBSERVE_TOKEN routes (/api/ferry/observe
// and /api/ferry/accuracy). One function rather than two inline copies so the
// routes cannot drift apart — they ride the same token and the same cron
// credential (render.yaml `ferry-observe` / `ferry-accuracy`).
//
// FAIL-CLOSED, mirroring /api/events/ingest: token unset → 503 (the cron is
// misconfigured — fail loud, never open), except in development, where the
// routes open up so `npm run dev` can exercise them without secrets. Header
// only — a token in a query string lands in access logs, and both Render
// crons already send `Authorization: Bearer`.

import type { NextRequest } from "next/server";
import { timingSafeEqualStr } from "@/lib/auth/tokens";

/** Returns null when the caller may proceed, or the refusal Response. */
export function checkFerryObserveAuth(request: NextRequest): Response | null {
  const expected = process.env.FERRY_OBSERVE_TOKEN;
  if (!expected) {
    // NODE_ENV=development with no token configured: open, by design.
    if (process.env.NODE_ENV === "development") return null;
    return Response.json({ error: "FERRY_OBSERVE_TOKEN is not configured" }, { status: 503 });
  }
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!provided || !timingSafeEqualStr(provided, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
