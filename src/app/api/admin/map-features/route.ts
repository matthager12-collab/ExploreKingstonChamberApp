// Admin map-features API — backs the /admin/maps builder.
//
// GET [?view=id] — admin: all features, optionally only those on one view.
// POST           — admin: create/update one feature. Geometry must match the
//                  kind (marker→point, line/trail→path≥2, area→polygon≥3) and
//                  every point is sanity-checked against a greater-Kingston box
//                  so a fat-fingered drag can't fling a feature into the ocean.
//                  views[] must reference existing view ids.
// DELETE ?id=X   — admin: tombstone a feature (hides seed entries too).
//
// 401 signed out · 403 signed in but not admin. The /admin layout gates the
// editor UI; these handlers re-check because API routes bypass layouts.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import type {
  FeatureKind,
  MapFeature,
  MapLabel,
  LabelShow,
  LabelDir,
  ParkingMeta,
  ParkingType,
} from "@/lib/map/types";
import { PARKING_TYPES } from "@/lib/map/types";
import { isAllowedPaymentLink } from "@/lib/map/payment-link";
import { deleteMapFeature, getMapFeatures, saveMapFeature } from "@/lib/stores/map-store";
import { getMapViews } from "@/lib/stores/map-store";
import { RecordValidationError } from "@/lib/db/store-schemas";

const KINDS: FeatureKind[] = ["marker", "line", "trail", "area"];

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

export async function GET(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const view = request.nextUrl.searchParams.get("view");
  const features = await getMapFeatures();
  return NextResponse.json({
    features: view ? features.filter((f) => f.views.includes(view)) : features,
  });
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

  const kind = body.kind as FeatureKind;
  if (!KINDS.includes(kind)) {
    return NextResponse.json({ error: "kind must be marker, line, trail, or area" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  // Geometry must match the kind.
  let point: [number, number] | undefined;
  let path: [number, number][] | undefined;
  let polygon: [number, number][] | undefined;

  if (kind === "marker") {
    if (!isLatLng(body.point)) {
      return NextResponse.json(
        { error: "marker needs point [lat, lng] within the Kingston area" },
        { status: 400 },
      );
    }
    point = [body.point[0], body.point[1]];
  } else if (kind === "line" || kind === "trail") {
    if (!Array.isArray(body.path) || body.path.length < 2) {
      return NextResponse.json(
        { error: `${kind} needs a path of at least 2 [lat, lng] points` },
        { status: 400 },
      );
    }
    if (!body.path.every(isLatLng)) {
      return NextResponse.json(
        { error: "every path point must be [lat, lng] within the Kingston area" },
        { status: 400 },
      );
    }
    path = body.path.map((p) => [p[0], p[1]] as [number, number]);
  } else {
    // area
    if (!Array.isArray(body.polygon) || body.polygon.length < 3) {
      return NextResponse.json(
        { error: "area needs a polygon of at least 3 [lat, lng] points" },
        { status: 400 },
      );
    }
    if (!body.polygon.every(isLatLng)) {
      return NextResponse.json(
        { error: "every polygon point must be [lat, lng] within the Kingston area" },
        { status: 400 },
      );
    }
    polygon = body.polygon.map((p) => [p[0], p[1]] as [number, number]);
  }

  // views[] must be a non-empty array of existing view ids.
  if (!Array.isArray(body.views) || body.views.length === 0 || !body.views.every((v) => typeof v === "string")) {
    return NextResponse.json({ error: "assign the feature to at least one view" }, { status: 400 });
  }
  const knownIds = new Set((await getMapViews()).map((v) => v.id));
  const views = [...new Set(body.views as string[])];
  const unknown = views.filter((v) => !knownIds.has(v));
  if (unknown.length) {
    return NextResponse.json(
      { error: `unknown view id(s): ${unknown.join(", ")}` },
      { status: 400 },
    );
  }

  const category =
    typeof body.category === "string" && body.category.trim() ? body.category.trim() : undefined;
  const color =
    typeof body.color === "string" && /^#[0-9a-f]{6}$/i.test(body.color.trim())
      ? body.color.trim()
      : undefined;
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : undefined;
  const link =
    typeof body.link === "string" && /^https?:\/\//.test(body.link.trim())
      ? body.link.trim()
      : undefined;
  const imageUrl =
    typeof body.imageUrl === "string" && body.imageUrl.trim() ? body.imageUrl.trim() : undefined;

  // images[]: stored-image names the upload endpoint returned. Keep only valid
  // names, cap at 8, drop the rest.
  const images =
    Array.isArray(body.images)
      ? body.images
          .filter((n): n is string => typeof n === "string" && /^[a-z0-9._-]{1,80}$/i.test(n))
          .slice(0, 8)
      : [];

  // parking: only built when an object with a valid type key is supplied.
  const parkingKeys = new Set<string>(PARKING_TYPES.map((t) => t.key));
  let parking: ParkingMeta | undefined;
  if (body.parking && typeof body.parking === "object" && !Array.isArray(body.parking)) {
    const p = body.parking as Record<string, unknown>;
    const type = typeof p.type === "string" && parkingKeys.has(p.type) ? (p.type as ParkingType) : undefined;
    if (type) {
      const str = (v: unknown, max: number) =>
        typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
      const owner = str(p.owner, 200);
      const phone = str(p.phone, 200);
      const paymentMethod = str(p.paymentMethod, 200);
      const paymentNotes = str(p.paymentNotes, 200);
      const timeLimit = str(p.timeLimit, 200);
      const paymentLink = isAllowedPaymentLink(p.paymentLink)
        ? (p.paymentLink as string).trim().slice(0, 500)
        : undefined;
      parking = {
        type,
        ...(owner ? { owner } : {}),
        ...(phone ? { phone } : {}),
        ...(paymentMethod ? { paymentMethod } : {}),
        ...(paymentLink ? { paymentLink } : {}),
        ...(paymentNotes ? { paymentNotes } : {}),
        ...(timeLimit ? { timeLimit } : {}),
      };
    }
  }

  // label: on-map name-label overrides. Persist only non-default sub-fields so
  // payloads stay lean and unset fields fall back to smart defaults.
  const SHOW = new Set(["auto", "on", "off"]);
  const DIR = new Set(["auto", "top", "right", "bottom", "left"]);
  let label: MapLabel | undefined;
  if (body.label && typeof body.label === "object" && !Array.isArray(body.label)) {
    const m = body.label as Record<string, unknown>;
    const text =
      typeof m.text === "string" && m.text.trim() ? m.text.trim().slice(0, 40) : undefined;
    const show =
      typeof m.show === "string" && SHOW.has(m.show) ? (m.show as LabelShow) : undefined;
    const dir = typeof m.dir === "string" && DIR.has(m.dir) ? (m.dir as LabelDir) : undefined;
    const priority =
      typeof m.priority === "number" && Number.isFinite(m.priority)
        ? Math.max(-50, Math.min(50, Math.round(m.priority)))
        : undefined;
    if (
      text ||
      (show && show !== "auto") ||
      (dir && dir !== "auto") ||
      (priority != null && priority !== 0)
    ) {
      label = {
        ...(text ? { text } : {}),
        ...(show ? { show } : {}),
        ...(dir ? { dir } : {}),
        ...(priority != null ? { priority } : {}),
      };
    }
  }

  const feature: MapFeature = {
    id,
    kind,
    title,
    views,
    ...(notes ? { notes } : {}),
    ...(label ? { label } : {}),
    ...(category ? { category } : {}),
    ...(color ? { color } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(images.length ? { images } : {}),
    ...(parking ? { parking } : {}),
    ...(link ? { link } : {}),
    ...(point ? { point } : {}),
    ...(path ? { path } : {}),
    ...(polygon ? { polygon } : {}),
  };

  try {
    await saveMapFeature(feature, { actor, source: "admin" });
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true, feature });
}

export async function DELETE(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const actor = (await getSessionUser())!.email;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (!(await getMapFeatures()).some((f) => f.id === id)) {
    return NextResponse.json({ error: "Feature not found" }, { status: 404 });
  }

  try {
    await deleteMapFeature(id, { actor, source: "admin" });
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}
