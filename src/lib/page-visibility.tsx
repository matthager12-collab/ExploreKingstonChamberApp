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

import { notFound } from "next/navigation";
import { getSessionUser } from "./auth";
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
 */
export const DEFAULT_HIDDEN_PAGES: readonly string[] = ["/es"];

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
 */
export async function assertPageVisible(path: string): Promise<boolean> {
  const hidden = await getEffectiveHiddenPaths();
  if (!hidden.includes(path)) return false;
  const user = await getSessionUser();
  if (user?.role === "admin") return true;
  notFound();
}

/** Small notice admins see on a page that is hidden from the public. */
export function HiddenPageBanner() {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-4">
      <p className="rounded-xl border border-coral/40 bg-coral/10 px-4 py-2 text-sm font-medium text-coral-deep">
        Hidden page — visitors get a 404. Only admins can see this preview.
        Unhide it in Admin → Site content.
      </p>
    </div>
  );
}
