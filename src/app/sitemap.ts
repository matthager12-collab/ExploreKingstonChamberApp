// Sitemap for search engines (E15 slice 5).
//
// MUST be dynamic. Next treats sitemap.ts as a Route Handler that is CACHED BY
// DEFAULT unless it opts out (see node_modules/next/dist/docs → metadata/
// sitemap.md). Cached, a page the Chamber hides in Admin → Site content would
// keep appearing here and keep being crawled into a 404. `force-dynamic` makes
// every fetch re-read the visibility store, matching robots.ts.
//
// Everything listed here comes from the DEFAULT store getters, which are
// live-only since E08 — so nothing `pending` or `draft` can leak into the
// sitemap. Never swap these for the *Admin variants.

import type { MetadataRoute } from "next";

import { getAllHunts } from "@/lib/hunt-store";
import { HIDEABLE_PAGES, UNLISTED_PAGES, getEffectiveHiddenPaths } from "@/lib/page-visibility";
import { siteUrl } from "@/lib/site-url";
import { getItineraries } from "@/lib/stores/itinerary-store";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const hidden = new Set(await getEffectiveHiddenPaths());
  const unlisted = new Set(UNLISTED_PAGES);
  // Two different reasons to leave a page out, and only one of them is about
  // the page being reachable. Hidden → it would 404 a crawler. Unlisted → it
  // answers 200 fine, we just do not advertise it (a QR-code landing page has
  // no business in search results). `visible` still gates the detail-page
  // blocks below, so an unlisted SECTION would keep listing its children —
  // fine today, since /line has none.
  const visible = (path: string) => !hidden.has(path);
  const listable = (path: string) => visible(path) && !unlisted.has(path);

  const entries: MetadataRoute.Sitemap = [
    { url: base, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
  ];

  for (const { path } of HIDEABLE_PAGES) {
    if (!listable(path)) continue;
    entries.push({
      url: `${base}${path}`,
      lastModified: new Date(),
      // The ferry board changes constantly; the rest are edited occasionally.
      changeFrequency: path === "/ferry" || path === "/events" ? "daily" : "weekly",
      priority: path === "/ferry" ? 0.9 : 0.8,
    });
  }

  // The ferry planner is a real public page but not admin-hideable on its own —
  // it belongs to /ferry, so it follows /ferry's visibility.
  if (visible("/ferry")) {
    entries.push({
      url: `${base}/ferry/plan`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  // Detail pages inherit their section's visibility: listing /itineraries/<slug>
  // while /itineraries is hidden would hand crawlers a set of 404s.
  if (visible("/itineraries")) {
    for (const itinerary of await getItineraries()) {
      entries.push({
        url: `${base}/itineraries/${itinerary.slug}`,
        lastModified: new Date(),
        changeFrequency: "monthly",
        priority: 0.7,
      });
    }
  }

  if (visible("/hunt")) {
    for (const hunt of await getAllHunts()) {
      entries.push({
        url: `${base}/hunt/${hunt.slug}`,
        lastModified: new Date(),
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }
  }

  // /events has no per-event detail route (E12 shipped the calendar as a single
  // page), so there is nothing further to enumerate here. If detail pages are
  // added later, list only live events — getEvents() is already live-only.

  return entries;
}
