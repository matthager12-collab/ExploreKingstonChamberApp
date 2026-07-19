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
import { getSessionUser, requireAdmin } from "@/lib/auth";
import {
  getFerryPredictionEnabled,
  getFerryPredictionSetting,
  setFerryPredictionEnabled,
} from "@/lib/stores/ferry-prediction-store";
import { RecordValidationError } from "@/lib/db/store-schemas";

export const dynamic = "force-dynamic";

async function snapshot() {
  const [enabled, setting] = await Promise.all([
    getFerryPredictionEnabled(),
    getFerryPredictionSetting(),
  ]);
  return { enabled, setting };
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return NextResponse.json(await snapshot());
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  // The gate proved a session exists — this only re-reads it to attribute the flip.
  const user = (await getSessionUser())!;

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
    await setFerryPredictionEnabled(body.enabled, user.name || user.email || "admin", {
      actor: user.email,
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
