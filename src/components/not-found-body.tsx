import Link from "next/link";

import { PageHeader, Section, Card } from "@/components/ui";

/*
 * The body of the branded 404 (E13). Split out of src/app/not-found.tsx by E22
 * so the copy lives somewhere a second renderer can reach it without
 * duplicating it — see that file for which 404s actually reach this component
 * and which get Next's bare `__next_error__` document instead.
 *
 * Two very different visitors read this:
 *
 *   1. Someone who mistyped a URL or followed a dead link.
 *   2. Someone who opened a real page that a Chamber admin has HIDDEN — twelve
 *      public pages call notFound() through assertPageVisible(), and two more
 *      sit behind feature flags.
 *
 * The copy has to be true for both, which is why it says "isn't here right now"
 * rather than "doesn't exist".
 *
 * The "Explore Kingston" wordmark also arrives via SiteNav/SiteFooter, but it is
 * stated in the body too so the branding does not depend on the chrome.
 */
export function NotFoundBody() {
  return (
    <>
      <PageHeader
        eyebrow="404"
        title="That page isn’t here right now"
        intro="It may have moved, it may not be published yet, or the address may have a typo in it. Explore Kingston has plenty else going on."
      />

      <Section title="Where to go instead">
        <Card>
          <ul className="space-y-3 text-sm text-ink-soft">
            <li>
              <Link
                className="font-semibold text-tide-deep underline underline-offset-2"
                href="/"
              >
                Home
              </Link>{" "}
              — the next few sailings and what&apos;s open now.
            </li>
            <li>
              <Link
                className="font-semibold text-tide-deep underline underline-offset-2"
                href="/ferry"
              >
                Ferry times
              </Link>{" "}
              — the full Kingston–Edmonds board.
            </li>
            <li>
              <Link
                className="font-semibold text-tide-deep underline underline-offset-2"
                href="/events"
              >
                Events
              </Link>{" "}
              — what&apos;s happening in town this week.
            </li>
          </ul>
          <p className="mt-4 text-sm text-ink-soft">
            If you followed a link from somewhere on this site and expected a page here, the
            Chamber would genuinely like to know — that is a broken link on our end, not yours.
          </p>
        </Card>
      </Section>
    </>
  );
}
