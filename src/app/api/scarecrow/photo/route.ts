// Streams one Scarecrow Crawl photo to the Chamber.
// GET /api/scarecrow/photo?id=<vote id>
//
// ADMIN ONLY, always. Visitor photos are never published: the crawl's public
// page shows pins and words, and the prize is judged from what people post to
// Facebook and Instagram themselves. Nothing here renders to a visitor.
//
// The query gives a VOTE ID, not a path. The stored path is read back from the
// row, so no request can name a file — there is no traversal surface to
// sanitize, which is the cheapest way to not have that bug.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { isTrustedBlobUrl } from "@/lib/blob-store";
import { getVoteById, readPhoto } from "@/lib/stores/scarecrow-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return new Response("Missing ?id", { status: 400 });

  const vote = await getVoteById(id);
  if (!vote?.photoPath) return new Response("Not found", { status: 404 });

  // Legacy blob mode: the stored value is a full URL. Only OUR blob host is
  // trusted for the redirect itself.
  if (isTrustedBlobUrl(vote.photoPath)) return NextResponse.redirect(vote.photoPath, 302);

  const photo = await readPhoto(vote.photoPath);
  if (!photo) return new Response("Not found", { status: 404 });

  return new Response(photo.data, {
    headers: {
      "Content-Type": photo.contentType,
      "Content-Length": String(photo.data.byteLength),
      // Private by construction: never cached by a proxy, never re-served.
      "Cache-Control": "private, no-store",
    },
  });
}
