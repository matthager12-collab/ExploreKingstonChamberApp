// E33 — /line, the Line Lander: the page for people sitting in the SR-104
// ferry line, reached by QR code on a physical roadside sign. `vk/line-lander`.
//
// LIVE BUT UNLISTED since 2026-08-01. The page answers 200 to anyone with the
// URL — entry is the QR code on the physical SR-104 sign — but it is kept out
// of search: dropped from sitemap.xml via UNLISTED_PAGES, and `noindex` below.
// See UNLISTED_PAGES in src/lib/page-visibility.tsx for why there is no
// robots.txt Disallow to go with it (a blocked crawler never reads a noindex).
//
// It remains in DEFAULT_HIDDEN_PAGES, which is now a RESTORE-SAFETY NET rather
// than a ship-dark gate: an explicit `hidden: false` record makes it public
// today, and if that record is ever lost the page falls back to 404 instead of
// silently republishing itself. Do not remove it from that list as a tidy-up.
//
// STATIC + ISR, deliberately. The audience is parked on cellular in SR-104's
// documented dead zone (docs/FERRY-QUEUE-SENSING.md), so this page must be a
// cache hit, not a render: `revalidate = 60` is load-bearing, and the gate
// below is assertPageVisibleStatic — the cookie-free variant — because the
// standard assertPageVisible reads the admin session on the hidden branch and
// would mark the whole route dynamic at build time, making revalidate inert
// (see the function's own comment). The trade: no in-place admin preview —
// that lives at /line/preview instead, and the hidden 404 here is ISR-cached
// too, so the flip reaches visitors within the revalidate window.

import type { Metadata } from "next";
import { LineLander } from "@/components/line-lander";
import { assertPageVisibleStatic } from "@/lib/page-visibility";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Ferry line (SR-104)",
  description:
    "Waiting in the SR-104 ferry line at Kingston? Boarding-pass status right now, the next boats, live cameras on the line, and food you can order from where you're parked.",
  // `follow: true` on purpose: this page is not a search result we want, but its
  // links out to /parking and /ferry are pages we DO want crawled, and there is
  // no reason to dead-end a crawler that arrives here.
  robots: { index: false, follow: true },
};

export default async function LinePage() {
  await assertPageVisibleStatic("/line");
  return <LineLander />;
}
