// POST /api/admin/race/sync — the admin "Sync now" button. Pulls every
// succeeded payment on the Zeffy campaign into race_registrant. Always the
// authoritative path; the webhook (api/webhooks/zeffy) is only an accelerator.
//
// 401 signed out · 403 signed in but not admin · 503 Zeffy not configured.
// Provider errors come back as a status code only — a Zeffy error body could
// echo request details, and this key is write-capable.

import { NextResponse } from "next/server";

import { getSessionUser, requireAdmin } from "@/lib/auth";
import { runRaceSync } from "@/lib/race/sync";
import { ZeffyApiError } from "@/lib/race/zeffy-client";

export const dynamic = "force-dynamic";

export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const actor = (await getSessionUser())!.email;

  try {
    const result = await runRaceSync("manual", { runBy: actor });
    if (!result.ok) {
      return NextResponse.json(
        { error: "Zeffy is not configured yet — ZEFFY_API_KEY and ZEFFY_CAMPAIGN_ID must both be set." },
        { status: 503 },
      );
    }
    return NextResponse.json({ runId: result.runId, stats: result.stats });
  } catch (err) {
    if (err instanceof ZeffyApiError) {
      return NextResponse.json({ error: `Zeffy answered ${err.status}. Try again in a minute.` }, { status: 502 });
    }
    console.error("race sync failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "The sync failed before it finished. Nothing was lost — run it again." }, { status: 500 });
  }
}
