// Admin parking-zone API — backs the /admin/map editor.
//
// GET            — admin: all zones (seed + overlay merged).
// POST           — admin: create/update one zone. Geometry is sanity-checked
//                  against a greater-Kingston bounding box so a fat-fingered
//                  drag can't fling a lot into the Pacific.
// DELETE ?id=X   — admin: tombstone a zone (hides seed entries too).
//
// 401 signed out · 403 signed in but not admin. The /admin layout gates the
// editor UI; these handlers re-check because API routes bypass layouts.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import type { MapZone, ParkingRule } from "@/lib/data/parking";
import {
  deleteParkingZone,
  getParkingZone,
  getParkingZones,
  saveParkingZone,
} from "@/lib/stores/parking-store";
import { RecordValidationError } from "@/lib/db/store-schemas";

const RULES: ParkingRule[] = [
  "free-2hr",
  "free-unrestricted",
  "paid",
  "park-and-ride-24h",
  "prohibited",
  "load-zone",
  "permit",
];
const OVERNIGHT: MapZone["overnight"][] = ["yes", "no", "confirm-first"];
const CONFIDENCE: MapZone["confidence"][] = ["verified", "probable", "unverified"];

// Greater Kingston, WA — anything outside this box is a data-entry mistake.
const LAT_MIN = 47.5;
const LAT_MAX = 48.1;
const LNG_MIN = -123;
const LNG_MAX = -122.2;

function isLatLng(p: unknown): p is [number, number] {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    typeof p[0] === "number" &&
    typeof p[1] === "number" &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) &&
    p[0] >= LAT_MIN &&
    p[0] <= LAT_MAX &&
    p[1] >= LNG_MIN &&
    p[1] <= LNG_MAX
  );
}

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

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  return NextResponse.json({ zones: await getParkingZones() });
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

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

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const rule = body.rule as ParkingRule;
  if (!RULES.includes(rule)) {
    return NextResponse.json({ error: "unknown rule" }, { status: 400 });
  }

  const overnight = body.overnight as MapZone["overnight"];
  if (!OVERNIGHT.includes(overnight)) {
    return NextResponse.json({ error: "unknown overnight value" }, { status: 400 });
  }

  const confidence = body.confidence as MapZone["confidence"];
  if (!CONFIDENCE.includes(confidence)) {
    return NextResponse.json({ error: "unknown confidence value" }, { status: 400 });
  }

  if (!isLatLng(body.center)) {
    return NextResponse.json(
      { error: "center must be [lat, lng] within the Kingston area" },
      { status: 400 },
    );
  }
  const center: [number, number] = [body.center[0], body.center[1]];

  let polygon: [number, number][] | undefined;
  if (body.polygon != null) {
    if (!Array.isArray(body.polygon) || body.polygon.length < 3) {
      return NextResponse.json(
        { error: "polygon needs at least 3 [lat, lng] points" },
        { status: 400 },
      );
    }
    if (!body.polygon.every(isLatLng)) {
      return NextResponse.json(
        { error: "every polygon point must be [lat, lng] within the Kingston area" },
        { status: 400 },
      );
    }
    polygon = body.polygon.map((p) => [p[0], p[1]]);
  }

  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const details = typeof body.details === "string" ? body.details.trim() : "";
  const sourceUrl =
    typeof body.sourceUrl === "string" && /^https?:\/\//.test(body.sourceUrl.trim())
      ? body.sourceUrl.trim()
      : undefined;
  const sourceNote =
    typeof body.sourceNote === "string" && body.sourceNote.trim()
      ? body.sourceNote.trim()
      : undefined;

  const zone: MapZone = {
    id,
    name,
    rule,
    summary,
    details,
    confidence,
    overnight,
    center,
    ...(polygon ? { polygon } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(sourceNote ? { sourceNote } : {}),
  };

  try {
    await saveParkingZone(zone, { actor: gate.user.email, source: "admin" });
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true, zone });
}

export async function DELETE(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (!(await getParkingZone(id))) {
    return NextResponse.json({ error: "Zone not found" }, { status: 404 });
  }

  try {
    await deleteParkingZone(id, { actor: gate.user.email, source: "admin" });
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}
