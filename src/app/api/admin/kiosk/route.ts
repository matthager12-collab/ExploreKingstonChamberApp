// Admin API for the ferry-dock kiosk (E22) — backs /admin/kiosk.
//
// GET  — admin: the current settings.
// POST — admin: { enabled?, enabledScreens?, idleSeconds? } → merge + save, then
//        push the change to the device immediately. Returns the saved settings.
//
// 401 signed out · 403 signed in but not admin. The /admin layout gates the UI;
// this handler re-checks because API routes bypass layouts.

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import { getKioskSettings, setKioskSettings } from "@/lib/stores/kiosk-store";
import { RecordValidationError } from "@/lib/db/store-schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return NextResponse.json({ settings: await getKioskSettings() });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  // The gate proved a session exists — this only re-reads it to attribute the save.
  const user = (await getSessionUser())!;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Type-check the three fields the store cannot sensibly coerce, so a
  // fat-fingered API call gets a 400 rather than a silently ignored field. The
  // store still re-normalises everything — this is the friendly layer, not the
  // guarantee. enabledScreens is deliberately NOT rejected for unknown ids: the
  // store filters them, so an older admin tab posting a since-removed screen
  // saves the rest instead of failing the whole write.
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  if (body.enabledScreens !== undefined && !Array.isArray(body.enabledScreens)) {
    return NextResponse.json({ error: "enabledScreens must be an array" }, { status: 400 });
  }
  if (body.idleSeconds !== undefined && typeof body.idleSeconds !== "number") {
    return NextResponse.json({ error: "idleSeconds must be a number" }, { status: 400 });
  }

  let settings;
  try {
    settings = await setKioskSettings(body, user.name || user.email || "admin", {
      actor: user.email,
      source: "admin",
    });
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  // THE INSTANT-PUSH LEVER, and the reason the admin page has a "Refresh the
  // kiosk now" button that posts an unchanged payload.
  //
  // Kiosk pages are ISR with revalidate = 60, so an ordinary listing edit
  // reaches the device within about a minute on its own — that is the normal,
  // no-deploy update path and it needs nothing from here. But a KIOSK SETTINGS
  // change is different: turning the device off, or hiding a screen, is
  // something staff do because they want it gone NOW (a screen showing wrong
  // information, an event that was cancelled), and waiting out an ISR window
  // while standing in front of a wall-mounted panel is not an acceptable
  // answer. 'layout' scope so the child screens revalidate too, not just
  // /kiosk itself — the tile list lives in the layout's data but the screens
  // are what a visitor is actually looking at.
  revalidatePath("/kiosk", "layout");

  return NextResponse.json({ ok: true, settings });
}
