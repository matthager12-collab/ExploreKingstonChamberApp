// Streams a stored event attachment (artwork/flyer).
// GET /api/events/attachment?p=<path relative to .data/events>
//
// Access is PUBLIC: event attachments are promo material meant to be seen once
// the event is live. The path is strictly sanitized in attachment-store (no
// traversal, allowlisted extensions only, resolved inside .data/events). In
// production attachments are full Vercel Blob URLs served directly by the CDN,
// so this route matters mainly in local dev / filesystem mode — but it also
// redirects a blob URL handed to ?p= to keep one canonical accessor.

import { NextRequest, NextResponse } from "next/server";
import { isTrustedBlobUrl } from "@/lib/blob-store";
import { readAttachment } from "@/lib/events/attachment-store";

export async function GET(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get("p");
  if (!ref) return new Response("Missing ?p", { status: 400 });

  // A blob ref: only OUR blob host is trusted for the redirect.
  if (isTrustedBlobUrl(ref)) return NextResponse.redirect(ref, 302);

  const file = await readAttachment(ref);
  if (!file) return new Response("Not found", { status: 404 });

  return new Response(file.data, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.data.byteLength),
      // Immutable content (random file name); safe to cache hard.
      "Cache-Control": "public, max-age=31536000, immutable",
      // Never let a PDF/HTML-ish upload execute in the page origin.
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
