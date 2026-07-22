// The public site's chrome — everything that used to live in the root layout
// before E22 split the app into (site) and (kiosk) route groups.
//
// WHY THIS IS A COMPONENT AND NOT JUST (site)/layout.tsx: two different route
// files need the identical chrome. src/app/(site)/layout.tsx wraps every public
// page in it, and src/app/not-found.tsx wraps the branded 404 in it — and that
// 404 sits at the app ROOT, outside every group, because a URL that matches no
// route belongs to no group. Before E22 it inherited nav and footer from the
// root layout for free; without this component it would render bare, which is
// the one place a visitor most needs a way back into the site.
//
// It is a server component and reads two overlay stores. Neither read touches
// cookies() or headers(), which is load-bearing: a dynamic API reachable from
// here would opt every public page out of static rendering — the audited v1 ISR
// trap. tests/server/static-rendering.test.ts reads the build's own
// prerender-manifest to prove it has not happened, and
// tests/unit/a11y-static-invariants.test.ts greps this file and both layouts
// for that import. (Deliberately not naming the module here: that guard is a
// plain substring grep, and naming it in a comment trips it — the same
// self-trip hazard the guard's own file header documents.)

import type { ReactNode } from "react";

import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { Tracker, WebVitals } from "@/components/tracker";
import PwaClient from "@/components/pwa";
import { getCopyOverrides } from "@/lib/stores/site-store";
import { getEffectiveHiddenPaths } from "@/lib/page-visibility";
import { CopyProvider } from "@/lib/copy-context";

export async function SiteChrome({ children }: { children: ReactNode }) {
  // Admin-hidden pages drop out of the nav and footer site-wide; admin copy
  // overrides are provided to client components via CopyProvider (server
  // components read them directly with copyText()).
  //
  // E14: the EFFECTIVE list, so a default-hidden page (/es, dark until a
  // bilingual reviewer signs off) never appears as a footer link to a 404.
  const [hiddenPaths, copyOverrides] = await Promise.all([
    getEffectiveHiddenPaths(),
    getCopyOverrides(),
  ]);
  // E13: the honest "as of" for the offline banner. Genuinely per-request on /
  // and /ferry (both dynamic via cookies()), and the moment of the prerender on
  // the ISR pages — which is exactly the age of the copy a visitor reads from
  // the service worker cache. /offline is deliberately static, so its value is
  // build time; OfflineBanner suppresses the clause there for that reason.
  const renderedAt = new Date().toISOString();
  return (
    <>
      {/* E14: the skip link is deliberately the first element the chrome
          renders, and the chrome is the first child of <body>, so this is still
          the first thing Tab reaches — keyboard and switch users clear the whole
          header/nav in one keystroke. sr-only until focused, then a full-size
          (>=44px) brand-token chip so sighted keyboard users can see it too. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-sound-deep focus:px-4 focus:py-3 focus:text-base focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <CopyProvider overrides={copyOverrides}>
        <Tracker />
        <WebVitals />
        <PwaClient renderedAt={renderedAt} />
        <SiteNav hiddenPaths={hiddenPaths} />
        {/* id="main" is the skip link's target (E14). tabIndex={-1} makes it
            programmatically focusable, which is what actually MOVES focus on
            activation: without it Safari (and iOS VoiceOver) scroll the page
            but leave focus on the skip link, so the next Tab goes back to the
            top of the header and the skip does nothing. Programmatic focus on
            a tabindex=-1 container is not :focus-visible in any current
            engine, so no ring appears. */}
        <main id="main" tabIndex={-1} className="flex-1">
          {children}
        </main>
        <SiteFooter hiddenPaths={hiddenPaths} copy={copyOverrides} />
      </CopyProvider>
    </>
  );
}
