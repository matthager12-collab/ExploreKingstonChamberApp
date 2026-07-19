// Admin content-records API — one endpoint for the remaining seed-backed
// content domains: itineraries, lodging, webcams, and restaurants. Backs the
// /admin/itineraries builder and the /admin/listings workbench.
//
// GET    ?domain=itineraries|lodging|webcams|restaurants  — merged records.
// POST   { domain, record }                   — validate minimally, save.
// DELETE ?domain=X&id=Y                        — tombstone (hides seed too).
//
// 401 signed out · 403 signed in but not admin. The /admin layout gates the
// editor UI; these handlers re-check because API routes bypass layouts.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import type { Itinerary, ItineraryStop, Lodging, Restaurant, Webcam } from "@/lib/types";
import {
  deleteItinerary,
  getItineraries,
  saveItinerary,
} from "@/lib/stores/itinerary-store";
import {
  deleteLodging,
  deleteWebcam,
  getLodging,
  getWebcams,
  saveLodging,
  saveWebcam,
} from "@/lib/stores/listing-stores";
import {
  deleteRestaurant,
  getRestaurant,
  getRestaurants,
  saveRestaurant,
} from "@/lib/stores/business-store";
import { RecordValidationError } from "@/lib/db/store-schemas";

export const dynamic = "force-dynamic";

const DOMAINS = ["itineraries", "lodging", "webcams", "restaurants"] as const;
type Domain = (typeof DOMAINS)[number];

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/* ------------------------------ small helpers ------------------------------ */

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function optStr(v: unknown): string | undefined {
  const s = str(v);
  return s || undefined;
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter(Boolean);
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

function httpUrl(v: unknown): string | undefined {
  const s = str(v);
  return /^https?:\/\//.test(s) ? s : undefined;
}

function bad(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 400 });
}

function parseDomain(v: string | null): Domain | null {
  return DOMAINS.includes(v as Domain) ? (v as Domain) : null;
}

/* --------------------------- per-domain sanitizers -------------------------- */
// Each returns the cleaned record, or a string error message. Records are
// rebuilt from known fields so arbitrary JSON never lands in the overlay.

async function sanitizeItinerary(
  body: Record<string, unknown>,
): Promise<Itinerary | string> {
  const id = str(body.id);
  if (!ID_RE.test(id)) return "id required: letters, numbers, and dashes (max 64 chars)";
  const slug = str(body.slug).toLowerCase();
  if (!SLUG_RE.test(slug)) {
    return "slug required: lowercase letters, numbers, and dashes (e.g. beach-day)";
  }
  const title = str(body.title);
  if (!title) return "title required";
  if (!Array.isArray(body.stops) || body.stops.length === 0) {
    return "at least one stop required";
  }

  const stops: ItineraryStop[] = [];
  for (let i = 0; i < body.stops.length; i++) {
    const raw = body.stops[i];
    if (!raw || typeof raw !== "object") return `stop ${i + 1} is malformed`;
    const s = raw as Record<string, unknown>;
    const stopTitle = str(s.title);
    if (!stopTitle) return `stop ${i + 1} needs a title`;
    const mapQuery = optStr(s.mapQuery);
    stops.push({
      time: str(s.time),
      title: stopTitle,
      description: str(s.description),
      ...(mapQuery ? { mapQuery } : {}),
    });
  }

  const mode = str(body.mode);
  if (!["walk-on", "car", "either"].includes(mode)) {
    return "mode must be walk-on, car, or either";
  }

  // Don't let two live records share a slug — getItinerary(slug) would only
  // ever find one of them.
  const clash = (await getItineraries()).find((i) => i.slug === slug && i.id !== id);
  if (clash) return `slug "${slug}" is already used by "${clash.title}"`;

  return {
    id,
    slug,
    title,
    tagline: str(body.tagline),
    duration: str(body.duration),
    mode: mode as Itinerary["mode"],
    audience: strArray(body.audience),
    stops,
  };
}

const LODGING_TYPES: Lodging["type"][] = [
  "hotel",
  "vacation-rental",
  "bnb",
  "camping",
  "marina",
];

function sanitizeLodging(body: Record<string, unknown>): Lodging | string {
  const id = str(body.id);
  if (!ID_RE.test(id)) return "id required: letters, numbers, and dashes (max 64 chars)";
  const name = str(body.name);
  if (!name) return "name required";
  const type = str(body.type) as Lodging["type"];
  if (!LODGING_TYPES.includes(type)) {
    return `type must be one of: ${LODGING_TYPES.join(", ")}`;
  }
  const address = optStr(body.address);
  const website = httpUrl(body.website);
  const bookingUrl = httpUrl(body.bookingUrl);
  return {
    id,
    name,
    type,
    description: str(body.description),
    ...(address ? { address } : {}),
    ...(website ? { website } : {}),
    ...(bookingUrl ? { bookingUrl } : {}),
    tags: strArray(body.tags),
  };
}

function sanitizeWebcam(body: Record<string, unknown>): Webcam | string {
  const id = str(body.id);
  if (!ID_RE.test(id)) return "id required: letters, numbers, and dashes (max 64 chars)";
  const name = str(body.name);
  if (!name) return "name required";
  const imageUrl = httpUrl(body.imageUrl);
  if (!imageUrl) return "imageUrl must be an http(s) URL to a still image";
  const sourceUrl = httpUrl(body.sourceUrl);
  if (!sourceUrl) return "sourceUrl must be an http(s) URL (credit/link-back page)";
  const refreshSeconds = Math.round(num(body.refreshSeconds));
  if (!Number.isFinite(refreshSeconds) || refreshSeconds < 15 || refreshSeconds > 3600) {
    return "refreshSeconds must be a number between 15 and 3600";
  }
  return {
    id,
    name,
    location: str(body.location),
    imageUrl,
    sourceUrl,
    source: str(body.source),
    refreshSeconds,
  };
}

const ORDERING_PLATFORMS: NonNullable<Restaurant["orderingPlatform"]>[] = [
  "toast",
  "square",
  "doordash",
  "own-site",
  "phone-only",
];

// Restaurants carry structured fields the schema editor doesn't expose
// (weeklyHours, hoursVerified). Rebuild the record from the form's known
// fields, then carry those hidden fields over from the existing record so
// editing a description never silently wipes the live "Open now" badge.
async function sanitizeRestaurant(
  body: Record<string, unknown>,
): Promise<Restaurant | string> {
  const id = str(body.id);
  if (!ID_RE.test(id)) return "id required: letters, numbers, and dashes (max 64 chars)";
  const name = str(body.name);
  if (!name) return "name required";
  const cuisine = str(body.cuisine);
  if (!cuisine) return "cuisine required";
  const address = str(body.address);
  if (!address) return "address required";

  const priceLevel = Math.round(num(body.priceLevel));
  if (priceLevel !== 1 && priceLevel !== 2 && priceLevel !== 3) {
    return "priceLevel must be 1, 2, or 3";
  }

  const lat = num(body.lat);
  const lng = num(body.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return "lat must be between -90 and 90";
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return "lng must be between -180 and 180";
  }
  const walk = Math.round(num(body.walkMinutesFromFerry));
  if (!Number.isFinite(walk) || walk < 0 || walk > 120) {
    return "walk minutes must be a number between 0 and 120";
  }

  let orderingPlatform: Restaurant["orderingPlatform"] | undefined;
  const platform = str(body.orderingPlatform);
  if (platform) {
    if (!(ORDERING_PLATFORMS as string[]).includes(platform)) {
      return `orderingPlatform must be one of: ${ORDERING_PLATFORMS.join(", ")}`;
    }
    orderingPlatform = platform as Restaurant["orderingPlatform"];
  }

  // Preserve structured hours the form can't edit.
  const existing = await getRestaurant(id);

  return {
    id,
    name,
    cuisine,
    description: str(body.description),
    address,
    ...(optStr(body.phone) ? { phone: optStr(body.phone) } : {}),
    ...(httpUrl(body.website) ? { website: httpUrl(body.website) } : {}),
    ...(httpUrl(body.menuUrl) ? { menuUrl: httpUrl(body.menuUrl) } : {}),
    ...(httpUrl(body.orderingUrl) ? { orderingUrl: httpUrl(body.orderingUrl) } : {}),
    ...(orderingPlatform ? { orderingPlatform } : {}),
    ...(optStr(body.hours) ? { hours: optStr(body.hours) } : {}),
    ...(existing?.weeklyHours ? { weeklyHours: existing.weeklyHours } : {}),
    ...(existing?.hoursVerified ? { hoursVerified: existing.hoursVerified } : {}),
    priceLevel,
    tags: strArray(body.tags),
    lat,
    lng,
    walkMinutesFromFerry: walk,
    ...(body.hidden ? { hidden: true } : {}),
  };
}

/* --------------------------------- handlers -------------------------------- */

export async function GET(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const domain = parseDomain(request.nextUrl.searchParams.get("domain"));
  if (!domain) return bad(`domain must be one of: ${DOMAINS.join(", ")}`);

  const records =
    domain === "itineraries"
      ? await getItineraries()
      : domain === "lodging"
        ? await getLodging()
        : domain === "webcams"
          ? await getWebcams()
          : await getRestaurants();

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

  const domain = parseDomain(str(body.domain) || null);
  if (!domain) return bad(`domain must be one of: ${DOMAINS.join(", ")}`);
  if (!body.record || typeof body.record !== "object") return bad("record required");
  const raw = body.record as Record<string, unknown>;

  const meta = { actor, source: "admin" } as const;
  try {
    if (domain === "itineraries") {
      const record = await sanitizeItinerary(raw);
      if (typeof record === "string") return bad(record);
      await saveItinerary(record, meta);
      return NextResponse.json({ ok: true, record });
    }
    if (domain === "lodging") {
      const record = sanitizeLodging(raw);
      if (typeof record === "string") return bad(record);
      await saveLodging(record, meta);
      return NextResponse.json({ ok: true, record });
    }
    if (domain === "restaurants") {
      const record = await sanitizeRestaurant(raw);
      if (typeof record === "string") return bad(record);
      await saveRestaurant(record, meta);
      return NextResponse.json({ ok: true, record });
    }
    const record = sanitizeWebcam(raw);
    if (typeof record === "string") return bad(record);
    await saveWebcam(record, meta);
    return NextResponse.json({ ok: true, record });
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

  const records: { id: string }[] =
    domain === "itineraries"
      ? await getItineraries()
      : domain === "lodging"
        ? await getLodging()
        : domain === "webcams"
          ? await getWebcams()
          : await getRestaurants();
  if (!records.some((r) => r.id === id)) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  const meta = { actor, source: "admin" } as const;
  try {
    if (domain === "itineraries") await deleteItinerary(id, meta);
    else if (domain === "lodging") await deleteLodging(id, meta);
    else if (domain === "webcams") await deleteWebcam(id, meta);
    else await deleteRestaurant(id, meta);
  } catch (err) {
    if (err instanceof RecordValidationError) return bad(err.message);
    throw err;
  }

  return NextResponse.json({ ok: true });
}
