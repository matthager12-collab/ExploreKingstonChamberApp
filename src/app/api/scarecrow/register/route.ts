// Scarecrow Crawl — a business registers its scarecrow.
//
// POST JSON: { title, creator, notes, lat?, lng?, submitterName, contact, website2 }
// Responds { ok: true }. Nothing goes live: the submission is HELD as a
// pending marker on the crawl map view, with a moderation item in the
// Worklist, through holdSuggestedRecord — the same anonymous hold E12 event
// suggestions use. An admin approving it is what puts the pin on the trail
// and the name on the ballot; until then every public read skips it.
//
// No account. The gates, in order, none of which the client can talk past:
//   - rate limit, 5 an hour per connection, before anything else is read;
//   - the page is visible (a hidden crawl takes no registrations);
//   - registration window: closes when the crawl opens, by the SERVER's clock;
//   - declared body size, before parsing;
//   - honeypot, answered with a bland 200 and nothing stored;
//   - every field required and length-capped; coordinates, if given, inside
//     greater Kingston (same box as /api/admin/map-features).
//
// THE SERVER MAKES THE ID. A marker is upserted by id, so an id taken from the
// request could overwrite a live pin on any map. The public also cannot send a
// link, an image, a category or a view: those are fixed here.

import { randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import {
  CRAWL_MAP_CENTER,
  CRAWL_VIEW_ID,
  REGISTRATION_LIMITS,
  registrationOpen,
} from "@/lib/data/scarecrows";
import type { MapFeature } from "@/lib/map/types";
import { holdSuggestedRecord } from "@/lib/moderation";
import { getEffectiveHiddenPaths } from "@/lib/page-visibility";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Five short text fields as JSON never come near this; it bounds the parse. */
const MAX_BODY_BYTES = 8 * 1024;

// Greater Kingston, WA — the box /api/admin/map-features enforces on every
// marker, so a registration cannot hold a point the map editor would refuse.
const LAT_MIN = 47.5;
const LAT_MAX = 48.1;
const LNG_MIN = -123;
const LNG_MAX = -122.2;

function text(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === "string" ? v.trim() : "";
}

/** A map-feature id from the scarecrow's name plus a random tail, so two
 *  "Scarecrow" registrations never collide and no guess reaches an existing
 *  pin. Fits the store's 64-char id rule. */
function newFeatureId(title: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "entry";
  return `scarecrow-${slug}-${randomUUID().slice(0, 8)}`;
}

export async function POST(request: NextRequest) {
  const limit = await checkRateLimit(clientKey(request, "scarecrow-register"), {
    limit: 5,
    windowMs: 60 * 60_000,
  });
  if (!limit.ok) {
    return Response.json(
      { ok: false, error: "too many registrations from here — try again later" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  // After the rate limit, so an unthrottled client cannot drive a database
  // read per request just by hammering a hidden page.
  if ((await getEffectiveHiddenPaths()).includes("/scarecrow")) {
    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  }

  if (!registrationOpen()) {
    return Response.json(
      {
        ok: false,
        error:
          "registration closed when the crawl opened on 17 October — contact the Chamber directly",
      },
      { status: 403 },
    );
  }

  const declaredBytes = Number(request.headers.get("content-length"));
  if (!Number.isInteger(declaredBytes) || declaredBytes <= 0) {
    return Response.json({ ok: false, error: "missing request length" }, { status: 411 });
  }
  if (declaredBytes > MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: "registration too large" }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "invalid request body" }, { status: 400 });
  }

  // Honeypot: a field humans never see. A filled one gets a bland success so a
  // bot learns nothing, and nothing is stored.
  if (text(body, "website2") !== "") {
    return Response.json({ ok: true });
  }

  const title = text(body, "title");
  const creator = text(body, "creator");
  const notes = text(body, "notes");
  const submitterName = text(body, "submitterName");
  const contact = text(body, "contact");

  const missing: [string, string, number][] = [
    [title, "the scarecrow's name", REGISTRATION_LIMITS.title],
    [creator, "the business or maker", REGISTRATION_LIMITS.creator],
    [notes, "where to find it", REGISTRATION_LIMITS.notes],
    [submitterName, "your name", REGISTRATION_LIMITS.submitterName],
    [contact, "an email or phone number for the Chamber", REGISTRATION_LIMITS.contact],
  ];
  for (const [value, label, max] of missing) {
    if (!value) {
      return Response.json({ ok: false, error: `${label} is required` }, { status: 400 });
    }
    if (value.length > max) {
      return Response.json(
        { ok: false, error: `${label} must be ${max} characters or fewer` },
        { status: 400 },
      );
    }
  }

  // Coordinates are optional; if given, both must be real numbers inside
  // greater Kingston. Without them the pin waits on CRAWL_MAP_CENTER, which
  // the public map treats as "not placed yet" and leaves off.
  // A copy, never the constant itself: the feature object travels on through
  // the store, and nothing downstream should be able to move the placeholder.
  let point: [number, number] = [CRAWL_MAP_CENTER[0], CRAWL_MAP_CENTER[1]];
  const hasLat = body.lat !== undefined && body.lat !== null && body.lat !== "";
  const hasLng = body.lng !== undefined && body.lng !== null && body.lng !== "";
  if (hasLat || hasLng) {
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (
      !hasLat ||
      !hasLng ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < LAT_MIN ||
      lat > LAT_MAX ||
      lng < LNG_MIN ||
      lng > LNG_MAX
    ) {
      return Response.json(
        {
          ok: false,
          error: "those coordinates aren't in the Kingston area — leave them blank and the Chamber will place the pin",
        },
        { status: 400 },
      );
    }
    point = [lat, lng];
  }

  const feature: MapFeature = {
    id: newFeatureId(title),
    kind: "marker",
    title,
    creator,
    notes,
    category: "event",
    views: [CRAWL_VIEW_ID],
    point,
  };

  try {
    await holdSuggestedRecord("map-features", feature, `Scarecrow registration — ${title}`, {
      submitterName,
      contact,
    });
  } catch (err) {
    console.error("scarecrow-register: could not hold the registration", err);
    return Response.json(
      { ok: false, error: "your registration could not be saved — please try again" },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
}
