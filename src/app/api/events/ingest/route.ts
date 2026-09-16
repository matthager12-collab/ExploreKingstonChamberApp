// E12 ingest endpoint — POST runs every enabled calendar source's adapter and
// mirrors the results into the external-events store (idempotent; audit rows
// via the writeRecord choke point). Invoked hourly by the Render cron
// (render.yaml `events-ingest`), and available to a signed-in admin.
//
// Auth (pattern from /api/admin/worklist/sweep, FAIL-CLOSED like it):
//   - `Authorization: Bearer $EVENTS_INGEST_TOKEN` (header only — a token in
//     a query string lands in access logs, and the Render cron already sends
//     the header);
//   - else an admin session;
//   - EVENTS_INGEST_TOKEN unset in production → 503 for token callers (the
//     cron is misconfigured — fail loud, never open); unset in development →
//     open, so `npm run dev` can exercise ingest without secrets.
//
// This path is deliberately OUTSIDE the proxy matcher (src/proxy.ts), so no
// MACHINE_TOKEN_ROUTES carve-out is needed — the route's own check here is
// the authoritative gate either way.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireAdmin, timingSafeEqualStr } from "@/lib/auth";
import { runIngest } from "@/lib/events/ingest";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const expected = process.env.EVENTS_INGEST_TOKEN;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";

  let actor = "system";
  const tokenOk = Boolean(expected && provided && timingSafeEqualStr(provided, expected));
  if (!tokenOk) {
    const user = await getSessionUser();
    if (user?.role === "admin") {
      actor = user.email;
    } else if (!expected && process.env.NODE_ENV === "production") {
      // Fail closed: a production deploy without the token cannot be driven
      // by its cron — surface the misconfiguration, don't open the route.
      return NextResponse.json(
        { error: "EVENTS_INGEST_TOKEN is not configured" },
        { status: 503 },
      );
    } else if (expected || process.env.NODE_ENV !== "development") {
      const denied = await requireAdmin();
      if (denied) return denied;
    }
    // NODE_ENV=development with no token configured: open, by design.
  }

  const perSource = await runIngest(actor);
  return NextResponse.json({ ok: true, perSource });
}
