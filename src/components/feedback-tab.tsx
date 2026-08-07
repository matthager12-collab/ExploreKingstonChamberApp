"use client";

// Site-wide page-feedback affordance: a fixed tab on the right edge that opens
// a small panel with a 1–5 star rating and one open question. Mounted once in
// SiteChrome, so it is on every public page (and the branded 404) without any
// page having to opt in.
//
// It records the path it was opened from — that is the whole point of putting
// it on every page rather than on a single /feedback route. "3 stars" is noise;
// "3 stars, sent from /parking" is a work item.
//
// PRIVACY: no contact field, deliberately (see FeedbackResponse in types.ts).
// The intro copy tells visitors not to type one, /api/feedback would drop it,
// and feedback_response stays a no-identifier store in PII_STORES.
//
// STATIC RENDERING: usePathname() is a client hook reading the router on the
// client — it does NOT make the tree dynamic the way cookies()/headers() in
// SiteChrome would. That distinction is load-bearing; see the header of
// site-chrome.tsx and tests/server/static-rendering.test.ts.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { EditableText, useCopy } from "@/lib/copy-context";
import { isDeliveredStatus, submitOrQueue } from "@/lib/outbox";
import { FEEDBACK_COMMENT_MAX, FEEDBACK_MAX_RATING, FEEDBACK_MIN_RATING } from "@/lib/types";

/**
 * Route prefixes that never show the tab.
 *
 * /admin and /portal are staff surfaces — the Chamber reading its own feedback
 * queue does not need a tab offering to add to it, and a stray staff
 * submission pollutes the per-page report the whole feature exists to produce.
 * /print pages are print layouts (the tab is also print:hidden below, which
 * covers printing any OTHER page). /offline is the service-worker fallback,
 * where a submission would be queued against a page the visitor never saw.
 *
 * Segment-boundary matched, not raw startsWith: "/print" must not also
 * suppress a future "/printmakers".
 */
const HIDDEN_PREFIXES = ["/admin", "/portal", "/print", "/offline"] as const;

export function isFeedbackHidden(path: string): boolean {
  return HIDDEN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

const STARS = Array.from(
  { length: FEEDBACK_MAX_RATING - FEEDBACK_MIN_RATING + 1 },
  (_, i) => FEEDBACK_MIN_RATING + i,
);

type Phase = "idle" | "busy" | "done";

export function FeedbackTab() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tabRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const legendId = useId();
  const commentId = useId();
  const countId = useId();

  const tabLabel = useCopy("feedback.tab.label");

  const close = useCallback(() => {
    setOpen(false);
    // Focus must come back to the control that opened the panel, or a keyboard
    // user lands at <body> and has to tab through the whole page again.
    tabRef.current?.focus();
  }, []);

  // Escape closes from anywhere inside the panel.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Move focus into the panel when it opens so screen-reader and keyboard
  // users are actually taken there (the panel is not modal — the rest of the
  // page stays reachable, which is the right trade for an optional aside).
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  // A route change closes the panel and resets it: the path is captured at
  // SUBMIT time, so a half-written comment left open across a navigation would
  // be filed against the page the visitor moved TO, not the one they were
  // complaining about.
  //
  // Adjusted during render rather than in an effect — React's documented
  // "adjusting state when a prop changes" pattern. An effect here would render
  // the stale panel once, then re-render to clear it (the cascading render
  // react-hooks/set-state-in-effect flags), which on a slow phone is a visible
  // flash of the previous page's half-typed feedback.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
    setPhase("idle");
    setRating(null);
    setComment("");
    setError(null);
    setQueued(false);
  }

  if (isFeedbackHidden(pathname)) return null;

  async function submit() {
    if (rating === null) return;
    setPhase("busy");
    setError(null);
    // submitOrQueue never throws: offline submissions land in the outbox and
    // replay later under the same idempotency key.
    const result = await submitOrQueue("/api/feedback", {
      rating,
      ...(comment.trim() ? { comment: comment.trim() } : {}),
      path: pathname,
    });

    if (result.status === "queued") {
      // Genuinely offline — it is saved on the device and replays later, so
      // this is a success state with different wording, not an error.
      setQueued(true);
      setPhase("done");
      return;
    }

    // Reached the server, but "reached" is not "accepted". Showing the
    // thank-you on a 429 or a 400 would tell the visitor their words landed
    // when the row was never written — and the outbox has already dropped its
    // copy, so nothing will retry. Keep them on the form with their text
    // intact so a retry is one tap.
    if (!isDeliveredStatus(result.httpStatus)) {
      setError(
        result.httpStatus === 429
          ? "That's a lot of feedback — give it a few minutes and try again."
          : "Couldn't send that just now — try again.",
      );
      setPhase("idle");
      return;
    }
    setPhase("done");
  }

  const remaining = FEEDBACK_COMMENT_MAX - comment.length;

  return (
    <>
      {/* The tab. Vertical text on a fixed right edge, mid-viewport — the
          convention this pattern has had since feedback tabs existed, so it
          reads as one without needing an explanation. print:hidden keeps it
          out of printed pages. */}
      <button
        ref={tabRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="fixed top-1/2 right-0 z-40 -translate-y-1/2 rounded-l-lg bg-sound-deep px-2 py-4 text-sm font-semibold text-white shadow-lg hover:bg-sound focus-visible:ring-2 focus-visible:ring-seaglass print:hidden"
        style={{ writingMode: "vertical-rl" }}
      >
        {tabLabel}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-labelledby={titleId}
          tabIndex={-1}
          /* Bottom sheet under 640px, right-edge panel above it: a 320px side
             panel on a phone leaves no room to type, and the on-screen
             keyboard covers a vertically-centred one. */
          className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl border border-sand bg-white p-5 shadow-2xl sm:inset-x-auto sm:top-1/2 sm:right-12 sm:bottom-auto sm:w-80 sm:-translate-y-1/2 sm:rounded-2xl print:hidden"
        >
          <div className="mb-3 flex items-start justify-between gap-4">
            <EditableText
              as="h2"
              id={titleId}
              className="font-semibold text-sound-deep"
              copyKey="feedback.panel.title"
            />
            {/* A bare glyph is a ~14px tap target — under WCAG 2.2 SC 2.5.8's
                24px floor and far under the 44px bar this app holds itself to.
                The min-h/min-w give it a real 44px box without resizing the
                glyph or moving the row. */}
            <button
              type="button"
              onClick={close}
              aria-label="Close feedback"
              className="-m-2 inline-flex min-h-11 min-w-11 items-center justify-center text-sm text-ink hover:text-sound"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>

          {phase === "done" ? (
            <p className="font-medium text-ink" role="status">
              {queued ? (
                <EditableText copyKey="feedback.queued" />
              ) : (
                <EditableText copyKey="feedback.thankyou" />
              )}
            </p>
          ) : (
            <>
              <EditableText as="p" className="mb-4 text-sm text-ink" copyKey="feedback.panel.intro" />

              {/* Native radios in a fieldset — the correct semantics for a
                  single-choice rating. Arrow keys move between stars for free,
                  and the group announces "3 of 5". A row of <button>s would
                  announce five unrelated controls and lose the selected state
                  entirely. The inputs are sr-only, not hidden: display:none
                  removes them from the tab order and from the a11y tree. */}
              <fieldset className="mb-4">
                <legend id={legendId} className="mb-2 text-sm font-medium text-ink">
                  <EditableText copyKey="feedback.rating.legend" />
                </legend>
                <div className="flex gap-1">
                  {STARS.map((star) => (
                    <label
                      key={star}
                      className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg text-2xl leading-none hover:bg-seaglass/30 focus-within:ring-2 focus-within:ring-tide-deep"
                    >
                      <input
                        type="radio"
                        name="feedback-rating"
                        value={star}
                        checked={rating === star}
                        onChange={() => setRating(star)}
                        className="sr-only"
                      />
                      {/* The glyph is decorative — the radio's label text is
                          what gets announced, so it must say the whole thing
                          ("3 stars"), not just repeat the shape. */}
                      <span aria-hidden="true" className={star <= (rating ?? 0) ? "text-coral" : "text-sand"}>
                        ★
                      </span>
                      <span className="sr-only">
                        {star} {star === 1 ? "star" : "stars"}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="mb-4">
                <label htmlFor={commentId} className="block text-sm font-medium text-ink">
                  <EditableText copyKey="feedback.comment.label" />
                </label>
                <textarea
                  id={commentId}
                  rows={4}
                  value={comment}
                  maxLength={FEEDBACK_COMMENT_MAX}
                  aria-describedby={countId}
                  onChange={(e) => setComment(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm"
                />
                {/* Only announced near the limit — a live region that fires on
                    every keystroke makes a screen reader unusable while
                    typing. */}
                <p id={countId} className="mt-1 text-xs text-ink-soft" aria-live="polite">
                  {remaining <= 100 ? `${remaining} characters left` : ""}
                </p>
              </div>

              {error && (
                <p className="mb-3 text-sm font-medium text-coral-deep" role="alert">
                  {error}
                </p>
              )}

              <button
                type="button"
                onClick={submit}
                disabled={rating === null || phase === "busy"}
                className="min-h-11 w-full rounded-full bg-coral px-5 py-2 text-sm font-semibold text-white hover:bg-coral-deep disabled:cursor-not-allowed disabled:opacity-50"
              >
                {phase === "busy" ? "Sending…" : <EditableText copyKey="feedback.submit" />}
              </button>
              {rating === null && (
                <p className="mt-2 text-xs text-ink-soft">Pick a rating to send.</p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
