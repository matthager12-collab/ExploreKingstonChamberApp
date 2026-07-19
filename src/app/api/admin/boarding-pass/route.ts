// Admin boarding-pass override API — backs the toggle on /admin/ferry-info.
//
// GET  — admin: { estimate, override, effective } so the control can show what
//        the heuristic thinks, what's pinned (if anything), and the net verdict.
// POST — admin: { action: "on" | "off" | "auto" }. "on"/"off" pin the verdict
//        for the rest of today's Pacific day; "auto" clears the pin. Returns the
//        refreshed { override, effective }.
//
// 401 signed out · 403 signed in but not admin. The /admin layout gates the UI;
// this handler re-checks because API routes bypass layouts.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import { getBoardingPassStatus } from "@/lib/wsf";
import {
  clearBoardingPassOverride,
  getBoardingPassOverride,
  getEffectiveBoardingPass,
  setBoardingPassOverride,
} from "@/lib/stores/boarding-pass-store";
import { RecordValidationError } from "@/lib/db/store-schemas";

export const dynamic = "force-dynamic";

async function snapshot() {
  const [override, effective] = await Promise.all([
    getBoardingPassOverride(),
    getEffectiveBoardingPass(),
  ]);
  return { estimate: getBoardingPassStatus(), override, effective };
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return NextResponse.json(await snapshot());
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  // The gate proved a session exists — this only re-reads it to attribute the pin.
  const user = (await getSessionUser())!;

  let body: { action?: unknown };
  try {
    body = (await request.json()) as { action?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const setBy = user.name || user.email || "admin";
  const meta = { actor: user.email, source: "admin" } as const;

  try {
    if (action === "on") await setBoardingPassOverride(true, setBy, undefined, meta);
    else if (action === "off") await setBoardingPassOverride(false, setBy, undefined, meta);
    else if (action === "auto") await clearBoardingPassOverride(meta);
    else return NextResponse.json({ error: 'action must be "on", "off", or "auto"' }, { status: 400 });
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true, ...(await snapshot()) });
}
