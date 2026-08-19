// Server-side enforcement for admin page show/hide.
//
// Public pages call `await assertPageVisible("/hunt")` at the top of their
// server component. Hidden page + visitor → notFound() (a clean 404).
// Hidden page + admin session → renders normally so the Chamber can preview;
// pair with <HiddenPageBanner/> from the same import for an on-page notice.
//
// The list of hideable paths (with labels) lives here so the admin UI and
// the nav filter agree on one source of truth. Home ("/") and the portal/
// admin/api routes are deliberately not hideable.
//
// EVERY page under a hideable path needs a gate, not just the section index.
// A detail route that only 404s on "no such record" stays fully reachable
// while its section is hidden — the list page 404s and the URLs leave the
// sitemap, but bookmarks and search results keep working
// (/itineraries/<slug> and /hunt/<slug>, found 2026-08-19). Children gate on
// the PARENT section path: /ferry/plan calls assertPageVisible("/ferry").
// tests/unit/visibility-gate-guard.test.ts enforces both halves — that a gate
// exists, and that it names the right section.

import { notFound } from "next/navigation";
import { getSessionUser } from "./auth";
import { HiddenPreviewEvict } from "./hidden-preview-evict";
import { getPageSettings, type PageSetting } from "./stores/site-store";

export const HIDEABLE_PAGES: { path: string; label: string }[] = [
  { path: "/ferry", label: "Ferry" },
  { path: "/eat", label: "Eat & Drink" },
  { path: "/events", label: "Events" },
  { path: "/itineraries", label: "Itineraries" },
  { path: "/stay", label: "Stay" },
  { path: "/parking", label: "Parking" },
  { path: "/webcams", label: "Webcams" },
  { path: "/map", label: "Town Map" },
  { path: "/give", label: "Give Back" },
  { path: "/hunt", label: "Scavenger Hunt" },
  { path: "/about", label: "About" },
  // E14 — the non-app fallbacks (M-14-03 / M-18-07). Visible by default like
  // every other entry; listed here so the Chamber can hide them from the same
  // Admin → Site content screen, and so nav/footer links drop out with them.
  { path: "/simple", label: "Kingston basics (easy read)" },
  { path: "/print", label: "Printable one-pager" },
  // E14 — the Spanish essentials page. SHIPS DARK: see DEFAULT_HIDDEN_PAGES.
  { path: "/es", label: "Kingston en español" },
  // E33 — the SR-104 line lander. Live since 2026-08-01, but UNLISTED: public
  // to anyone with the URL, kept out of search (see UNLISTED_PAGES).
  { path: "/line", label: "Ferry line (SR-104)" },
];

/**
 * Paths that are HIDDEN when the site-pages store says nothing about them.
 *
 * Every other hideable page is visible until an admin hides it. These are the
 * inverse: absence of a record means hidden, and only an explicit
 * `{ id, hidden: false }` record — written from Admin → Site content, the same
 * toggle as every other page — makes them public.
 *
 * `/es` is on this list because its Spanish is hand-authored and must be read
 * by a bilingual human before a visitor acts on it (docs/OPERATIONS.md,
 * "Accessibility & language"). Fail-closed is the only correct default for
 * safety copy: a fresh database, a restored backup, or a wiped store all leave
 * it dark rather than publishing unreviewed instructions about ferry lines.
 *
 * `/line` (E33) WAS on this list because it shipped dark. It went live on
 * 2026-08-01 and now has an explicit `hidden: false` record, so this entry no
 * longer gates anything day to day — it is a RESTORE-SAFETY NET. If that record
 * is ever lost (a backup restore, a wiped store, a fresh database) /line falls
 * back to 404 rather than silently republishing itself, which is the right
 * default for a page whose subject is "do you need a boarding pass right now".
 *
 * DO NOT remove `/line` from this list as a tidy-up. With no record present,
 * removing it flips the page from fail-closed to PUBLIC BY DEFAULT — the exact
 * opposite of the intent. It is unadvertised, not un-public: see UNLISTED_PAGES.
 */
export const DEFAULT_HIDDEN_PAGES: readonly string[] = ["/es", "/line"];

/**
 * Public pages that must not be ADVERTISED to search engines, even when
 * visible. Distinct from hidden: these answer 200 to anyone with the URL.
 *
 * `/line` is reached by QR code from a physical roadside sign on SR 104. It is
 * meant to be found by someone sitting in the ferry line, not by a search for
 * "Kingston ferry" — its whole framing ("you're in the line") is wrong for
 * anyone else, and it would compete with /ferry for the queries /ferry should
 * win.
 *
 * Two mechanisms, and they are not interchangeable:
 *   - listed here  → dropped from sitemap.xml (stop advertising it), and
 *   - `robots: { index: false }` on the page itself (stop indexing it).
 *
 * Deliberately NOT a robots.txt `Disallow`. Disallow blocks CRAWLING, so the
 * crawler never fetches the page, never sees the noindex, and Google can still
 * list a bare URL it learned from an inbound link. "Crawlable + noindex" is the
 * combination that actually keeps a page out of results.
 */
export const UNLISTED_PAGES: readonly string[] = ["/line"];

/**
 * The paths a visitor must not see, from the raw store rows: everything with
 * `hidden: true`, PLUS every DEFAULT_HIDDEN_PAGES path that has no row at all.
 * Pure, so the rule is unit-testable without a database.
 */
export function effectiveHiddenPaths(settings: PageSetting[]): string[] {
  const known = new Set(settings.map((s) => s.id));
  const hidden = new Set(settings.filter((s) => s.hidden).map((s) => s.id));
  for (const path of DEFAULT_HIDDEN_PAGES) {
    if (!known.has(path)) hidden.add(path);
  }
  return [...hidden];
}

/**
 * THE hidden-paths read for every surface that renders links (nav, footer,
 * home grid, /simple). Use this rather than the store's raw `getHiddenPaths()`,
 * which cannot tell "no record" from "record says visible" and would therefore
 * link visitors to a 404 on a default-hidden page.
 */
export async function getEffectiveHiddenPaths(): Promise<string[]> {
  return effectiveHiddenPaths(await getPageSettings());
}

/**
 * 404 for visitors when the page is hidden; admins pass through.
 * Returns true when the page is hidden-but-admin (show the banner).
 *
 * DYNAMIC ROUTES ONLY. The admin pass-through reads cookies() on the hidden
 * branch, which cannot run during background revalidation — on an ISR page
 * the 404 never bakes and "hide" silently does nothing (the /give find,
 * 2026-08-03). Pages with `export const revalidate` use
 * assertPageVisibleStatic instead; tests/unit/visibility-gate-guard.test.ts
 * enforces this.
 */
export async function assertPageVisible(path: string): Promise<boolean> {
  const hidden = await getEffectiveHiddenPaths();
  if (!hidden.includes(path)) return false;
  const user = await getSessionUser();
  if (user?.role === "admin") return true;
  notFound();
}

/**
 * E33 — the ISR-safe variant of assertPageVisible: hidden → notFound() for
 * EVERYONE, admins included. No session read, ever.
 *
 * WHY IT EXISTS. assertPageVisible's admin pass-through calls getSessionUser()
 * → cookies() on the hidden branch. `next build` prerenders with an empty
 * store (db/records.ts buildingWithoutDb), so a DEFAULT_HIDDEN_PAGES route is
 * hidden AT BUILD TIME — the cookies() read fires during the prerender and
 * marks the whole route dynamic, which makes `export const revalidate` inert
 * forever (the /ferry trap, memory `visit-kingston-ferry-perf`; /es accepts
 * on-demand rendering for exactly this reason). A page whose perf floor
 * requires real ISR cannot afford that, so this gate trades the in-place admin
 * preview away: the prerender bakes a plain 404 while hidden, and revalidation
 * re-runs the check so an admin's `hidden: false` record flips the route live
 * within the revalidate window — still a runtime data change, no deploy.
 *
 * Admin preview for such a page lives on a sibling admin-gated route instead
 * (e.g. /line/preview), which is free to be dynamic.
 */
export async function assertPageVisibleStatic(path: string): Promise<void> {
  const hidden = await getEffectiveHiddenPaths();
  if (hidden.includes(path)) notFound();
}

/**
 * Small notice admins see on a page that is hidden from the public.
 *
 * This banner is also the marker for "the bytes on screen are an admin-only
 * render", so it carries <HiddenPreviewEvict/> — a render-nothing client child
 * that pulls this pathname back out of the service worker's shell cache. See
 * hidden-preview-evict.tsx for why the worker can't make that call itself.
 */
export function HiddenPageBanner() {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-4">
      <HiddenPreviewEvict />
      <p className="rounded-xl border border-coral/40 bg-coral/10 px-4 py-2 text-sm font-medium text-coral-deep">
        Hidden page — visitors get a 404. Only admins can see this preview.
        Unhide it in Admin → Site content.
      </p>
    </div>
  );
}
