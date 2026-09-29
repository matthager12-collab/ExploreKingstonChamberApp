// POST /api/portal/events/extract — paste a social post, get a DRAFT back.
//
// Read-only by construction: this route returns form values and writes
// nothing. Creating the event stays with POST /api/portal/events, which keeps
// its own validation and the E08 moderation floor. Splitting it that way is
// the point — the LLM never sits on a write path.
//
// Authorization is the same check the sibling POST makes, for the same reason
// plus one more: this endpoint spends money, so it is not open to anyone with
// a session, only to someone who manages the listing they are drafting for.

import { NextRequest, NextResponse } from "next/server";

import { can, getSessionUser } from "@/lib/auth";
import {
  extractEventFromPost,
  extractionConfigured,
  MAX_POST_CHARS,
} from "@/lib/events/extract-post";
import { checkRateLimit } from "@/lib/rate-limit";

/** Per-member cap. Generous for pasting a few posts in a sitting, low enough
 *  that a scripted loop can't run up a bill. Keyed on the account rather than
 *  the IP: the caller is always signed in, and an account is the thing we can
 *  actually hold still. */
const LIMIT = 12;
const WINDOW_MS = 10 * 60_000;

/** Room for the 8,000-character post at four bytes a character, plus the JSON
 *  around it. Anything bigger is not a post. */
const MAX_BODY_BYTES = 40_000;

/**
 * Read the body up to a cap; null means it went over. Content-Length can lie or
 * be missing (chunked), so the bytes are counted as they arrive, and reading
 * stops the moment the cap is passed. Before this the body was read whole, so a
 * signed-in caller could send huge bodies without spending any quota.
 */
async function readCapped(request: NextRequest, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    // The upload broke part way. What arrived is not a whole request, so it is
    // treated as an empty one and the JSON check below answers 400.
    return "";
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const raw = await readCapped(request, MAX_BODY_BYTES);
  if (raw === null) {
    // Not the "longer than N characters" sentence: this fires on bytes, and a
    // short post with a huge unused field is not too long.
    return NextResponse.json(
      { error: "That's too much to read at once — paste just the post." },
      { status: 413 },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  // JSON allows null, a list, a number and a string at the top level; none of
  // them has an ownerId to read.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;

  const ownerId = typeof body.ownerId === "string" ? body.ownerId : "";
  if (!ownerId) return NextResponse.json({ error: "ownerId required" }, { status: 400 });
  if (!can(user, "edit-record", ownerId)) {
    return NextResponse.json({ error: "You don't manage that listing" }, { status: 403 });
  }

  // After the auth checks on purpose: whether the feature is configured is not
  // something an anonymous caller gets to learn.
  if (!extractionConfigured()) {
    return NextResponse.json(
      { error: "Reading posts isn't switched on yet — fill the form in by hand." },
      { status: 503 },
    );
  }

  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) return NextResponse.json({ error: "Paste a post first" }, { status: 400 });
  if (text.length > MAX_POST_CHARS) {
    return NextResponse.json(
      { error: `That's longer than ${MAX_POST_CHARS} characters — paste just the post.` },
      { status: 413 },
    );
  }

  const limit = await checkRateLimit(`event-extract:${user.email}`, {
    limit: LIMIT,
    windowMs: WINDOW_MS,
  });
  if (!limit.ok) {
    const minutes = Math.max(1, Math.ceil(limit.retryAfterSeconds / 60));
    return NextResponse.json(
      {
        error: `That's a lot of posts at once — try again in about ${minutes} ${
          minutes === 1 ? "minute" : "minutes"
        }.`,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let draft;
  try {
    draft = await extractEventFromPost(text);
  } catch (err) {
    // Name, status and request id only. The whole error carries the upstream
    // body, which can echo what was sent, and this route is sent people's posts.
    // The member gets a sentence and their form.
    const e = err as { name?: unknown; status?: unknown; requestID?: unknown } | null;
    console.error("event extract failed", {
      name: typeof e?.name === "string" ? e.name : "Error",
      status: typeof e?.status === "number" ? e.status : undefined,
      requestId: typeof e?.requestID === "string" ? e.requestID : undefined,
    });
    return NextResponse.json(
      { error: "Couldn't read that one — fill the form in by hand." },
      { status: 502 },
    );
  }

  if (!draft) {
    return NextResponse.json(
      { error: "That doesn't look like an event post — fill the form in by hand." },
      { status: 422 },
    );
  }

  return NextResponse.json({ draft });
}
