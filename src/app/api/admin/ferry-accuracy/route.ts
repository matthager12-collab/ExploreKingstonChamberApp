// Admin API for the forecast-accuracy panel on /admin/ferry-info.
//
// GET  — admin: { latest, history } (the recorded accuracy snapshots).
// POST — admin: runs the backtest now and records a fresh snapshot, then returns
//        { latest, history }. Lets staff validate on demand instead of waiting
//        for the daily cron.
//
// 401 signed out · 403 signed in but not admin.

import { NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import { getAccuracy, recordAccuracySnapshot } from "@/lib/stores/ferry-observations";
import { RecordValidationError } from "@/lib/db/store-schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return NextResponse.json(await getAccuracy());
}

export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;
  // The gate proved a session exists — this only re-reads it for the audit actor.
  const actor = (await getSessionUser())!.email;
  try {
    await recordAccuracySnapshot({ actor, source: "admin" });
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true, ...(await getAccuracy()) });
}
