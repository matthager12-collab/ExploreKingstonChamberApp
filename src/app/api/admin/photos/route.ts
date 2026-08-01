// Admin photo-placement API — which library photo fills each registered slot.
//
// GET             — every override, plus the library, so the editor and the
//                   live page resolve from identical inputs.
// POST            — put a library photo in a slot (optionally with alt text
//                   written for that position).
// DELETE ?slot=X  — send the slot back to the photo the code ships with.
//
// Both writes validate against the REGISTRY and the LIBRARY, not just the
// shape: an unknown slot key would be an override nothing ever reads, and a
// name that is not in the library would render a broken image on a public
// page. Neither should be storable.
//
// 401 signed out · 403 signed in but not admin.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import { PHOTO_SLOTS } from "@/lib/photo-slots";
import { getMediaItem } from "@/lib/stores/media-store";
import {
  clearPhotoOverride,
  getPhotoContext,
  savePhotoOverride,
} from "@/lib/stores/photo-store";

const SLOT_KEYS = new Set<string>(PHOTO_SLOTS.map((s) => s.key));

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return NextResponse.json(await getPhotoContext());
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const actor = (await getSessionUser())!.email;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const slot = typeof body.slot === "string" ? body.slot : "";
  if (!SLOT_KEYS.has(slot)) {
    return NextResponse.json({ error: "Unknown photo slot" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name : "";
  if (!name || !(await getMediaItem(name))) {
    return NextResponse.json({ error: "That photo is not in the library" }, { status: 400 });
  }

  // Per-slot alt is optional and collapses to absent when blank, so clearing
  // the field genuinely reverts to the library description rather than pinning
  // an empty string that would read as "deliberately silent".
  const rawAlt = typeof body.alt === "string" ? body.alt.replace(/\s+/g, " ").trim() : "";
  const alt = rawAlt.slice(0, 300);

  await savePhotoOverride({ id: slot, name, ...(alt ? { alt } : {}) }, { actor });
  return NextResponse.json({ ok: true, ...(await getPhotoContext()) });
}

export async function DELETE(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const actor = (await getSessionUser())!.email;

  const slot = request.nextUrl.searchParams.get("slot") ?? "";
  if (!SLOT_KEYS.has(slot)) {
    return NextResponse.json({ error: "Unknown photo slot" }, { status: 400 });
  }

  await clearPhotoOverride(slot, { actor });
  return NextResponse.json({ ok: true, ...(await getPhotoContext()) });
}
