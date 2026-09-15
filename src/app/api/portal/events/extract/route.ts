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
import { extractEventFromPost, MAX_POST_CHARS } from "@/lib/events/extract-post";
import { checkRateLimit } from "@/lib/rate-limit";

/** Per-member cap. Generous for pasting a few posts in a sitting, low enough
 *  that a scripted loop can't run up a bill. Keyed on the account rather than
 *  the IP: the caller is always signed in, and an account is the thing we can
 *  actually hold still. */
const LIMIT = 12;
const WINDOW_MS = 10 * 60_000;

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const ownerId = typeof body.ownerId === "string" ? body.ownerId : "";
  if (!ownerId) return NextResponse.json({ error: "ownerId required" }, { status: 400 });
  if (!can(user, "edit-record", ownerId)) {
    return NextResponse.json({ error: "You don't manage that listing" }, { status: 403 });
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
    return NextResponse.json(
      { error: "That's a lot of posts at once — try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let draft;
  try {
    draft = await extractEventFromPost(text);
  } catch (err) {
    // Upstream detail (which can carry request ids and key fragments) stays in
    // the server log; the member gets a sentence and their form.
    console.error("event extract failed", err);
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
