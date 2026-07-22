import { NotFoundBody } from "@/components/not-found-body";
import { SiteChrome } from "@/components/site-chrome";

/*
 * The 404 for URLs that match NO route at all — a typo, a dead inbound link, a
 * scanner probing for /wp-admin.
 *
 * Server component by convention: not-found components accept NO props — do not
 * add "use client" and do not destructure anything. Next injects the noindex
 * meta for 404s on its own.
 *
 * E22: this file stays at the APP ROOT, outside both route groups, because a URL
 * that matches no route belongs to no group — move it into (site) and mistyped
 * URLs fall back to Next's unbranded built-in 404. The cost of sitting at the
 * root is that it no longer inherits nav and footer from the layout, so it
 * renders <SiteChrome/> itself and E13's behaviour is preserved exactly.
 *
 * WHAT THIS FILE DOES NOT COVER, measured rather than assumed. A page that calls
 * notFound() itself — /ferry/plan, /es, /events/suggest, and the twelve pages
 * behind assertPageVisible() — does NOT render this component. Next answers
 * those with its own bare `__next_error__` document (zero navs, zero footers).
 * That is pre-existing, not something the route-group split caused: the same
 * probe against main at e95bbb5 returns byte-identical counts. An in-group
 * src/app/(site)/not-found.tsx was written and then deleted during E22 because
 * it changed nothing — Next never routed those 404s to it. If branding those
 * pages ever becomes worth doing, it needs a different mechanism (render the
 * 404 body from the page instead of calling notFound()), not another
 * not-found.tsx.
 */
export default function NotFound() {
  return (
    <SiteChrome>
      <NotFoundBody />
    </SiteChrome>
  );
}
