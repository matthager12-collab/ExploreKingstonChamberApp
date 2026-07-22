"use client";

/*
 * Segment-level error boundary (E13). Renders inside the root layout, so the
 * nav, footer and branding are still there — a visitor who hits this has not
 * fallen off the site.
 *
 * Next 16.2.0 renamed the retry prop. `unstable_retry()` re-fetches AND
 * re-renders the boundary's children, which is what actually recovers a failed
 * server render; the legacy `reset()` only clears local error state and would
 * put the same broken render straight back on screen. Nothing in CI catches
 * the wrong prop name — `{ error, reset }` typechecks clean and silently fails
 * at runtime — so do not "simplify" this back.
 *
 * The two links below are deliberately plain <a> anchors: if React or the
 * router is what broke, the way out must not depend on either of them.
 */
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="font-display text-2xl font-semibold text-sound-deep">
        Something went wrong
      </h1>
      <p className="mt-3 text-ink-soft">
        Sorry — that page didn&apos;t load. It is usually worth one more try; if it keeps
        happening, the ferry board is the page most people are here for.
      </p>
      <button
        type="button"
        onClick={() => unstable_retry()}
        className="mt-6 rounded-full bg-coral px-5 py-2 text-sm font-semibold text-white hover:bg-coral-deep"
      >
        Try again
      </button>
      <p className="mt-6 text-sm">
        <a className="text-tide-deep underline underline-offset-2" href="/ferry">
          Ferry times
        </a>
        {" · "}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- the escape
            hatch from a broken render must not depend on the router. */}
        <a className="text-tide-deep underline underline-offset-2" href="/">
          Home
        </a>
      </p>
      {/* The digest is the only handle support has for matching a visitor's
          report to a server log line — Server Component errors deliberately
          never surface their message here. */}
      {error.digest && (
        <p className="mt-6 text-xs text-ink-soft">Reference: {error.digest}</p>
      )}
    </div>
  );
}
