// Serves a library photo. PUBLIC on purpose — these are the images the home
// hero, the kiosk carousel and listing cards display, so the bytes are public
// content by definition. The private R2 bucket is still never exposed: this
// route is the proxy, and mediaImagePath() is the strict gate on what may be
// requested (bare content hash + known extension, nothing else).
//
// A missing or unreadable object 404s the ONE request. It must never throw, or
// a Cloudflare blip would take down every page embedding a photo.

import { NextRequest } from "next/server";
import { readMediaImage } from "@/lib/stores/media-store";

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("p") ?? "";
  const img = await readMediaImage(name);
  if (!img) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(img.bytes), {
    headers: {
      "Content-Type": img.type,
      // Content-addressed names mean the bytes at a given name can never
      // change, so this is safe to cache hard and long. Replacing a photo
      // produces a NEW name, which busts the cache by construction.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
