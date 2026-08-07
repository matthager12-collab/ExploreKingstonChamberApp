// Admin endpoint for the per-zone Port bay nudge (E34).
//
// Its own route rather than a field on POST /api/admin/parking, because that
// handler rebuilds the MapZone from a field whitelist — a nudge stored there
// would be silently wiped by the next ordinary save, including one that only
// dragged a pin. See the header of src/lib/stores/bay-transform-store.ts.
//
// Range checking is NOT done here. clampBayTransform() owns it, and it is the
// same function the store re-applies on read and the admin editor uses for its
// live preview, so the limits cannot drift between the three. This handler's
// job is the parts clamping cannot do: prove the caller is an admin, prove the
// body is shaped like a transform, and name the zone.

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getSessionUser, requireAdmin } from "@/lib/auth";
import { RecordValidationError } from "@/lib/db/store-schemas";
import { clampBayTransform } from "@/lib/map/bay-transform";
import { getBayTransforms, saveBayTransform } from "@/lib/stores/bay-transform-store";

/**
 * Only `/parking`. Same reasoning as the parking route's own helper: the kiosk
 * surfaces are dynamic, and the public `/map` is a shell that fetches views
 * client-side from the dynamic `/api/map/[viewId]`.
 */
function revalidateBaySurfaces(): void {
  revalidatePath("/parking");
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return NextResponse.json({ transforms: await getBayTransforms() });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  // The gate proved a session exists — this only re-reads it for the audit actor.
  const actor = (await getSessionUser())!.email;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(id)) {
    return NextResponse.json(
      { error: "id required: letters, numbers, and dashes (max 64 chars)" },
      { status: 400 },
    );
  }

  // Reject a malformed number rather than clamping it. Clamping is for a value
  // that is out of range but meant — a slider dragged to its end. A string or a
  // NaN is a broken caller, and silently turning it into 0 would leave an admin
  // looking at bays that did not move with no idea why.
  //
  // `!= null` and not the house `...(x ? …)` spread: 0 is falsy and is the most
  // meaningful value any of these fields takes ("no offset", explicitly set).
  for (const field of ["dx", "dy", "rotateDeg", "scale"] as const) {
    const v = body[field];
    if (v != null && (typeof v !== "number" || !Number.isFinite(v))) {
      return NextResponse.json(
        { error: `${field} must be a finite number` },
        { status: 400 },
      );
    }
  }

  try {
    const saved = await saveBayTransform(id, clampBayTransform(body), {
      actor,
      source: "admin",
    });
    revalidateBaySurfaces();
    return NextResponse.json({ transform: saved });
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
