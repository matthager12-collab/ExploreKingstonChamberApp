// In-app feedback intake (the site-wide "Give feedback" side tab).
//
// Shaped deliberately like /api/survey next door — same rate-limit posture,
// same body cap, same idempotency-claim placement — because both are anonymous
// public POSTs carried by the offline outbox, and two intake routes that drift
// apart is how one of them quietly stops being safe.
//
// Two things this route now does that it deliberately did not before, both
// from docs/FEEDBACK-GUARDRAIL:
//
//   1. It accepts an OPTIONAL name and address (DEC-002/DEC-005). That is what
//      turned feedback_response from a no-identifier store into a full
//      PiiStore, so the handlers in src/lib/privacy/pii-inventory.ts are part
//      of this feature, not a follow-up.
//   2. It runs the comment past the rudeness guardrail and stores the neutral
//      rewrite instead of the original when one comes back (DEC-003/DEC-004).
//
// Bad contact input is DROPPED, never rejected. The outbox deletes its copy on
// any 4xx, so a 400 over a mistyped address would cost the Chamber the whole
// submission — the same reasoning that makes an over-long comment truncate
// rather than fail.

import { NextRequest } from "next/server";
import { claimIdempotencyKey, releaseIdempotencyKey } from "@/lib/db/idempotency";
import { feedbackStore } from "@/lib/feedback-store";
import { moderateComment } from "@/lib/feedback-moderation";
import { isSensitivePath } from "@/lib/privacy/policy";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import {
  FEEDBACK_COMMENT_MAX,
  FEEDBACK_EMAIL_MAX,
  FEEDBACK_MAX_RATING,
  FEEDBACK_MIN_RATING,
  FEEDBACK_NAME_MAX,
  REDACTED_PATH,
  type FeedbackResponse,
} from "@/lib/types";

// Cap the raw body before parsing — the comment truncation below bounds what
// we KEEP, not what we buffer. Larger than the survey's 8KB because this route
// legitimately carries up to FEEDBACK_COMMENT_MAX of text, and a visitor whose
// long comment 413s has lost it for good (the outbox drops the entry on a 4xx).
const MAX_BODY_BYTES = 16_384;

/** Longest source path stored. Real routes are far shorter; this only bounds a
 *  hostile client stuffing the field. */
const MAX_PATH_LENGTH = 512;

/**
 * Normalize the client-supplied source path to something safe to store and to
 * render in the admin table.
 *
 * The widget sends usePathname(), which is already path-only — this exists for
 * everything else that can POST here. Query strings and hashes are stripped
 * rather than rejected: they are the parts most likely to carry an identifier
 * (?email=…), and no page-level report needs them.
 *
 * Returns REDACTED_PATH for a page under SENSITIVE_PATHS. The submission still
 * stores — someone who chose to write to the Chamber gets heard — but the path
 * that would reveal they were on a food- or health-assistance page does not.
 */
export function normalizeFeedbackPath(raw: unknown): string {
  if (typeof raw !== "string") return "(unknown)";
  // Split before trimming: "/eat ?x=1" should lose the query, not keep a space.
  const pathOnly = raw.split(/[?#]/)[0].trim();
  if (!pathOnly.startsWith("/")) return "(unknown)";
  const bounded = pathOnly.slice(0, MAX_PATH_LENGTH);
  return isSensitivePath(bounded) ? REDACTED_PATH : bounded;
}

/**
 * Deliberately loose. This is not validation in the "reject bad input" sense —
 * it is a filter that keeps a usable address and silently discards anything
 * else, because the submission must survive either way (see the header).
 *
 * The shape test is one `@` with something either side and a dot in the domain.
 * Chasing RFC 5322 with a regex is a well-known dead end, and the address is
 * unverified regardless (DEC-005), so a stricter pattern would only reject
 * real addresses while proving nothing about the ones it lets through.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

export function normalizeContact(body: {
  name?: unknown;
  email?: unknown;
}): { name?: string; email?: string } {
  const out: { name?: string; email?: string } = {};

  if (typeof body.name === "string") {
    const name = body.name.trim().slice(0, FEEDBACK_NAME_MAX);
    if (name) out.name = name;
  }

  if (typeof body.email === "string") {
    // Lowercased so the privacy lookup can match without a functional index,
    // and so two submissions from one person collate.
    const email = body.email.trim().toLowerCase().slice(0, FEEDBACK_EMAIL_MAX);
    if (EMAIL_SHAPE.test(email)) out.email = email;
  }

  return out;
}

export async function POST(request: NextRequest) {
  // Looser than the survey's 5-per-10-minutes: the survey is asked once per
  // visitor, but feedback is offered on every page and a visitor may genuinely
  // have something to say about three of them in one session.
  const limit = await checkRateLimit(clientKey(request, "feedback"), {
    limit: 10,
    windowMs: 10 * 60_000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too many submissions, please try again later" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: Partial<FeedbackResponse>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return Response.json({ error: "body too large" }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  // The rating is the one required field. Integer-checked, not just
  // range-checked: a 4.5 would land in a byRating bucket the admin page never
  // renders, so the row would silently vanish from the distribution.
  const rating = body.rating;
  if (
    typeof rating !== "number" ||
    !Number.isInteger(rating) ||
    rating < FEEDBACK_MIN_RATING ||
    rating > FEEDBACK_MAX_RATING
  ) {
    return Response.json(
      { error: `rating must be an integer ${FEEDBACK_MIN_RATING}-${FEEDBACK_MAX_RATING}` },
      { status: 400 },
    );
  }

  // Idempotent intake for the offline outbox, placed exactly as in /api/survey:
  // AFTER validation (a claim taken on a body we then reject burns the key —
  // the outbox deletes its copy on a 400, so the answer is gone and the replay
  // can never land) and BEFORE the save. No header = unchanged behavior.
  const idempotencyKey = request.headers.get("X-Idempotency-Key");
  if (idempotencyKey) {
    const claim = await claimIdempotencyKey(idempotencyKey, "feedback");
    if (claim === "invalid") {
      return Response.json({ error: "invalid idempotency key" }, { status: 400 });
    }
    if (claim === "duplicate") {
      // A replay of something already stored. Success, without a second row —
      // and, just as importantly, without a second model call. That is why the
      // guardrail runs BELOW this point and not above it: an outbox replaying
      // a week of queued submissions must not pay for them twice.
      //
      // `moderated: false` here is about THIS request, not the stored row. The
      // original submission already told the visitor whether it was rewritten;
      // a replay has no visitor waiting on an answer.
      return Response.json({ ok: true, duplicate: true, moderated: false });
    }
  }

  const comment =
    typeof body.comment === "string" && body.comment.trim().length > 0
      ? body.comment.trim().slice(0, FEEDBACK_COMMENT_MAX)
      : undefined;

  // The guardrail. Skipped entirely when there is no comment, which is most
  // submissions (control C9). `moderateComment` never rejects, by contract, and
  // reports `checked: false` for every failure — unset key, timeout, 5xx, or an
  // off-schema reply. In all of those the visitor's words are stored exactly as
  // written and they see the ordinary thank-you (DEC-006).
  const verdict = comment ? await moderateComment(comment) : { checked: false as const };
  const rewritten = verdict.checked && verdict.rude;
  const storedComment = rewritten ? verdict.cleaned : comment;

  const response: FeedbackResponse = {
    submittedAt: new Date().toISOString(),
    rating,
    ...(storedComment ? { comment: storedComment } : {}),
    path: normalizeFeedbackPath(body.path),
    ...(rewritten ? { moderated: true } : {}),
    ...normalizeContact(body),
  };

  try {
    await feedbackStore.save(response);
  } catch {
    // Store unavailable: don't fail the visitor's request over telemetry.
    //
    // Hand the key back first — this path still answers {ok:true}, so the
    // outbox deletes its copy, and a claim left standing would turn a
    // transient outage into PERMANENT loss (every later replay of that key
    // answers "duplicate" for a row that was never written).
    // releaseIdempotencyKey never throws, by contract.
    if (idempotencyKey) await releaseIdempotencyKey(idempotencyKey);
    console.warn("feedback: store unavailable, response dropped");
  }
  // `moderated` tells the widget which thank-you to render. It is the ONLY
  // thing the client learns about the guardrail: the rewrite itself is not
  // echoed back, because showing someone a sanitised version of what they just
  // wrote invites them to try again with the sanitiser in view.
  return Response.json({ ok: true, moderated: rewritten });
}

/** Aggregate summary for the admin page. Admin-only — the free text here is
 *  unstructured visitor writing and is never public. Only GET is gated: POST
 *  is the anonymous visitor submission and must stay open. */
export async function GET() {
  // Imported lazily so the public POST path above never pulls the auth/DB
  // module graph in at module scope.
  const { requireAdmin } = await import("@/lib/auth");
  const denied = await requireAdmin();
  if (denied) return denied;

  // Windowed by the analytics baseline for the same reason /api/survey's GET
  // is: these figures render beside the dashboard's, under one stated counting
  // window, and two endpoints claiming the same window have to move together.
  const { getAnalyticsSince } = await import("@/lib/stores/analytics-baseline-store");
  const summary = await feedbackStore.summarize(await getAnalyticsSince());
  return Response.json(summary);
}
