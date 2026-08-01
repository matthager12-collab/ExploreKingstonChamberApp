// E33 — /line, the Line Lander: the page for people sitting in the SR-104
// ferry line, reached by QR code on a physical roadside sign. `vk/line-lander`.
//
// SHIPS DARK. /line is in DEFAULT_HIDDEN_PAGES (src/lib/page-visibility.tsx):
// with no site-pages record it 404s for EVERYONE, and goes live only when an
// operator writes an explicit `hidden: false` record from Admin → Site content
// (a runtime data change — no deploy; docs/LINE-LANDER.md).
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
};

export default async function LinePage() {
  await assertPageVisibleStatic("/line");
  return <LineLander />;
}
