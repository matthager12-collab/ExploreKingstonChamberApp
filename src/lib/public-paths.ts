// Which public routes render which content store.
//
// WHY THIS EXISTS. Every public page is ISR with `revalidate = 60`, so a
// Chamber approval or admin edit took up to a minute to appear. To a
// volunteer that reads as "it didn't work" — they click approve again, or
// they tell a member the site is broken. The admin routes call
// revalidatePublicPaths() after a write so the next visitor sees the change
// immediately, instead of the change waiting out a timer.
//
// KEEPING IT HONEST. tests/unit/public-paths.test.ts statically scans the
// (site) pages for each store's PUBLIC getter and fails if a page reads a
// store this map does not list — so adding a page that renders restaurants
// without updating this file is a CI failure, not a silent staleness bug.
// The scan can only see getters called in page files; reads that happen
// inside a component are listed under COMPONENT_MEDIATED below, with the
// component named so the next person can verify it.

/** Public routes that render each store's records, keyed by store name
 *  (same vocabulary as record.store / STORE_SCHEMAS). */
export const PUBLIC_PATHS_BY_STORE: Record<string, readonly string[]> = {
  // /line renders open restaurants on its map (see COMPONENT_MEDIATED).
  restaurants: ["/eat", "/line"],
  lodging: ["/stay"],
  // /give lists organizations; the home page's "what's on" reads events.
  charities: ["/give"],
  "volunteer-needs": ["/give"],
  events: ["/events", "/give", "/"],
  // /ferry embeds the terminal cams alongside the sailing board.
  webcams: ["/webcams", "/ferry"],
  itineraries: ["/itineraries"],
  // Directory-public slice (2026-08-12): /directory is the ranked public
  // index — a publish, approval, or claim shows there within a click, not a
  // timer. The /directory/[id] profiles are force-dynamic and need no entry.
  directory: ["/directory"],
};

/** Store reads that happen inside a COMPONENT rather than a page file, so the
 *  static scan cannot see them. Each entry names the component so a reviewer
 *  can check it still holds. Keep in sync by hand — the test asserts these
 *  paths exist in the map above, not that the list is exhaustive. */
export const COMPONENT_MEDIATED: { path: string; store: string; via: string }[] = [
  { path: "/line", store: "restaurants", via: "src/components/line-lander.tsx" },
];

/** Paths to refresh for a store; unknown stores refresh nothing. */
export function publicPathsForStore(store: string): readonly string[] {
  return PUBLIC_PATHS_BY_STORE[store] ?? [];
}

/** Mark every public route that renders `store` for revalidation, so the next
 *  visitor sees an approval or admin edit immediately rather than waiting out
 *  the 60s ISR window.
 *
 *  ROUTE HANDLERS ONLY. In a route handler this marks the path and the refresh
 *  happens on the next visit (Next 16 semantics) — which is what we want, and
 *  why this is not called from src/lib/moderation.ts: that module is invoked
 *  directly by unit tests outside any request scope, where revalidatePath
 *  throws. Cache invalidation is a boundary concern; keep it at the boundary.
 *
 *  Never throws: a failed refresh must not fail the admin's write, which has
 *  already been committed and audited by the time we get here. The worst case
 *  is the old 60s wait. */
export async function revalidatePublicPathsForStore(store: string): Promise<void> {
  const paths = publicPathsForStore(store);
  if (paths.length === 0) return;
  try {
    const { revalidatePath } = await import("next/cache");
    for (const path of paths) revalidatePath(path);
  } catch (err) {
    console.warn(
      `revalidate: could not refresh public paths for '${store}' ` +
        `(${paths.join(", ")}) — the change appears within the ISR window instead.`,
      err,
    );
  }
}
