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
import { getSessionUser } from "@/lib/auth";
import { getBoardingPassStatus } from "@/lib/wsf";
import {
  clearBoardingPassOverride,
  getBoardingPassOverride,
  getEffectiveBoardingPass,
  setBoardingPassOverride,
} from "@/lib/stores/boarding-pass-store";

export const dynamic = "force-dynamic";

/** Admin gate: returns the user when allowed, else the 401/403 response. */
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
  const [override, effective] = await Promise.all([
    getBoardingPassOverride(),
    getEffectiveBoardingPass(),
  ]);
  return { estimate: getBoardingPassStatus(), override, effective };
}

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  return NextResponse.json(await snapshot());
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  let body: { action?: unknown };
  try {
    body = (await request.json()) as { action?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const setBy = gate.user.name || gate.user.email || "admin";

  if (action === "on") await setBoardingPassOverride(true, setBy);
  else if (action === "off") await setBoardingPassOverride(false, setBy);
  else if (action === "auto") await clearBoardingPassOverride();
  else return NextResponse.json({ error: 'action must be "on", "off", or "auto"' }, { status: 400 });

  return NextResponse.json({ ok: true, ...(await snapshot()) });
}
