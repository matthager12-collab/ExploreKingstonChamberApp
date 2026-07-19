// Player photo submission → the check-off endpoint.
//
// POST multipart/form-data: photo (File), huntId, stopId, lat?, lng?
// Responds { ok: true, verified, distanceMeters }.
//
// Decision: verified = coords were sent AND the haversine distance from the
// player to the stop is within the stop's radiusMeters. No/denied GPS still
// accepts the photo, just with verified: false (honor system). The photo and
// coords are stored under .data/hunts for admin review — player-facing copy
// discloses this. Local-only app — no auth; see /api/hunts/route.ts.

import { NextRequest } from "next/server";
import { hasBlob } from "@/lib/blob-store";
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTO_STORAGE_BYTES,
  getHuntById,
  imageExtension,
  photoStorageBytes,
  saveSubmission,
} from "@/lib/hunt-store";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { createWorklistItem } from "@/lib/stores/worklist-store";

export async function POST(request: NextRequest) {
  const limit = await checkRateLimit(clientKey(request, "hunt-submit"), {
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (!limit.ok) {
    return Response.json(
      { ok: false, error: "too many uploads, please try again later" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  // Filesystem mode shares one disk across all app state (see docs/OPERATIONS.md
  // "Abuse response"); Blob-backed storage has no such quota to enforce here.
  if (!hasBlob() && (await photoStorageBytes()) > MAX_PHOTO_STORAGE_BYTES) {
    return Response.json(
      {
        ok: false,
        error: "photo storage is full — submissions are paused until the Chamber clears space",
      },
      { status: 507 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, error: "expected multipart/form-data" }, { status: 400 });
  }

  const photo = form.get("photo");
  const huntId = form.get("huntId");
  const stopId = form.get("stopId");
  if (!(photo instanceof File) || typeof huntId !== "string" || typeof stopId !== "string") {
    return Response.json(
      { ok: false, error: "photo, huntId, and stopId are required" },
      { status: 400 },
    );
  }

  if (photo.size === 0) {
    return Response.json({ ok: false, error: "empty photo" }, { status: 400 });
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    return Response.json({ ok: false, error: "photo too large (max 8 MB)" }, { status: 413 });
  }
  const ext = imageExtension(photo.type, photo.name);
  if (!ext) {
    return Response.json(
      { ok: false, error: "unsupported image type (jpeg, png, webp, or heic only)" },
      { status: 415 },
    );
  }

  const lat = parseCoord(form.get("lat"), 90);
  const lng = parseCoord(form.get("lng"), 180);

  try {
    const submission = await saveSubmission(
      {
        huntId,
        stopId,
        photo: new Uint8Array(await photo.arrayBuffer()),
        ext,
        lat,
        lng,
      },
      { actor: "public", source: "public" },
    );
    // E08: photo review joins the unified worklist. The photo itself never
    // renders publicly (storage and response are unchanged) — the item puts
    // it in the same queue as everything else the Chamber reviews. Best
    // effort: a queue hiccup must not fail the player's check-off.
    try {
      const hunt = await getHuntById(huntId);
      await createWorklistItem(
        {
          type: "moderation",
          subjectStore: "hunt-submissions",
          subjectId: submission.id ?? `${huntId}/${stopId}`,
          subjectLabel: `Hunt photo — ${hunt?.title ?? huntId} / ${stopId}`,
          payload: { kind: "new", note: submission.verified ? "GPS-verified" : "Unverified (no GPS)" },
        },
        { actor: "public", source: "public" },
      );
    } catch (queueErr) {
      console.error("hunt-submit: worklist enqueue failed", queueErr);
    }
    return Response.json({
      ok: true,
      verified: submission.verified,
      distanceMeters: submission.distanceMeters ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "could not save submission";
    const status = message.includes("not found") ? 404 : 400;
    return Response.json({ ok: false, error: message }, { status });
  }
}

function parseCoord(value: FormDataEntryValue | null, bound: number): number | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= bound ? n : undefined;
}
