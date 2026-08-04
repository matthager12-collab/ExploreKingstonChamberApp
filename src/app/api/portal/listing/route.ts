// Portal listing API — PUT updates a member business listing (a restaurant,
// a lodging place, or a directory listing; the id decides which store it
// lives in).
//
// Server-side rules: valid session required; can(…, "edit-record") against the STORED
// record's id (never the client's word); only whitelisted fields merge onto
// the stored record. id can never change, and placement fields (lat/lng/
// walkMinutesFromFerry) plus the display name stay Chamber-controlled unless
// the caller is an admin.

import { NextRequest, NextResponse } from "next/server";
import { can, getSessionUser } from "@/lib/auth";
import { getRestaurant, saveRestaurant } from "@/lib/stores/business-store";
import { getLodging, saveLodging } from "@/lib/stores/listing-stores";
import {
  getDirectoryListingsAdmin,
  saveDirectoryListing,
} from "@/lib/stores/directory-store";
import { holdEditProposal } from "@/lib/moderation";
import { RecordValidationError } from "@/lib/db/store-schemas";
import type { DirectoryListing, Lodging, Restaurant } from "@/lib/types";
import type { AuthSubject } from "@/lib/auth";
// Field rules come from the shared domain schemas (E07, vk/domain-schemas):
// parseWeeklyHours is the same strict shape check that lived here before, and
// the whole merged record gets a belt-and-braces schema parse before it lands
// in the store.
import {
  DIRECTORY_CATEGORIES,
  ISO_DATE_RE,
  ORDERING_PLATFORMS,
  PRICE_LEVELS,
  directoryListingSchema,
  firstZodMessage,
  lodgingSchema,
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

  // The id decides the domain: restaurants first (the original path), then
  // lodging, then the directory. All three stores enumerate only what an
  // invite could have linked, so an unknown id is a plain 404 either way.
  // The directory read is the ADMIN one on purpose: imported records are
  // drafts, and a draft its owner cannot load is a listing they can never
  // fill in.
  const storedRestaurant = await getRestaurant(id);
  if (storedRestaurant) return putRestaurant(user, storedRestaurant, body);

  const storedLodging = (await getLodging()).find((l) => l.id === id);
  if (storedLodging) return putLodging(user, storedLodging, body);

  const storedDirectory = (await getDirectoryListingsAdmin()).find((d) => d.id === id);
  if (storedDirectory) return putDirectory(user, storedDirectory, body);

  return NextResponse.json({ error: "Listing not found" }, { status: 404 });
}

/* -------------------------------- directory ------------------------------- */

// E16/E17: the imported-members domain. Members edit contact facts and free
// text (description, address, phone, website, tags); name and the category
// (which /map bucket and future directory section the listing files under)
// stay Chamber-controlled, mirroring lodging's name/type rule.
//
// THE STATUS BRANCH is the part that differs from the siblings above: a
// directory DRAFT has never been public, so its owner iterates on it freely
// — the direct save preserves draft status (writeRecord would otherwise
// reset it to live: the E17 upsert rule) and the moderation floor is the
// PUBLISH act, which stays an explicit admin decision. Once a listing is
// live, edits hold for review exactly like restaurants and lodging.
type StoredDirectory = Awaited<ReturnType<typeof getDirectoryListingsAdmin>>[number];

async function putDirectory(
  user: AuthSubject,
  stored: StoredDirectory,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  if (!can(user, "edit-record", stored.id)) {
    return NextResponse.json({ error: "You don't manage this listing" }, { status: 403 });
  }

  // Strip the surfaced status before the doc is rebuilt — it is governance,
  // not record content, and must never land inside the stored document.
  const { status, ...storedDoc } = stored;
  const next: DirectoryListing = { ...storedDoc };

  // Description — only overwrite with a non-empty value (imported drafts
  // start empty; saving other fields must not be blocked by that).
  if (typeof body.description === "string" && body.description.trim()) {
    next.description = body.description.trim();
  }

  // Optional text fields — an empty string clears them.
  for (const key of ["address", "phone", "website"] as const) {
    const v = body[key];
    if (typeof v === "string") next[key] = v.trim() || undefined;
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

  // Chamber-only corrections: display name and the category bucket.
  if (user.role === "admin") {
    if (typeof body.name === "string" && body.name.trim()) next.name = body.name.trim();
    if ("category" in body) {
      const v = body.category;
      if (
        typeof v !== "string" ||
        !(DIRECTORY_CATEGORIES as readonly string[]).includes(v)
      ) {
        return NextResponse.json(
          { error: `category must be one of: ${DIRECTORY_CATEGORIES.join(", ")}` },
          { status: 400 },
        );
      }
      next.category = v as DirectoryListing["category"];
    }
  }

  next.id = stored.id; // belt and braces — never client-controlled
  // Import provenance (sourceCategories/sourceImages) rides through the
  // {...storedDoc} spread untouched — same guarantee the admin surface makes.

  const checked = directoryListingSchema.safeParse(next);
  if (!checked.success) {
    return NextResponse.json({ error: firstZodMessage(checked.error) }, { status: 400 });
  }

  const isDraft = status !== "live";
  try {
    if (user.role === "admin") {
      // Same rule as the admin workbench: preserve status — publishing is an
      // explicit decision, never a side effect of an edit.
      await saveDirectoryListing(next, { actor: user.email, source: "admin", status });
    } else if (isDraft) {
      // Never public → no hold. The member's own email lands in updated_by,
      // which also (correctly) ends importer refresh rights over the record.
      await saveDirectoryListing(next, { actor: user.email, source: "portal", status });
    } else {
      // MODERATION FLOOR (E08): the live listing keeps serving untouched —
      // the full proposed revision waits in the worklist for Chamber review.
      await holdEditProposal("directory", next, next.name, user);
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
      : isDraft
        ? { ok: true, listing: next, draft: true }
        : { ok: true, listing: next, pending: true },
  );
}

/* ------------------------------- restaurants ------------------------------ */

async function putRestaurant(
  user: AuthSubject,
  stored: Restaurant,
  body: Record<string, unknown>,
): Promise<NextResponse> {
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

/* --------------------------------- lodging -------------------------------- */

// The member-editable field set deliberately mirrors the restaurant precedent:
// free text and link fields only. The lodging schema has no phone or hours
// fields, so none are offered; name and the type classification (which section
// of /stay the listing files under) stay Chamber-controlled, exactly as name
// and map placement do for restaurants. Access facts are Chamber-verified by
// charter (src/lib/schemas/access.ts) and are not member-editable either —
// same as restaurants, whose portal whitelist omits them.
async function putLodging(
  user: AuthSubject,
  stored: Lodging,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  if (!can(user, "edit-record", stored.id)) {
    return NextResponse.json({ error: "You don't manage this listing" }, { status: 403 });
  }

  const next: Lodging = { ...stored };

  // Required text — only overwrite with a non-empty value.
  if (typeof body.description === "string" && body.description.trim()) {
    next.description = body.description.trim();
  }

  // Optional text fields — an empty string clears them.
  for (const key of ["address", "website", "bookingUrl"] as const) {
    const v = body[key];
    if (typeof v === "string") next[key] = v.trim() || undefined;
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

  // Chamber-only correction: the display name (type stays workbench-only).
  if (user.role === "admin") {
    if (typeof body.name === "string" && body.name.trim()) next.name = body.name.trim();
  }

  next.id = stored.id; // belt and braces — never client-controlled
  next.type = stored.type; // classification is Chamber-controlled

  // Belt-and-braces (E07): the merged record must satisfy the shared schema
  // before it lands in the store. `next` itself is saved, so unlisted stored
  // fields (e.g. access facts) ride through untouched.
  const checked = lodgingSchema.safeParse(next);
  if (!checked.success) {
    return NextResponse.json({ error: firstZodMessage(checked.error) }, { status: 400 });
  }

  try {
    if (user.role === "admin") {
      await saveLodging(next, { actor: user.email, source: "admin" });
    } else {
      // MODERATION FLOOR (E08): the live listing keeps serving untouched —
      // the full proposed revision waits in the worklist for Chamber review.
      await holdEditProposal("lodging", next, next.name, user);
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
