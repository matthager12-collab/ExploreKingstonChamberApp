import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader, Section, Card } from "@/components/ui";
import { PrivacyRequestForm } from "@/components/privacy-request-form";
import { PRIVACY_NOTICE_CHANGELOG, PRIVACY_NOTICE_VERSION, RETENTION_POLICY } from "@/lib/privacy/policy";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "How Explore Kingston handles data: opt-in, area-only location; no consumer health data; a plain-language retention schedule; and how to see or delete your data.",
};

// The version and the retention table are rendered from the policy manifest
// (src/lib/privacy/policy.ts) — the SAME manifest the purge job executes — so
// the published promise and the enforcing code can never drift. This page is
// code-owned (not admin-editable copy): its claims are legal statements.
export default function PrivacyPage() {
  return (
    <>
      <PageHeader
        eyebrow="Privacy"
        title="Your privacy on Explore Kingston"
        intro="This site is built to collect as little as possible — and to say plainly what that is, for how long, and how to get it removed."
      />

      <Section title="The short version">
        <Card>
          <ul className="space-y-2 text-sm text-ink-soft">
            <li>No accounts, no tracking cookies, no third-party analytics or ad tech.</li>
            <li>
              We never collect consumer health data. For <strong>visitor analytics</strong>, when
              you use the &ldquo;what&rsquo;s open near me&rdquo; feature we store only the
              neighborhood your location falls in — never a coordinate.
            </li>
            <li>
              The one exception is the <strong>scavenger hunt</strong>: a check-in you choose to
              submit includes your photo and, if you allow it, your precise location. Those are sent
              to the hunt organizers and kept for 12 months (see the schedule below).
            </li>
            <li>
              We never record visits to food or health assistance resources — those taps are
              dropped and never stored.
            </li>
            <li>Everything we keep is on a published schedule and then deleted (see below).</li>
            <li>
              You can ask to see or delete your data at any time — no account required. We respond
              within 45 days.
            </li>
          </ul>
        </Card>
      </Section>

      <Section title="Washington&rsquo;s My Health My Data Act (RCW 19.373)">
        <Card>
          <p className="text-sm text-ink-soft">
            Washington&rsquo;s My Health My Data Act (RCW 19.373) protects &ldquo;consumer health
            data,&rdquo; which is defined broadly enough to include precise location that could
            imply a visit to a health service. Our approach is to stay outside that regulated core
            by <strong>never collecting consumer health data at all</strong>:
          </p>
          <ul className="mt-3 space-y-2 text-sm text-ink-soft">
            <li>
              <strong>Analytics location is opt-in and area-only.</strong> The &ldquo;what&rsquo;s
              open near me&rdquo; feature asks before it uses your location, and only after you
              accept the browser&rsquo;s own permission prompt. We classify the reading into a named
              neighborhood on the server and immediately discard the coordinates — for analytics,
              only the neighborhood bucket is stored, and only in aggregate. (The scavenger hunt is
              separate — see below — because there the precise check-in is content you choose to
              send.)
            </li>
            <li>
              <strong>We never track use of food or health resources.</strong> Taps on
              food-bank or health-assistance links are dropped at our servers and never recorded —
              not counted, not sampled, nothing.
            </li>
            <li>
              <strong>You have rights.</strong> You can see or delete your data (below); a legal
              hold can pause a deletion only where the law requires records to be preserved, and we
              log that instead.
            </li>
          </ul>
        </Card>
      </Section>

      <Section title="What we keep, and for how long">
        <Card>
          <p className="mb-4 text-sm text-ink-soft">
            This schedule is enforced by an automated job that runs against the same list shown
            here. When a window passes, the data is deleted.
          </p>
          {/* E14 (WCAG 2.1.1, axe scrollable-region-focusable): a scroll
              container that nothing inside it can focus is unreachable by
              keyboard — the table is wider than a phone, so a keyboard-only
              reader could not see the right-hand column at all. tabIndex makes
              the region itself scrollable with the arrow keys; role+label give
              it a name so it is announced as something rather than an anonymous
              stop in the tab order. */}
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Data retention schedule (scrollable)"
          >
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-sand text-ink">
                  <th className="py-2 pr-4 font-semibold">What</th>
                  <th className="py-2 pr-4 font-semibold">How long we keep it</th>
                </tr>
              </thead>
              <tbody>
                {RETENTION_POLICY.map((rule) => (
                  <tr key={rule.store} className="border-b border-sand/50 align-top">
                    <td className="py-2 pr-4 text-ink-soft">{rule.description}</td>
                    <td className="py-2 pr-4 whitespace-nowrap text-ink">{rule.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      <Section title="Consent, and how to withdraw it">
        <Card>
          <p className="text-sm text-ink-soft">
            Before the analytics feature uses your device location, it asks — with a plain
            description of what happens (it sorts a list by distance and adds one anonymous
            neighborhood-level count to Kingston&rsquo;s visitor stats). Declining loses nothing:
            the list still works, sorted by walking time from the ferry dock. You can withdraw
            consent any time by declining the next prompt or clearing your browser&rsquo;s site
            data; for analytics, nothing tied to you persists between sessions.
          </p>
          <p className="mt-3 text-sm text-ink-soft">
            The scavenger hunt is different: a check-in you submit is content you send to the hunt
            organizers on purpose, so it is kept for 12 months (see the schedule above). To have a
            submission removed sooner, use the delete form below.
          </p>
        </Card>
      </Section>

      <Section title="Member &amp; business data">
        <Card>
          <p className="text-sm text-ink-soft">
            The app is becoming the Greater Kingston Community Chamber of Commerce&rsquo;s
            membership records system — the system of record for the Chamber&rsquo;s own member
            roster. Member contact data is held under the membership relationship and limited to
            the minimum the roster needs: organization identity, a contact name, email and phone,
            membership status and level, renewal and join dates, listing links, and a QuickBooks
            customer id. It honors each member&rsquo;s display preferences, is kept on the schedule
            above, is covered by the same see-and-delete process below, and is fully exportable —
            the Chamber owns all of its own data.
          </p>
          <p className="mt-3 text-sm text-ink-soft">
            <strong>Money never lives here.</strong> Dues invoicing and payments happen in
            QuickBooks; the app stores no payment-card data of any kind.
          </p>
        </Card>
      </Section>

      <Section title="See or delete your data">
        <Card>
          <p className="mb-4 text-sm text-ink-soft">
            You don&rsquo;t need an account. Tell us how to reach you and we&rsquo;ll respond within
            45 days. Because most of what the app records is anonymous, a request may simply confirm
            that nothing is tied to you.
          </p>
          <PrivacyRequestForm />
        </Card>
      </Section>

      <Section title="Version &amp; changes">
        <Card>
          <p className="text-sm text-ink-soft">
            Current notice version: <strong>{PRIVACY_NOTICE_VERSION}</strong>.
          </p>
          <ul className="mt-3 space-y-2 text-sm text-ink-soft">
            {PRIVACY_NOTICE_CHANGELOG.map((c) => (
              <li key={c.version}>
                <span className="font-medium text-ink">{c.version}</span> ({c.date}) — {c.summary}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-ink-soft">
            Questions? See our <Link href="/about" className="underline">about page</Link> or reach
            the Chamber. This notice is being reviewed by the Chamber; it is not a substitute for
            legal advice.
          </p>
        </Card>
      </Section>
    </>
  );
}
