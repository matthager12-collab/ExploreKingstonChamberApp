// Admin content-records API — one endpoint for the remaining seed-backed
// content domains: itineraries, lodging, webcams, and restaurants. Backs the
// /admin/itineraries builder and the /admin/listings workbench.
//
// GET    ?domain=itineraries|lodging|webcams|restaurants  — merged records.
// POST   { domain, record }                   — validate via the domain schema, save.
// DELETE ?domain=X&id=Y                        — tombstone (hides seed too).
//
// Validation lives in src/lib/schemas (E07, vk/domain-schemas) — the same
// schemas the admin editors parse with, so the two halves can't drift again.
// The two rules that need store reads stay here, not in zod: the itinerary
// slug-clash check and the restaurant structured-hours carry-over.
//
// 401 signed out · 403 signed in but not admin. The /admin layout gates the
// editor UI; these handlers re-check because API routes bypass layouts.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import {
  deleteItinerary,
  getItineraries,
  getItinerariesAdmin,
  saveItinerary,
} from "@/lib/stores/itinerary-store";
import {
  deleteLodging,
  deleteWebcam,
  getLodgingAdmin,
  getWebcamsAdmin,
  saveLodging,
  saveWebcam,
} from "@/lib/stores/listing-stores";
import {
  deleteRestaurant,
  getRestaurant,
  getRestaurantsAdmin,
  saveRestaurant,
} from "@/lib/stores/business-store";
import {
  deleteDirectoryListing,
  getDirectoryListingsAdmin,
  saveDirectoryListing,
} from "@/lib/stores/directory-store";
import { RecordValidationError } from "@/lib/db/store-schemas";
import {
  directoryListingSchema,
  findItinerarySlugClash,
  firstZodMessage,
  itinerarySchema,
  lodgingSchema,
  restaurantSchema,
  trimOrEmpty,
  webcamSchema,
} from "@/lib/schemas";

export const dynamic = "force-dynamic";

const DOMAINS = ["itineraries", "lodging", "webcams", "restaurants", "directory"] as const;
type Domain = (typeof DOMAINS)[number];

function bad(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 400 });
}

function parseDomain(v: string | null): Domain | null {
  return DOMAINS.includes(v as Domain) ? (v as Domain) : null;
}

/* --------------------------------- handlers -------------------------------- */

export async function GET(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const domain = parseDomain(request.nextUrl.searchParams.get("domain"));
  if (!domain) return bad(`domain must be one of: ${DOMAINS.join(", ")}`);

  // Admin read (E08): pending/draft records included, status surfaced.
  const records =
    domain === "itineraries"
      ? await getItinerariesAdmin()
      : domain === "lodging"
        ? await getLodgingAdmin()
        : domain === "webcams"
          ? await getWebcamsAdmin()
          : domain === "directory"
            ? await getDirectoryListingsAdmin()
            : await getRestaurantsAdmin();

  return NextResponse.json({ records });
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
    return bad("Invalid request body");
  }

  const domain = parseDomain(trimOrEmpty(body.domain) || null);
  if (!domain) return bad(`domain must be one of: ${DOMAINS.join(", ")}`);
  // Array.isArray guard: arrays pass typeof === "object" and would surface
  // zod's raw "expected object, received array" — a message no operator
  // should ever see.
  if (!body.record || typeof body.record !== "object" || Array.isArray(body.record)) {
    return bad("record required");
  }
  const raw = body.record as Record<string, unknown>;

  const meta = { actor, source: "admin" } as const;
  try {
    if (domain === "itineraries") {
      const parsed = itinerarySchema.safeParse(raw);
      if (!parsed.success) return bad(firstZodMessage(parsed.error));
      const record = parsed.data;
      // Don't let two live records share a slug — getItinerary(slug) would
      // only ever find one of them.
      const clash = findItinerarySlugClash(await getItineraries(), record);
      if (clash) return bad(`slug "${record.slug}" is already used by "${clash.title}"`);
      await saveItinerary(record, meta);
      return NextResponse.json({ ok: true, record });
    }
    if (domain === "lodging") {
      const parsed = lodgingSchema.safeParse(raw);
      if (!parsed.success) return bad(firstZodMessage(parsed.error));
      await saveLodging(parsed.data, meta);
      return NextResponse.json({ ok: true, record: parsed.data });
    }
    if (domain === "directory") {
      const parsed = directoryListingSchema.safeParse(raw);
      if (!parsed.success) return bad(firstZodMessage(parsed.error));
      const record = parsed.data;
      const existing = (await getDirectoryListingsAdmin()).find(
        (r) => r.id === record.id,
      );
      // The form doesn't carry import provenance — carry the stored values
      // over so an admin edit never wipes them (mirrors the restaurant
      // structured-hours carry-over above).
      if (existing?.sourceCategories) record.sourceCategories = existing.sourceCategories;
      if (existing?.sourceImages) record.sourceImages = existing.sourceImages;
      // Unlike the other domains, draft is this store's NORMAL state (the
      // imported pile). Preserve the record's status on edit — publishing is
      // an explicit decision, not a side effect of fixing a typo. New
      // admin-created records publish directly (E08 admin semantics).
      await saveDirectoryListing(record, {
        ...meta,
        status: existing?.status ?? "live",
      });
      return NextResponse.json({ ok: true, record });
    }
    if (domain === "restaurants") {
      // The form can't edit structured hours, and this endpoint has never read
      // them from the request — drop them before validation, then carry the
      // stored values over so an edit never wipes the live "Open now" badge.
      const formFields = { ...raw };
      delete formFields.weeklyHours;
      delete formFields.hoursVerified;
      const parsed = restaurantSchema.safeParse(formFields);
      if (!parsed.success) return bad(firstZodMessage(parsed.error));
      const record = parsed.data;
      const existing = await getRestaurant(record.id);
      if (existing?.weeklyHours) record.weeklyHours = existing.weeklyHours;
      if (existing?.hoursVerified) record.hoursVerified = existing.hoursVerified;
      await saveRestaurant(record, meta);
      return NextResponse.json({ ok: true, record });
    }
    const parsed = webcamSchema.safeParse(raw);
    if (!parsed.success) return bad(firstZodMessage(parsed.error));
    await saveWebcam(parsed.data, meta);
    return NextResponse.json({ ok: true, record: parsed.data });
  } catch (err) {
    if (err instanceof RecordValidationError) return bad(err.message);
    throw err;
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const actor = (await getSessionUser())!.email;

  const domain = parseDomain(request.nextUrl.searchParams.get("domain"));
  if (!domain) return bad(`domain must be one of: ${DOMAINS.join(", ")}`);
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return bad("id required");

  // Admin read (E08): an admin must be able to tombstone a pending record too.
  const records: { id: string }[] =
    domain === "itineraries"
      ? await getItinerariesAdmin()
      : domain === "lodging"
        ? await getLodgingAdmin()
        : domain === "webcams"
          ? await getWebcamsAdmin()
          : domain === "directory"
            ? await getDirectoryListingsAdmin()
            : await getRestaurantsAdmin();
  if (!records.some((r) => r.id === id)) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  const meta = { actor, source: "admin" } as const;
  try {
    if (domain === "itineraries") await deleteItinerary(id, meta);
    else if (domain === "lodging") await deleteLodging(id, meta);
    else if (domain === "webcams") await deleteWebcam(id, meta);
    else if (domain === "directory") await deleteDirectoryListing(id, meta);
    else await deleteRestaurant(id, meta);
  } catch (err) {
    if (err instanceof RecordValidationError) return bad(err.message);
    throw err;
  }

  return NextResponse.json({ ok: true });
}
