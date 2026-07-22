// E11: the public privacy/accessibility pages and the footer links render the
// load-bearing content — every retention rule, the notice version, the WCAG
// target, and both sitewide legal links (AC-7, AC-8).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PrivacyPage from "@/app/(site)/privacy/page";
// E14 slice 4 made /accessibility an async data shell (it reads the copy
// overlay so the Chamber can edit the header, the feedback promise, and the
// "last reviewed" date without a deploy). renderToStaticMarkup cannot await a
// server component, so the statement itself — every word a visitor reads — was
// split into this synchronous component and is rendered here directly, with an
// empty override map so copyText() resolves to the registry fallbacks. Same
// markup, same assertions, plus the new slice-4 ones below.
import { AccessibilityStatement } from "@/app/(site)/accessibility/statement";
import { SiteFooter } from "@/components/site-footer";
import { PRIVACY_NOTICE_VERSION, RETENTION_POLICY } from "@/lib/privacy/policy";

describe("privacy page", () => {
  const html = renderToStaticMarkup(createElement(PrivacyPage));

  it("renders one row per RETENTION_POLICY entry (schedule = manifest, no drift)", () => {
    for (const rule of RETENTION_POLICY) {
      expect(html, rule.store).toContain(rule.label);
    }
  });

  it("displays the current notice version", () => {
    expect(html).toContain(PRIVACY_NOTICE_VERSION);
  });

  it("names the MHMDA anchors and the never-track-health floor", () => {
    expect(html).toContain("RCW 19.373");
    expect(html).toContain("My Health My Data");
    expect(html.toLowerCase()).toContain("food or health");
  });

  it("states the Chamber membership-records role and the money-lives-in-QuickBooks floor", () => {
    expect(html).toContain("membership records system");
    expect(html).toContain("QuickBooks");
  });

  it("renders the access/delete intake form and the consent/withdraw section", () => {
    // The form's kind options + contact field must be present (not just linked).
    expect(html).toContain("See my data");
    expect(html).toContain("Delete my data");
    expect(html).toContain("How can we reach you");
    expect(html.toLowerCase()).toContain("withdraw");
  });

  it("does NOT overclaim: the hunt precise-location exception is disclosed, not contradicted", () => {
    // The blanket "never a coordinate" must be scoped — the page must also
    // disclose that scavenger-hunt check-ins keep precise location 12 months
    // (matching the retention table + /about), or the notice contradicts itself.
    expect(html.toLowerCase()).toContain("scavenger hunt");
    expect(html).toContain("precise");
    expect(html).toContain("12 months");
  });
});

describe("accessibility page", () => {
  const html = renderToStaticMarkup(createElement(AccessibilityStatement, { copy: {} }));

  it("names the WCAG 2.1 AA target and the honest map limitation", () => {
    expect(html).toContain("WCAG 2.1 AA");
    expect(html.toLowerCase()).toContain("map");
  });

  it("states the VERIFIED ADA deadline (docs/OPERATIONS.md §9 item 15, closed 2026-07-21)", () => {
    // This assertion was previously inverted: the date was withheld while the
    // human gate was open. It is now verified against ada.gov's own compliance
    // table (0-49,999 persons and special district governments -> April 26,
    // 2028), so the statement cites it.
    expect(html).toContain("April 26, 2028");
  });

  it("scopes the deadline honestly instead of claiming the Chamber is covered", () => {
    expect(html).toContain("Title II");
    // The Chamber is a private nonprofit; Title II binds public entities. The
    // statement must say the deadline does not bind this site and that we adopt
    // it voluntarily — overclaiming legal coverage would be its own inaccuracy.
    expect(html.toLowerCase()).toContain("does not bind this site");
    expect(html).toMatch(/fewer than 50,000|special district/i);
  });

  it("records that the deadline has moved, so a stale date is noticeable", () => {
    // DOJ extended it a year (from April 26, 2027) effective 2026-04-20. Saying
    // so is what stops the next reviewer from assuming the date is settled.
    expect(html).toContain("April 26, 2027");
  });

  it("gives a feedback channel that is BOTH an email and a phone number (M-14-01/FR-47)", () => {
    expect(html).toMatch(/href="mailto:[^"]+"/);
    expect(html).toMatch(/href="tel:[^"]+"/);
    // A response-time promise, not just an address.
    expect(html.toLowerCase()).toContain("business days");
  });

  it("says how conformance is checked, and describes the full gate as PLANNED", () => {
    expect(html.toLowerCase()).toContain("axe");
    // The per-route gate is deferred to a later slice — the statement must not
    // claim it as shipped.
    expect(html.toLowerCase()).toContain("planned and not finished");
    // The manual checklist and its cadence.
    expect(html.toLowerCase()).toContain("every quarter");
  });

  it("names a list-based alternative for each frozen interactive map", () => {
    // The maps are a frozen zone, so the honest answer is a text equivalent —
    // and the statement has to say where it is.
    expect(html).toContain("Every lot, in words");
    expect(html).toContain('href="/parking"');
    expect(html).toContain('href="/simple"');
    expect(html).toContain('href="/print"');
  });

  it("carries a last-reviewed date so the annual review is visible", () => {
    expect(html).toContain("Last reviewed");
  });
});

describe("site footer legal links", () => {
  it("links Privacy and Accessibility on every page", () => {
    const html = renderToStaticMarkup(createElement(SiteFooter, {}));
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/accessibility"');
  });
});
