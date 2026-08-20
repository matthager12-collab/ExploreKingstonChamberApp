// Revert a seeded content record to the version that ships in the codebase.
//
// The seed+overlay merge is overlay-wins-by-id, so any overlay row detaches
// its record from the seed file permanently — a later fix to the seed can
// never surface. This endpoint deletes that row, re-attaching the record.
// It is the ONLY way back: saving the shipped text through the normal editor
// just writes another overlay row saying the same thing.
//
// POST { domain, id } → { ok, outcome }. 409 when the record carries state the
// seed cannot represent (a takedown, an ownership claim, an AMS link) — see
// detachOverlayRecord for the full guard list. 401/403/404 as elsewhere.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import { revertItinerary } from "@/lib/stores/itinerary-store";
import { revertLodging, revertWebcam } from "@/lib/stores/listing-stores";
import { revertRestaurant } from "@/lib/stores/business-store";
import { revalidatePublicPathsForStore } from "@/lib/public-paths";
import { trimOrEmpty } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Seeded domains only — `directory` ships no seed, so it has nothing to
 *  revert to and is deliberately absent. */
const REVERTABLE = {
  itineraries: revertItinerary,
  lodging: revertLodging,
  webcams: revertWebcam,
  restaurants: revertRestaurant,
} as const;
type Revertable = keyof typeof REVERTABLE;

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

  const domain = trimOrEmpty(body.domain) as Revertable;
  if (!Object.prototype.hasOwnProperty.call(REVERTABLE, domain)) {
    return NextResponse.json(
      { error: `domain must be one of: ${Object.keys(REVERTABLE).join(", ")}` },
      { status: 400 },
    );
  }
  const id = trimOrEmpty(body.id);
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const outcome = await REVERTABLE[domain](id, { actor, source: "admin" });

  if (outcome === "absent") {
    return NextResponse.json(
      { error: "This record is already using the shipped version." },
      { status: 404 },
    );
  }
  if (outcome === "refused") {
    return NextResponse.json(
      {
        error:
          "This record can't be reverted: it's hidden, awaiting review, or linked to an owner or the membership system. Clear that first.",
      },
      { status: 409 },
    );
  }

  // Without this the public page keeps serving the overlay text for the ISR
  // window and the revert looks like it silently failed.
  await revalidatePublicPathsForStore(domain);
  return NextResponse.json({ ok: true, outcome });
}
