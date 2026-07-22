import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader, Section, Card } from "@/components/ui";
import { copyText } from "@/lib/stores/site-store";

/**
 * A link to one of the text alternatives — but only while that page is actually
 * reachable. An operator can hide any of them from Admin → Site content, and
 * /es is hidden by default; the page that promises a disabled reader a working
 * alternative is the last place that may hand out a 404, so a hidden page
 * degrades to its plain name instead of linking.
 */
function Alt({
  href,
  hiddenPaths,
  children,
}: {
  href: string;
  hiddenPaths: string[];
  children: ReactNode;
}) {
  if (hiddenPaths.includes(href)) return <span>{children}</span>;
  return (
    <Link href={href} className="underline">
      {children}
    </Link>
  );
}

/** `tel:` href for a printed-style number ("360-860-2239" → "tel:+13608602239"). */
function telHref(phone: string): string {
  return `tel:+1${phone.replace(/\D/g, "")}`;
}

// Code-owned, deliberately: an accessibility statement is a public commitment,
// so the conformance and legal-posture paragraphs below live in code and change
// through review, not through the copy editor. Only the header, the feedback
// promise, and the "last reviewed" date are copy-registry blocks — those are the
// parts an operator genuinely maintains (docs/OPERATIONS.md §13.3 asks for an
// annual review of that date).
//
// THE ADA DATE IS DELIBERATELY ABSENT. The small-entity compliance date is left
// for human verification rather than asserted — docs/OPERATIONS.md §9 item 15 is
// the open gate: "verify the ADA small-entity compliance deadline date before
// citing it anywhere (the accessibility page deliberately does not state a
// date)". The "A note on the law" section below is written so a verified date
// drops into ONE sentence when that gate closes, with no restructuring: the
// deadline sentence stands alone and names no date. Do not add one here without
// closing item 15 first.
//
// Split out of page.tsx as a SYNCHRONOUS component on purpose: the page itself
// is async (it reads the copy overlay), and tests/unit/privacy-pages.test.ts
// renders this statement directly with renderToStaticMarkup, which cannot await
// a server component. Passing `copy` in keeps that test rendering the real
// markup — with the registry fallbacks, since an empty override map resolves to
// them — instead of a stand-in.
export function AccessibilityStatement({
  copy,
  hiddenPaths = [],
}: {
  copy: Record<string, string>;
  hiddenPaths?: string[];
}) {
  const phone = copyText(copy, "contact.phone.number");
  const email = copyText(copy, "contact.email.address");

  return (
    <>
      <PageHeader
        eyebrow={copyText(copy, "accessibility.header.eyebrow")}
        title={copyText(copy, "accessibility.header.title")}
        intro={copyText(copy, "accessibility.header.intro")}
      />

      <Section title="Our target">
        <Card>
          <p className="text-base text-ink">
            We aim to meet <strong>WCAG 2.1 AA</strong> (the Web Content Accessibility Guidelines,
            level AA) across the whole site — readable text and contrast, keyboard navigation,
            labeled controls, and content that works with screen readers.
          </p>
          <p className="mt-3 text-base text-ink">
            WCAG 2.1 AA is the standard we hold ourselves to. We also try to meet two newer
            WCAG 2.2 rules — bigger tap targets, and keeping the focused control visible — but we
            do not claim them yet.
          </p>
        </Card>
      </Section>

      <Section title="Current status">
        <Card>
          <p className="text-base text-ink">
            <strong>Partially conformant, actively improving.</strong> Most of the site meets
            WCAG 2.1 AA, and we test as we build. Some areas are still being brought up to that
            standard — the known ones are listed below.
          </p>
        </Card>
      </Section>

      <Section title="How we check">
        <Card>
          <ul className="space-y-3 text-base text-ink">
            <li>
              <strong>Automated checks on every change.</strong> An accessibility scanner (axe)
              runs against a real build of the site before any change can ship, and blocks any new
              <em> kind</em> of serious or critical problem on the pages it covers. A short list of
              problems we already know about is recorded alongside it so they cannot be quietly
              forgotten — which also means the check does not, today, catch a fresh instance of a
              problem already on that list. The next point is how we are closing that gap.
            </li>
            <li>
              <strong>Coming next: every page, every rule.</strong> We are extending that check
              from a sample of pages to every page on the site, at every severity, with a rule that
              a new page cannot be added without being checked. That work is planned and not
              finished — we say so here rather than claim it early.
            </li>
            <li>
              <strong>Hand testing, four times a year.</strong> Automated tools catch only part of
              what matters. Every quarter a person walks the main pages with a screen reader
              (VoiceOver or NVDA), navigates the site using only a keyboard, checks it at 200% zoom,
              and checks that nothing relies on color alone. The checklist is public, in our
              repository, at <code>docs/ACCESSIBILITY.md</code>.
            </li>
          </ul>
        </Card>
      </Section>

      <Section title="Things that may help">
        <Card>
          <ul className="space-y-3 text-base text-ink">
            <li>
              <strong>Easy read.</strong> A switch labelled{" "}
              <em>{copyText(copy, "simple.toggle.label")}</em> makes the type bigger across the
              whole site, drops the background texture behind the words, and darkens the lighter
              grey text. It is in the <strong>More</strong> menu — the &ldquo;More&rdquo; button in
              the bottom bar on a phone, or at the end of the menu bar on a computer — and also at
              the top of <Alt hiddenPaths={hiddenPaths} href="/simple">Kingston basics</Alt>. The site remembers it on your
              device.
            </li>
            <li>
              <strong>A page you can print.</strong>{" "}
              <Alt hiddenPaths={hiddenPaths} href="/print">The printable page</Alt> puts today&rsquo;s boats and the phone
              numbers on one sheet of paper, with the site&rsquo;s menus and footer left off.
            </li>
            <li>
              <strong>Reduced motion.</strong> If your device is set to reduce motion, we turn off
              the small animations rather than ask you to.
            </li>
          </ul>
        </Card>
      </Section>

      <Section title="Known limitations">
        <Card>
          <ul className="space-y-3 text-base text-ink">
            <li>
              <strong>The interactive maps.</strong> The map on the parking page, the town map, and
              the ferry vessel map are drawn with a mapping library whose canvas is hard to use with
              a screen reader or a keyboard. We do not consider a map an acceptable only-way to get
              information, so every map has a list-based alternative that carries the same facts as
              text:
              <ul className="mt-2 ml-5 list-outside list-disc space-y-1">
                <li>
                  <Alt hiddenPaths={hiddenPaths} href="/parking">Parking</Alt> — &ldquo;Every lot, in words&rdquo; below the
                  map lists every lot by name, with its parking type spelled out and a
                  plain-language summary of the rules that apply to it.
                </li>
                <li>
                  <Alt hiddenPaths={hiddenPaths} href="/ferry">Ferry</Alt> — the departure board and the written line guidance
                  carry the ferry information without the vessel map.
                </li>
                <li>
                  <Alt hiddenPaths={hiddenPaths} href="/eat">Eat &amp; Drink</Alt> and <Alt hiddenPaths={hiddenPaths} href="/stay">Stay</Alt> — every
                  place on the town map is also a card in these lists, with address, phone, and
                  hours.
                </li>
                <li>
                  <Alt hiddenPaths={hiddenPaths} href="/simple">Kingston basics</Alt> and{" "}
                  <Alt hiddenPaths={hiddenPaths} href="/print">the printable page</Alt> — the shortest text-only route to the
                  boats, the phone numbers, and the parking and restroom basics.
                </li>
              </ul>
            </li>
            <li>
              <strong>Third-party embeds.</strong> The live webcams and the highway traffic map come
              from other providers, and we have limited control over their accessibility.
            </li>
            <li>
              <strong>Business-supplied content.</strong> Photos and descriptions written by local
              businesses are reviewed by the Chamber, but wording and image quality vary.
            </li>
          </ul>
        </Card>
      </Section>

      <Section title="Give us feedback">
        <Card>
          <p className="text-base text-ink">{copyText(copy, "accessibility.feedback.body")}</p>
          <ul className="mt-4 space-y-2 text-lg text-ink">
            <li>
              Email:{" "}
              <a href={`mailto:${email}`} className="font-semibold underline underline-offset-2">
                {email}
              </a>
            </li>
            <li>
              Phone:{" "}
              <a href={telHref(phone)} className="font-semibold underline underline-offset-2">
                {phone}
              </a>
            </li>
          </ul>
          <p className="mt-4 text-base text-ink">
            {copyText(copy, "accessibility.feedback.response")}
          </p>
          <p className="mt-3 text-base text-ink">
            If your message is about your own information rather than accessibility, use the{" "}
            <Link href="/privacy" className="underline">
              data-request form
            </Link>{" "}
            instead.
          </p>
        </Card>
      </Section>

      <Section title="A note on the law">
        <Card>
          <p className="text-base text-ink">
            Public-facing services are increasingly expected to meet WCAG 2.1 AA under the
            Americans with Disabilities Act. This site is built and operated with the Greater
            Kingston Chamber of Commerce, and WCAG 2.1 AA is the standard we build to for that
            reason as much as any other.
          </p>
          <p className="mt-3 text-base text-ink">
            Under ADA Title II, the U.S. Department of Justice requires public entities serving
            fewer than 50,000 people, and special district governments, to meet WCAG 2.1 AA by{" "}
            <strong>{copyText(copy, "accessibility.ada.deadline")}</strong>. The Chamber is a
            private nonprofit rather than a public entity, so that deadline does not bind this site
            directly. We hold ourselves to it anyway — the people it exists to protect use this
            site too.
          </p>
          <p className="mt-3 text-base text-ink">
            That date has moved before: the Department extended it by a year, from April 26, 2027,
            in a rule effective April 20, 2026. We re-check it whenever we review this statement.
          </p>
        </Card>
      </Section>

      <Section title="This statement">
        <Card>
          <p className="text-base text-ink">
            Last reviewed: {copyText(copy, "accessibility.lastReviewed")}. We review this statement
            at least once a year, and whenever a significant change ships.
          </p>
        </Card>
      </Section>
    </>
  );
}
