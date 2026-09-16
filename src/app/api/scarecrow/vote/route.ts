// Scarecrow Crawl — the public vote.
//
// POST multipart/form-data: scarecrowId, photo? (File)
// Responds { ok: true }. Deliberately NOT the running count: results stay
// closed until the crawl does, so the page cannot start a bandwagon.
//
// No auth, no cookie, no session — a visitor on the street taps a pin and
// votes, like /api/events/going. Repeat votes are suppressed ON THE DEVICE;
// catching them here would need an identifier, which is the one thing this
// feature refuses to hold. The count is an interest signal, not a ballot box.
//
// Three server-side gates, none of which the client can talk its way past:
// the crawl window (a wrong device clock cannot vote early or late), the
// scarecrow id (must be in src/lib/data/scarecrows.ts), and the photo
// (type, size, and a fail-closed metadata strip before anything is stored).

import { NextRequest } from "next/server";
import { UnstrippableImageError } from "@/lib/image-sanitize";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import {
  MAX_PHOTO_BYTES,
  castVote,
  getCrawlPhase,
  getCrawlScarecrows,
  imageExtension,
} from "@/lib/stores/scarecrow-store";

export const dynamic = "force-dynamic";

// Multipart framing slack on top of the photo cap: boundaries, part headers,
// and the one small text field (scarecrowId).
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export async function POST(request: NextRequest) {
  // Five in ten minutes: enough for a family voting from one phone hotspot,
  // far too slow to inflate a fortnight-long count from a script.
  const limit = await checkRateLimit(clientKey(request, "scarecrow-vote"), {
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (!limit.ok) {
    return Response.json(
      { ok: false, error: "too many votes just now — try again in a few minutes" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  // The dates, with the Chamber's switch on top — the same read the page
  // makes, so a rehearsal cannot leave the form live against a shut endpoint.
  const phase = await getCrawlPhase();
  if (phase !== "open") {
    return Response.json(
      {
        ok: false,
        error:
          phase === "before"
            ? "voting opens on Saturday 17 October"
            : "voting closed at 5pm on Saturday 31 October",
      },
      { status: 403 },
    );
  }

  // Bound the request BEFORE formData() touches it: formData() buffers the
  // whole body first, so the photo.size check below bounds what we STORE, not
  // what the parse costs. Same reasoning as /api/hunts/submit.
  const declaredBytes = Number(request.headers.get("content-length"));
  if (!Number.isInteger(declaredBytes) || declaredBytes <= 0) {
    return Response.json({ ok: false, error: "missing request length" }, { status: 411 });
  }
  if (declaredBytes > MAX_PHOTO_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return Response.json({ ok: false, error: "photo too large (max 8 MB)" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, error: "expected multipart/form-data" }, { status: 400 });
  }

  const scarecrowId = form.get("scarecrowId");
  // The allowlist is whatever the Chamber currently has on the crawl map —
  // read per request, so an entry removed mid-crawl stops taking votes at once
  // and an invented id never counts.
  const known = await getCrawlScarecrows();
  if (typeof scarecrowId !== "string" || !known.some((s) => s.id === scarecrowId)) {
    return Response.json({ ok: false, error: "unknown scarecrow" }, { status: 400 });
  }

  const photo = form.get("photo");
  let photoInput: { bytes: Uint8Array; ext: string } | undefined;
  if (photo instanceof File && photo.size > 0) {
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
    photoInput = { bytes: new Uint8Array(await photo.arrayBuffer()), ext };
  }

  // Permission to use the photo. The form ticks the box by default and sends
  // an explicit "true"/"false", so an untick is a recorded no rather than a
  // missing field. A request that omits it entirely records NO: consent is the
  // one field where the safe reading of silence is refusal, whatever the
  // default in the UI.
  const photoSocialOk = photoInput ? form.get("socialOk") === "true" : undefined;

  try {
    await castVote({
      scarecrowId,
      ...(photoInput ? { photo: photoInput } : {}),
      ...(photoSocialOk !== undefined ? { photoSocialOk } : {}),
    });
    return Response.json({ ok: true });
  } catch (err) {
    // Stripping is fail-closed (M-16-02): a photo we cannot prove is free of
    // location metadata is refused rather than stored. Plain language for a
    // visitor standing in the street.
    if (err instanceof UnstrippableImageError) {
      return Response.json(
        { ok: false, error: "That photo could not be read. Try taking it again." },
        { status: 400 },
      );
    }
    console.error("scarecrow-vote: could not record vote", err);
    return Response.json({ ok: false, error: "could not record your vote" }, { status: 500 });
  }
}
