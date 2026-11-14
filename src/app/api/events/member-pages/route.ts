// Daily check of every member-saved events page (docs/adr/ADR-0009). Invoked by
// the Render cron `member-event-pages`; also runnable by a signed-in admin.
//
// Auth is /api/events/ingest's: `Authorization: Bearer $EVENTS_INGEST_TOKEN`
// (header only), else an admin session. FAILS CLOSED, including in
// development: with the token unset there is no token path, and an
// unauthenticated caller gets 503 in production / 401 elsewhere — this route
// spends model budget and fetches arbitrary member urls, so it is never open.
//
// Outside the proxy matcher (src/proxy.ts), like /api/events/ingest, so no
// MACHINE_TOKEN_ROUTES entry is needed; the check below is the gate.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireAdmin, timingSafeEqualStr } from "@/lib/auth";
import { checkMemberEventPage } from "@/lib/events/member-page-check";
import { listPagesDue, recordCheck } from "@/lib/stores/member-event-page-store";

export const dynamic = "force-dynamic";

const STALE_AFTER_MS = 20 * 60 * 60_000;
const PAUSE_MS = 300;
// ponytail: one cap per run keeps the cron inside its curl timeout; the rest
// are picked up next run because they stay "due". Raise or batch if members grow past it.
const MAX_PER_RUN = 40;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: NextRequest) {
  const expected = process.env.EVENTS_INGEST_TOKEN;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const tokenOk = Boolean(expected && provided && timingSafeEqualStr(provided, expected));

  if (!tokenOk) {
    const user = await getSessionUser();
    if (user?.role !== "admin") {
      if (!expected && process.env.NODE_ENV === "production") {
        return NextResponse.json({ error: "EVENTS_INGEST_TOKEN is not configured" }, { status: 503 });
      }
      const denied = await requireAdmin();
      if (denied) return denied;
    }
  }

  const due = (await listPagesDue(new Date(Date.now() - STALE_AFTER_MS))).slice(0, MAX_PER_RUN);
  let checked = 0;
  let failed = 0;
  let added = 0;
  for (const [i, page] of due.entries()) {
    if (i > 0) await sleep(PAUSE_MS);
    try {
      const r = await checkMemberEventPage(page.ownerId);
      if (r.ok) {
        checked += 1;
        added += r.added;
      } else {
        failed += 1;
      }
    } catch {
      // One bad page never stops the loop. No detail logged: errors can echo page content.
      failed += 1;
      // Stamp it so a page that keeps throwing is not retried every run.
      await recordCheck(page.ownerId, "We couldn't check that page").catch(() => {});
    }
  }
  return NextResponse.json({ ok: true, checked, failed, added });
}
