// Portal listing API — PUT updates a restaurant/business listing.
//
// Server-side rules: valid session required; can(…, "edit-record") against the STORED
// record's id (never the client's word); only whitelisted fields merge onto
// the stored record. id can never change, and placement fields (lat/lng/
// walkMinutesFromFerry) plus the display name stay Chamber-controlled unless
// the caller is an admin.

import { NextRequest, NextResponse } from "next/server";
import { can, getSessionUser } from "@/lib/auth";
import { getRestaurant, saveRestaurant } from "@/lib/stores/business-store";
import { RecordValidationError } from "@/lib/db/store-schemas";
import type { Restaurant, WeeklyHours } from "@/lib/types";

const PLATFORMS = ["toast", "square", "doordash", "own-site", "phone-only"] as const;
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Strict shape check: 7 day keys, each 0-2 spans of valid "HH:mm" pairs. */
function parseWeeklyHours(v: unknown): WeeklyHours | null {
  if (!v || typeof v !== "object") return null;
  const out = {} as WeeklyHours;
  for (const key of DAY_KEYS) {
    const day = (v as Record<string, unknown>)[key];
    if (!Array.isArray(day) || day.length > 2) return null;
    const spans: [string, string][] = [];
    for (const span of day) {
      if (!Array.isArray(span) || span.length !== 2) return null;
      const [open, close] = span as unknown[];
      if (typeof open !== "string" || typeof close !== "string") return null;
      if (!TIME_RE.test(open) || !TIME_RE.test(close) || open === close) return null;
      spans.push([open, close]);
    }
    out[key] = spans;
  }
  return out;
}

export async function PUT(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const stored = await getRestaurant(id);
  if (!stored) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  if (!can(user, "edit-record", stored.id)) {
    return NextResponse.json({ error: "You don't manage this listing" }, { status: 403 });
  }

  // Start from the stored record: anything not whitelisted below (id, lat,
  // lng, walkMinutesFromFerry, name for non-admins) survives untouched.
  const next: Restaurant = { ...stored };

  // Required text fields — only overwrite with non-empty values.
  for (const key of ["description", "cuisine", "address"] as const) {
    const v = body[key];
    if (typeof v === "string" && v.trim()) next[key] = v.trim();
  }

  // Optional text fields — an empty string clears them.
  for (const key of ["phone", "website", "menuUrl", "orderingUrl", "hours"] as const) {
    const v = body[key];
    if (typeof v === "string") next[key] = v.trim() || undefined;
  }

  if ("orderingPlatform" in body) {
    const v = body.orderingPlatform;
    if (v === "" || v == null) {
      next.orderingPlatform = undefined;
    } else if (typeof v === "string" && (PLATFORMS as readonly string[]).includes(v)) {
      next.orderingPlatform = v as Restaurant["orderingPlatform"];
    } else {
      return NextResponse.json({ error: "unknown orderingPlatform" }, { status: 400 });
    }
  }

  if ("priceLevel" in body) {
    const v = Number(body.priceLevel);
    if (v !== 1 && v !== 2 && v !== 3) {
      return NextResponse.json({ error: "priceLevel must be 1, 2, or 3" }, { status: 400 });
    }
    next.priceLevel = v;
  }

  if ("tags" in body) {
    if (!Array.isArray(body.tags)) {
      return NextResponse.json({ error: "tags must be an array" }, { status: 400 });
    }
    next.tags = body.tags
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  if ("weeklyHours" in body) {
    const weekly = parseWeeklyHours(body.weeklyHours);
    if (!weekly) {
      return NextResponse.json({ error: "weeklyHours is malformed" }, { status: 400 });
    }
    next.weeklyHours = weekly;
  }

  if (typeof body.hoursVerified === "string" && DATE_RE.test(body.hoursVerified)) {
    next.hoursVerified = body.hoursVerified;
  }

  // Chamber-only corrections: name and map placement.
  if (user.role === "admin") {
    if (typeof body.name === "string" && body.name.trim()) next.name = body.name.trim();
    for (const key of ["lat", "lng", "walkMinutesFromFerry"] as const) {
      const v = body[key];
      if (typeof v === "number" && Number.isFinite(v)) next[key] = v;
    }
  }

  next.id = stored.id; // belt and braces — never client-controlled
  try {
    await saveRestaurant(next, {
      actor: user.email,
      source: user.role === "admin" ? "admin" : "portal",
    });
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true, listing: next });
}
