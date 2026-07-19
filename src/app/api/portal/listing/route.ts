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
import { holdEditProposal } from "@/lib/moderation";
import { RecordValidationError } from "@/lib/db/store-schemas";
import type { Restaurant } from "@/lib/types";
// Field rules come from the shared domain schemas (E07, vk/domain-schemas):
// parseWeeklyHours is the same strict shape check that lived here before, and
// the whole merged record gets a belt-and-braces restaurantSchema parse
// before it lands in the store.
import {
  ISO_DATE_RE,
  ORDERING_PLATFORMS,
  PRICE_LEVELS,
  firstZodMessage,
  parseWeeklyHours,
  restaurantSchema,
} from "@/lib/schemas";

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
    } else if (typeof v === "string" && (ORDERING_PLATFORMS as readonly string[]).includes(v)) {
      next.orderingPlatform = v as Restaurant["orderingPlatform"];
    } else {
      return NextResponse.json({ error: "unknown orderingPlatform" }, { status: 400 });
    }
  }

  if ("priceLevel" in body) {
    const v = Number(body.priceLevel);
    if (!(PRICE_LEVELS as readonly number[]).includes(v)) {
      return NextResponse.json({ error: "priceLevel must be 1, 2, or 3" }, { status: 400 });
    }
    next.priceLevel = v as Restaurant["priceLevel"];
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

  if (typeof body.hoursVerified === "string" && ISO_DATE_RE.test(body.hoursVerified)) {
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

  // Belt-and-braces (E07): the merged record must satisfy the shared schema
  // before it lands in the store. `next` itself is saved, so the merge
  // semantics above stay exactly as they were.
  const checked = restaurantSchema.safeParse(next);
  if (!checked.success) {
    return NextResponse.json({ error: firstZodMessage(checked.error) }, { status: 400 });
  }

  try {
    if (user.role === "admin") {
      await saveRestaurant(next, { actor: user.email, source: "admin" });
    } else {
      // MODERATION FLOOR (E08): the live listing keeps serving untouched —
      // the full proposed revision waits in the worklist for Chamber review.
      await holdEditProposal("restaurants", next, next.name, user);
    }
  } catch (err) {
    if (err instanceof RecordValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json(
    user.role === "admin"
      ? { ok: true, listing: next }
      : { ok: true, listing: next, pending: true },
  );
}
