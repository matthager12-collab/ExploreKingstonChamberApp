// Admin feature-image upload — backs the image picker in the /admin/maps
// builder. POST a multipart form with an "image" field; the bytes are hashed
// and stored under .data/map/images and the returned name is what the client
// saves into feature.imageUrl (served publicly via /api/map/image?p=name).
//
// 401 signed out · 403 signed in but not admin.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { saveFeatureImage } from "@/lib/stores/map-store";

const MAX_BYTES = 8 * 1024 * 1024; // ~8MB

// Accepted MIME types → the extension saveFeatureImage should record.
const TYPE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

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
    return NextResponse.json({ error: "The image file is empty" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image is larger than 8MB" }, { status: 400 });
  }

  const ext = TYPE_EXT[file.type.toLowerCase()];
  if (!ext) {
    return NextResponse.json(
      { error: "Image must be a JPEG, PNG, WebP, or GIF" },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const imageUrl = await saveFeatureImage(buffer, ext);
  return NextResponse.json({ ok: true, imageUrl });
}
