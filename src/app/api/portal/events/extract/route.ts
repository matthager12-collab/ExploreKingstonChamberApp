// Cookie-authenticated submission/status for private, tool-free CLI drafts.
// Only the ordinary event save route can create a pending or live event.
import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { can, getSessionUser } from "@/lib/auth";
import { MAX_POST_CHARS } from "@/lib/events/extract-post";
import { checkRateLimit } from "@/lib/rate-limit";
import { ResearchConflict } from "@/lib/db/research";
import {
  extractionConfigured, ExtractionUnavailable, submitPostExtraction, readPostExtraction,
} from "@/lib/research/event-extraction-queue";

export const dynamic = "force-dynamic";
function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
function errorResponse(error: unknown) {
  if (error instanceof ExtractionUnavailable) return json({ error: error.message }, 404);
  if (error instanceof ResearchConflict) return json({ error: error.message }, 409);
  if (error instanceof ZodError || error instanceof SyntaxError)
    return json({ error: "Invalid request body" }, 400);
  // Never log pasted posts, CLI output or credentials.
  console.error("Post queue failed", error instanceof Error ? error.name : "unknown");
  return json({ error: "Couldn't save that request. Your post is still in the form." }, 500);
}
function mutationGuard(request: NextRequest) {
  const origin = request.headers.get("origin");
  const protocol = request.headers.get("x-forwarded-proto") === "https" ? "https:" : request.nextUrl.protocol;
  const requestOrigin = `${protocol}//${request.headers.get("host") ?? request.nextUrl.host}`;
  if (origin && origin !== requestOrigin)
    return json({ error: "Use the event form on this site." }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
    return json({ error: "Send the post as JSON." }, 415);
  return null;
}

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
  if (!user) return json({ error: "Sign in first" }, 401);
  const guard = mutationGuard(request);
  if (guard) return guard;
  try {
    const raw = await readCapped(request, MAX_BODY_BYTES);
    if (raw === null) return json({ error: "That's too much to read at once — paste just the post." }, 413);
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request body" }, 400);
    if (typeof body.ownerId !== "string" || !body.ownerId) return json({ error: "ownerId required" }, 400);
    if (!can(user, "edit-record", body.ownerId)) return json({ error: "You don't manage that listing" }, 403);
    if (!extractionConfigured()) return json({ error: "Reading posts isn't connected yet — fill the form in by hand." }, 503);
    if (typeof body.text !== "string" || !body.text.trim()) return json({ error: "Paste a post first" }, 400);
    if (body.text.length > MAX_POST_CHARS) return json({ error: `That's longer than ${MAX_POST_CHARS} characters — paste just the post.` }, 413);
    z.string().uuid().parse(body.id);
    const limit = await checkRateLimit(`event-extract:${user.email}`, { limit: LIMIT, windowMs: WINDOW_MS });
    if (!limit.ok) return json({ error: "That's a lot of posts at once — try again in a few minutes." }, 429,
      { "Retry-After": String(limit.retryAfterSeconds) });
    return json({ job: await submitPostExtraction(body, user) }, 202);
  } catch (error) { return errorResponse(error); }
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return json({ error: "Sign in first" }, 401);
  try {
    const id = z.string().uuid().parse(request.nextUrl.searchParams.get("id"));
    return json({ job: await readPostExtraction(id, user) });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return json({ error: "Sign in first" }, 401);
  const guard = mutationGuard(request);
  if (guard) return guard;
  try {
    const raw = await readCapped(request, MAX_BODY_BYTES);
    if (raw === null) return json({ error: "Invalid request body" }, 413);
    const { id } = z.object({ id: z.string().uuid() }).parse(JSON.parse(raw));
    return json({ job: await readPostExtraction(id, user, true) });
  } catch (error) { return errorResponse(error); }
}
