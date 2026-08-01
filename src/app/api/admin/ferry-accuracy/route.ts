// Admin API for the forecast-accuracy panel on /admin/ferry-info.
//
// GET  — admin: { latest, history, daily } — the recorded accuracy snapshots
//        plus the per-day series behind the trend chart.
// POST — admin: runs the backtest now and records a fresh snapshot, then returns
//        the same shape. Lets staff validate on demand instead of waiting for
//        the daily cron.
//
// `daily` is recomputed from the observation log rather than read from the
// stored history, which is cumulative and gappy — see computeDailyAccuracy.
//
// 401 signed out · 403 signed in but not admin.

import { NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import {
  computeDailyAccuracy,
  getAccuracy,
  recordAccuracySnapshot,
} from "@/lib/stores/ferry-observations";
import { RecordValidationError } from "@/lib/db/store-schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const [accuracy, daily] = await Promise.all([getAccuracy(), computeDailyAccuracy()]);
  return NextResponse.json({ ...accuracy, daily });
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
  // force: the operator just asked for a fresh test, so a cached series would
  // misrepresent what the button did.
  const [accuracy, daily] = await Promise.all([
    getAccuracy(),
    computeDailyAccuracy({ force: true }),
  ]);
  return NextResponse.json({ ok: true, ...accuracy, daily });
}
