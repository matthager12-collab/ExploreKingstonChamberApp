// Admin API for the forecast-accuracy panel on /admin/ferry-info.
//
// GET  — admin: { latest, history } (the recorded accuracy snapshots).
// POST — admin: runs the backtest now and records a fresh snapshot, then returns
//        { latest, history }. Lets staff validate on demand instead of waiting
//        for the daily cron.
//
// 401 signed out · 403 signed in but not admin.

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAccuracy, recordAccuracySnapshot } from "@/lib/stores/ferry-observations";
import { RecordValidationError } from "@/lib/db/store-schemas";

export const dynamic = "force-dynamic";

async function requireAdmin(): Promise<
  { ok: true; user: { name: string; email: string } } | { ok: false; res: NextResponse }
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: "Sign in first" }, { status: 401 }) };
  if (user.role !== "admin") {
    return { ok: false, res: NextResponse.json({ error: "Chamber admins only" }, { status: 403 }) };
  }
  return { ok: true, user };
}

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  return NextResponse.json(await getAccuracy());
}

export async function POST() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  try {
    await recordAccuracySnapshot({ actor: gate.user.email, source: "admin" });
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true, ...(await getAccuracy()) });
}
