// Instant navigation feedback for every public page — the fix for the "dead
// click": / and /ferry are dynamic (per-request via cookies()), and per the
// bundled Next docs a dynamic route's prefetch is SKIPPED entirely unless a
// loading.tsx exists (01-getting-started/04-linking-and-navigating.md §Prefetching),
// so tapping a nav link gave zero feedback until the full server response
// arrived. With this file, the (site) layout + this skeleton are partially
// prefetched and paint immediately while the page streams in.
//
// Placement: loading.tsx wraps page.js AND every nested segment below it in a
// Suspense boundary (03-api-reference/03-file-conventions/loading.md), and
// route groups add no URL segment — so this one file at (site) level covers
// /, /ferry, /eat, /events, … every public route without its own loading file.
//
// Server component, zero client JS, no data reads — anything async here would
// delay the very fallback that exists to be instant.
//
// A11y (E14 floor): the wrapper is role="status" with sr-only text so screen
// readers announce the load; every visual bar is aria-hidden decoration.
// animate-pulse is neutralized both by the app-wide prefers-reduced-motion
// rule in globals.css and by motion-reduce:animate-none here.

/** One ghost content card, shaped like src/components/ui.tsx Card. */
function GhostCard() {
  return (
    <div className="rounded-2xl border border-sand bg-white p-5 shadow-[0_1px_3px_rgba(22,64,94,0.08)]">
      <div className="h-6 w-48 max-w-full rounded bg-sand" />
      <div className="mt-4 space-y-2.5">
        <div className="h-4 w-full rounded bg-sand" />
        <div className="h-4 w-5/6 rounded bg-sand" />
        <div className="h-4 w-2/3 rounded bg-sand" />
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div role="status" className="animate-pulse motion-reduce:animate-none">
      <span className="sr-only">Loading page</span>
      {/* PageHeader ghost — same container/spacing as ui.tsx PageHeader so the
          real header lands exactly where the skeleton was (no layout shift). */}
      <div aria-hidden="true" className="mx-auto max-w-5xl px-4 pt-10 pb-6 sm:pt-14">
        <div className="mb-2 h-4 w-36 rounded bg-sand" />
        <div className="h-10 w-2/3 max-w-md rounded-lg bg-sand sm:h-12" />
        <div className="mt-4 h-5 w-full max-w-2xl rounded bg-sand" />
        <div className="mt-2 h-5 w-3/4 max-w-xl rounded bg-sand" />
      </div>
      {/* Section-shaped ghost content — same container as ui.tsx Section. */}
      <div aria-hidden="true" className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <GhostCard />
        <GhostCard />
        <GhostCard />
      </div>
    </div>
  );
}
