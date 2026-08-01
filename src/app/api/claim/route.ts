// E17 claim-request intake (M-10-03 / FR-A96): the public "own this
// business?" loop. POST { store, id, businessName?, contactName, contact,
// message? } — a request grants NOTHING: no session, no cookie, no account,
// no edit rights (there is deliberately no open self-claim). It opens (or
// merges into) ONE claim_request worklist item; the Chamber verifies
// out-of-band (call the listed number) and mints a bound invite from the
// claims console.
//
// Existence is checked through the PUBLIC (live-only) store reads on
// purpose: a draft or pending record 404s exactly like a nonexistent one,
// so this route can never be used as an oracle for unpublished content.
//
// Rate limiting copies the redeem/report dual-bucket pattern: an IP bucket
// BEFORE the body parse, then a per-(store,id) bucket so one hot listing
// can't eat a shared IP's whole budget (and one spammer can't bury one
// listing's queue entry).

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { getCharities } from "@/lib/stores/charity-store";
import { getDirectoryListings } from "@/lib/stores/directory-store";
import { getLodging } from "@/lib/stores/listing-stores";
import { getRestaurants } from "@/lib/stores/business-store";
import { createWorklistItem } from "@/lib/stores/worklist-store";
import {
  validateWorklistPayload,
  WorklistValidationError,
} from "@/lib/schemas/worklist";

export const dynamic = "force-dynamic";

/** Closed allowlist of claimable stores, each mapped to its PUBLIC getter.
 *  Anything else — including real stores like events or auth-users — is a
 *  400, not a lookup. */
const CLAIMABLE_STORES: Record<string, () => Promise<{ id: string; name: string }[]>> = {
  restaurants: getRestaurants,
  lodging: getLodging,
  charities: getCharities,
  directory: getDirectoryListings,
};

function tooMany(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "too many requests, please try again later" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

export async function POST(request: NextRequest) {
  const ipLimit = await checkRateLimit(clientKey(request, "claim"), {
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (!ipLimit.ok) return tooMany(ipLimit.retryAfterSeconds);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const store = typeof body.store === "string" ? body.store : "";
  const id = str(body.id);
  const businessName = str(body.businessName);
  const contactName = str(body.contactName);
  const contact = str(body.contact);
  const message = str(body.message);

  const getPublic = CLAIMABLE_STORES[store];
  if (!getPublic) {
    return NextResponse.json({ error: "unknown store" }, { status: 400 });
  }
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Required fields + length caps come from the ONE claim_request schema
  // (E07 single-schema rule) — the parsed result is the payload we store.
  let payload: Record<string, unknown>;
  try {
    payload = validateWorklistPayload("claim_request", {
      store,
      id,
      ...(businessName ? { businessName } : {}),
      contactName,
      contact,
      ...(message ? { message } : {}),
      count: 1,
    });
  } catch (err) {
    if (err instanceof WorklistValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  // Per-listing bucket AFTER the parse (redeem-route pattern).
  const recordLimit = await checkRateLimit(`claim:${store}:${id}`, {
    limit: 10,
    windowMs: 60 * 60_000,
  });
  if (!recordLimit.ok) return tooMany(recordLimit.retryAfterSeconds);

  // PUBLIC read: drafts, pending, and tombstoned records 404 exactly like
  // ids that never existed (fail-closed — no draft oracle).
  const subject = (await getPublic()).find((r) => r.id === id);
  if (!subject) {
    return NextResponse.json({ error: "record not found" }, { status: 404 });
  }

  try {
    // At most one open item per (store, id): a repeat request merges —
    // count increments, requester fields update to the latest (the
    // claim_request branch of mergePayloads; the partial unique index
    // backstops concurrent creates).
    await createWorklistItem(
      {
        type: "claim_request",
        subjectStore: store,
        subjectId: id,
        subjectLabel: subject.name || id,
        payload,
      },
      { actor: "public", source: "public" },
    );
  } catch (err) {
    if (err instanceof WorklistValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  // A request grants nothing — acknowledge receipt, set no cookie.
  return NextResponse.json({ ok: true, pending: true });
}
