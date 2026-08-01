// Admin media-library API — backs /admin/media.
//
// GET            — every library item, newest first.
// POST           — multipart upload. One "image" file per request; the client
//                  loops for multi-select so one bad file in a batch doesn't
//                  sink the rest. Optional "title"/"alt"/"credit" text fields.
// PATCH          — edit an existing item's title/alt/credit (metadata only;
//                  bytes are immutable because the name IS their hash).
// DELETE ?id=X   — tombstone the item. Bytes are deliberately retained so an
//                  audit-log restore can bring the row back intact.
//
// 401 signed out · 403 signed in but not admin. The /admin layout gates the UI;
// these handlers re-check because API routes bypass layouts.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import { UnstrippableImageError } from "@/lib/image-sanitize";
import {
  deleteMediaItem,
  getMediaItem,
  getMediaItems,
  saveMediaImage,
  saveMediaItem,
  type MediaItem,
} from "@/lib/stores/media-store";
import { MAX_MEDIA_BYTES, MEDIA_TYPE_EXT } from "@/lib/media/refs";
import { todayPacific } from "@/lib/time";

/** Trim, collapse whitespace, and cap — admin free text lands in alt attributes
 *  and page markup, so unbounded strings are not welcome. */
function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return NextResponse.json({ items: await getMediaItems() });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const actor = (await getSessionUser())!.email;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart form upload" }, { status: 400 });
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No "image" file in the upload' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That image file is empty" }, { status: 400 });
  }
  if (file.size > MAX_MEDIA_BYTES) {
    return NextResponse.json({ error: "Image is larger than 12MB" }, { status: 400 });
  }

  const ext = MEDIA_TYPE_EXT[file.type.toLowerCase()];
  if (!ext) {
    return NextResponse.json(
      { error: "Image must be a JPEG, PNG, WebP, or GIF" },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let name: string;
  try {
    name = await saveMediaImage(buffer, ext);
  } catch (err) {
    // Metadata stripping is fail-closed (M-16-02): a container we cannot parse
    // is REJECTED rather than stored with its EXIF intact. Catching it here
    // makes that read as a bad file instead of an outage.
    if (err instanceof UnstrippableImageError) {
      return NextResponse.json(
        { ok: false, error: "That image could not be read — try re-saving or exporting it." },
        { status: 400 },
      );
    }
    throw err;
  }

  // Re-uploading identical bytes yields the same content hash, so this updates
  // the existing row rather than creating a duplicate. Existing metadata wins
  // unless the upload supplied something — re-adding a photo must not silently
  // wipe alt text somebody already wrote.
  const existing = await getMediaItem(name);
  const item: MediaItem = {
    id: name,
    title: clean(form.get("title"), 120) || existing?.title || file.name.slice(0, 120),
    alt: clean(form.get("alt"), 300) || existing?.alt || "",
    credit: clean(form.get("credit"), 120) || existing?.credit || undefined,
    addedAt: existing?.addedAt ?? todayPacific(),
    bytes: buffer.byteLength,
  };
  await saveMediaItem(item, { actor });

  return NextResponse.json({ ok: true, item, duplicate: Boolean(existing) });
}

export async function PATCH(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const actor = (await getSessionUser())!.email;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  const existing = id ? await getMediaItem(id) : undefined;
  if (!existing) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  const title = clean(body.title, 120);
  if (!title) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const credit = clean(body.credit, 120);
  const item: MediaItem = {
    ...existing,
    title,
    alt: clean(body.alt, 300),
    ...(credit ? { credit } : { credit: undefined }),
  };
  await saveMediaItem(item, { actor });
  return NextResponse.json({ ok: true, item });
}

export async function DELETE(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const actor = (await getSessionUser())!.email;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!(await getMediaItem(id))) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  await deleteMediaItem(id, { actor });
  return NextResponse.json({ ok: true });
}
