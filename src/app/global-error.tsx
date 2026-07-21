"use client";

/*
 * Last-resort error boundary (E13). This REPLACES the root layout, so
 * globals.css and the next/font variables are not guaranteed to be loaded —
 * every style here is inline on purpose and Tailwind classes would be a
 * coin flip.
 *
 * Every hex below is a copy of an existing token value, not a new color:
 *   #fbfcfd --color-shell   #20262e --color-ink   #6b7683 --color-ink-soft
 *   #1E96C0 the themeColor in layout.tsx   #16758f --color-tide-deep
 *
 * Two Next constraints, both easy to trip:
 *   - A client boundary cannot export `metadata`; React's <title> element is
 *     the sanctioned alternative.
 *   - Never export `viewport` from here either — that export is
 *     Server-Component-only and fails the build.
 *
 * `unstable_retry` (not the legacy `reset`) is what actually re-fetches and
 * re-renders — see the note in src/app/error.tsx.
 *
 * Worth knowing when you go to verify this by hand: for bot user-agents Next
 * substitutes its own graceful-degradation boundary instead of this component.
 * Test with a normal browser UA or you will conclude this file is dead code.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fbfcfd",
          color: "#20262e",
          fontFamily: "system-ui, -apple-system, sans-serif",
          textAlign: "center",
          padding: "2rem",
        }}
      >
        <title>Something went wrong · Explore Kingston</title>
        <div>
          <h1 style={{ fontSize: "1.5rem", margin: "0 0 0.75rem" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 1.5rem", color: "#6b7683" }}>
            Explore Kingston hit an unexpected error.
          </p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              background: "#1E96C0",
              color: "#ffffff",
              border: 0,
              borderRadius: "9999px",
              padding: "0.5rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <p style={{ marginTop: "1.5rem", fontSize: "0.875rem" }}>
            <a href="/ferry" style={{ color: "#16758f" }}>
              Ferry times
            </a>
          </p>
          {error.digest && (
            <p style={{ marginTop: "1.5rem", fontSize: "0.75rem", color: "#6b7683" }}>
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
