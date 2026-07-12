// Admin: attach a reference photo ("what the spot looks like") to a stop.
//
// POST multipart/form-data: photo (File), huntId, stopId
// Saves .data/hunts/refs/<huntId>-<stopId>.<ext> and points the hunt record's
// stop.referencePhoto at it (materializing a seed hunt into custom-hunts.json
// if needed). Admin-only (this writes hunt content); players only reach
// /api/hunts/submit.

import { NextRequest } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import { MAX_PHOTO_BYTES, imageExtension, photoUrl, saveReferencePhoto } from "@/lib/hunt-store";

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const user = await getSessionUser();

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

  try {
    const relPath = await saveReferencePhoto(
      huntId,
      stopId,
      new Uint8Array(await photo.arrayBuffer()),
      ext,
      { actor: user?.email, source: "admin" },
    );
    return Response.json({
      ok: true,
      referencePhoto: relPath,
      referencePhotoUrl: photoUrl(relPath),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "could not save reference photo";
    const status = message.includes("not found") ? 404 : 400;
    return Response.json({ ok: false, error: message }, { status });
  }
}
