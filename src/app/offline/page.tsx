import type { Metadata } from "next";

import { PageHeader, Section, Card, Callout } from "@/components/ui";

export const metadata: Metadata = {
  title: "Offline",
  description:
    "You're offline. Here's what Explore Kingston can still show you, and what you should double-check once you're back on a signal.",
  // This page only makes sense as a fallback — it should never be a search
  // result. robots.ts covers /admin, /portal and /api; this is the one public
  // route that wants its own noindex.
  robots: { index: false, follow: false },
  // The one thing that tells the browser WHICH document it is looking at. The
  // worker returns this page as the fallback for a failed navigation to some
  // other url (/stay, /map, …) and leaves that url in the address bar, so
  // nothing derived from the url — usePathname() included — can tell; a meta
  // rides inside the HTML, so it is right in every case. Renders as
  // <meta name="vk-offline-fallback" content="1">, which <OfflineBanner/> in
  // src/components/pwa.tsx reads to drop its "saved info from HH:MM" clause:
  // this page is statically prerendered, so its timestamp is BUILD time and
  // there is no saved anything on it to date.
  other: { "vk-offline-fallback": "1" },
};

/*
 * The offline fallback (E13). The service worker precaches this page at
 * install, so it is the LAST thing standing when a navigation fails and no
 * saved copy of the requested page exists.
 *
 * It is served under the url that failed — a visitor who tapped "Stay" is
 * reading this document with /stay still in the address bar — which is why the
 * metadata above carries the vk-offline-fallback marker. A direct visit to
 * /offline is the rare case, not the normal one.
 *
 * Hard constraint: this page must stay statically renderable. No cookies(),
 * no headers(), no getSide(), no assertPageVisible, nothing from @/lib/auth.
 * A dynamic API here means the page is rendered per request — which is exactly
 * the request that just failed. It would be cached as an error, or not at all.
 *
 * The links below are plain <a> anchors, not <Link>. Client-side navigation
 * fetches an RSC payload rather than a document, which the worker's navigation
 * branch does not intercept; a real navigation hits the cache and works.
 */
export default function OfflinePage() {
  return (
    <>
      <PageHeader
        eyebrow="No connection"
        title="You’re offline — here’s what still works"
        intro="Kingston has thin spots: the ferry holding lane, the beach at Point No Point, most of the way to Hansville. Pages you already opened are saved on this device."
      />

      <Section title="Try these">
        <Card>
          <ul className="space-y-3 text-sm text-ink-soft">
            <li>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a real
                  navigation is the point: <Link> fetches an RSC payload the service
                  worker's navigation branch does not serve from cache. */}
              <a className="font-semibold text-tide-deep underline underline-offset-2" href="/">
                Home
              </a>{" "}
              — the next few sailings, if you loaded them before you lost signal.
            </li>
            <li>
              <a
                className="font-semibold text-tide-deep underline underline-offset-2"
                href="/ferry"
              >
                Ferry times
              </a>{" "}
              — the full board from the last time it loaded.
            </li>
          </ul>
          <p className="mt-4 text-sm text-ink-soft">
            Anything you haven&apos;t opened on this device yet won&apos;t be here. Pull the page
            up again once you have a bar or two and it will save itself for next time.
          </p>
        </Card>
      </Section>

      <Section title="One honest warning">
        <Callout title="Ferry times shown offline are a saved copy" tone="coral">
          <p>
            They are whatever this device last downloaded — they are not live, and they will not
            reflect a cancelled boat, a vessel swap, or a service alert issued since. Washington
            State Ferries is always the authority. When you have signal, check{" "}
            {/* Plain anchor, not ExternalLink: that component fires an outbound
                tracking beacon, which cannot be delivered from this page and is
                not worth counting from it anyway. */}
            <a
              className="font-semibold text-tide-deep underline underline-offset-2"
              href="https://wsdot.wa.gov/travel/washington-state-ferries"
              target="_blank"
              rel="noopener noreferrer"
            >
              wsdot.wa.gov/ferries
            </a>{" "}
            before you count on a sailing. If the saved board and WSDOT disagree, WSDOT wins.
          </p>
        </Callout>
      </Section>
    </>
  );
}
