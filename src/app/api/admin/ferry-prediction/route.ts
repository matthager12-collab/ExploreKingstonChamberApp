// Admin API for the ferry-prediction on/off switch — backs the toggle on
// /admin/ferry-info.
//
// GET  — admin: { enabled, setting } (the current state + who last set it).
// POST — admin: { enabled: boolean } → flips the public visibility of the
//        prediction feature. Returns the refreshed state.
//
// 401 signed out · 403 signed in but not admin. The /admin layout gates the UI;
// this handler re-checks because API routes bypass layouts.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getFerryPredictionEnabled,
  getFerryPredictionSetting,
  setFerryPredictionEnabled,
} from "@/lib/stores/ferry-prediction-store";
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

async function snapshot() {
  const [enabled, setting] = await Promise.all([
    getFerryPredictionEnabled(),
    getFerryPredictionSetting(),
  ]);
  return { enabled, setting };
}

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  return NextResponse.json(await snapshot());
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  let body: { enabled?: unknown };
  try {
    body = (await request.json()) as { enabled?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  try {
    await setFerryPredictionEnabled(body.enabled, gate.user.name || gate.user.email || "admin", {
      actor: gate.user.email,
      source: "admin",
    });
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true, ...(await snapshot()) });
}
