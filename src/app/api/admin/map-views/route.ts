// Admin map-views API — backs the /admin/maps builder.
//
// GET            — admin: all views (seed + overlay merged).
// POST           — admin: create/update one view. On create with no id, the
//                  id is slugified from the name; collisions get a -2, -3, …
//                  suffix so two views never silently overwrite each other.
// DELETE ?id=X   — admin: tombstone a view (hides seed entries too).
//
// 401 signed out · 403 signed in but not admin. The /admin layout gates the
// editor UI; these handlers re-check because API routes bypass layouts.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import type { BuiltInSource, MapView } from "@/lib/map/types";
import { deleteMapView, getMapView, getMapViews, saveMapView } from "@/lib/stores/map-store";
import { RecordValidationError } from "@/lib/db/store-schemas";

const SOURCES: BuiltInSource[] = ["restaurants", "parking-zones", "streets"];

// Greater Kingston, WA — anything outside this box is a data-entry mistake.
const LAT_MIN = 47.5;
const LAT_MAX = 48.1;
const LNG_MIN = -123;
const LNG_MAX = -122.2;

function isCenter(p: unknown): p is [number, number] {
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

/** Slugify a name into a URL-safe view id. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** A slug not already used by an existing view (suffix -2, -3, … on collide). */
function uniqueId(base: string, existing: Set<string>): string {
  const root = base || "view";
  if (!existing.has(root)) return root;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${root}-${n}`.slice(0, 64);
    if (!existing.has(candidate)) return candidate;
  }
  return `${root}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return NextResponse.json({ views: await getMapViews() });
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

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const views = await getMapViews();
  const existingIds = new Set(views.map((v) => v.id));

  // id: explicit (update, or client-chosen) must be a valid slug; otherwise
  // derive it from the name and de-collide.
  let id: string;
  const rawId = typeof body.id === "string" ? body.id.trim() : "";
  if (rawId) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(rawId)) {
      return NextResponse.json(
        { error: "id must be letters, numbers, and dashes (max 64 chars)" },
        { status: 400 },
      );
    }
    id = rawId;
  } else {
    id = uniqueId(slugify(name), existingIds);
  }

  if (typeof body.zoom !== "number" || !Number.isFinite(body.zoom) || body.zoom < 10 || body.zoom > 19) {
    return NextResponse.json({ error: "zoom must be a number between 10 and 19" }, { status: 400 });
  }
  const zoom = Math.round(body.zoom);

  if (!isCenter(body.center)) {
    return NextResponse.json(
      { error: "center must be [lat, lng] within the Kingston area" },
      { status: 400 },
    );
  }
  const center: [number, number] = [body.center[0], body.center[1]];

  let sources: BuiltInSource[] = [];
  if (body.sources != null) {
    if (!Array.isArray(body.sources) || !body.sources.every((s) => SOURCES.includes(s as BuiltInSource))) {
      return NextResponse.json(
        { error: "sources must be a subset of restaurants, parking-zones, streets" },
        { status: 400 },
      );
    }
    // De-dupe while preserving the canonical order.
    sources = SOURCES.filter((s) => (body.sources as string[]).includes(s));
  }

  const published = body.published === true;
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : undefined;

  const view: MapView = {
    id,
    name,
    ...(description ? { description } : {}),
    center,
    zoom,
    sources,
    published,
  };

  try {
    await saveMapView(view, { actor, source: "admin" });
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true, view });
}

export async function DELETE(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const actor = (await getSessionUser())!.email;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (!(await getMapView(id))) {
    return NextResponse.json({ error: "View not found" }, { status: 404 });
  }

  try {
    await deleteMapView(id, { actor, source: "admin" });
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}
