// E14 slice 4 — the ship-dark guarantee for /es, and the accessibility statement.
//
// These are the epic's "curl localhost:3000/es" spot-checks expressed as server
// tests: same guarantee, but run in CI against the standalone production build
// the harness already boots (tests/server/global-setup.ts). `next start` does
// not work in this repo (output: "standalone"), so there is no other honest way.
//
// The /es assertions are the ONLY end-to-end proof that DEFAULT_HIDDEN_PAGES
// works: an unreviewed Spanish safety page must 404 for the public, be
// previewable by an admin, and go live only when an operator writes an explicit
// site-pages record. Every one of those three states is exercised below.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SAFETY_CONTENT, SAFETY_SECTION_ORDER } from "../../src/lib/i18n/safety-content";
import { BASE_URL } from "./config";

/** Seeded by tests/server/global-setup.ts. */
const ADMIN = { email: "ci@example.test", password: "ci-admin-password" };

/** Every distinct tel: target in the document. */
function telTargets(html: string): string[] {
  return [...new Set([...html.matchAll(/href="(tel:[^"]+)"/g)].map((m) => m[1]))];
}

/** React escapes these five in text nodes; the dictionary's prose contains
 *  apostrophes and quotes, so compare against the escaped form. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

async function get(path: string, cookie?: string): Promise<{ status: number; html: string }> {
  const res = await fetch(BASE_URL + path, {
    headers: cookie ? { cookie } : undefined,
    redirect: "manual",
  });
  return { status: res.status, html: await res.text() };
}

/** Sign in as the seeded admin and return the Cookie header value to replay.
 *  Done by hand rather than with a cookie jar because the session cookie is
 *  `Secure` under NODE_ENV=production and the harness serves plain http. */
async function adminCookie(): Promise<string> {
  const res = await fetch(BASE_URL + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ADMIN),
    redirect: "manual",
  });
  expect(res.ok, `admin login failed with ${res.status}`).toBe(true);
  const raw = res.headers.getSetCookie?.() ?? [];
  const set = raw.length > 0 ? raw : [res.headers.get("set-cookie") ?? ""];
  const session = set.map((c) => c.split(";")[0]).find((c) => c.startsWith("vk-session="));
  expect(session, `no vk-session cookie in the login response: ${set.join(" | ")}`).toBeTruthy();
  return session!;
}

/** Flip /es visibility through the real admin API — the same call the Admin →
 *  Site content toggle makes, so the test exercises the operator's actual path
 *  rather than a hand-written database row. */
async function setEsHidden(cookie: string, hidden: boolean): Promise<void> {
  const res = await fetch(BASE_URL + "/api/admin/site", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ action: "page", path: "/es", hidden }),
  });
  expect(res.ok, `setting /es hidden=${hidden} failed with ${res.status}`).toBe(true);
}

/** Poll until `predicate` holds. /simple is a statically rendered ISR page, so
 *  after the record flip it legitimately serves its cached HTML until the
 *  revalidation window passes — that is production behavior (docs/OPERATIONS.md
 *  §10, "Edits not showing up on public pages"), not a bug to assert away. */
async function poll(
  label: string,
  fn: () => Promise<boolean>,
  timeoutMs = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

describe("/es — the Spanish essentials page ships dark", () => {
  let cookie = "";

  beforeAll(async () => {
    cookie = await adminCookie();
  });

  afterAll(async () => {
    // Restore the fixture: back to hidden. The effective state is what matters
    // (DEFAULT_HIDDEN_PAGES makes "no record" and "hidden: true" identical for
    // a visitor), and the test database is truncated at the start of every run
    // by global-setup, so no row outlives this file in any meaningful way.
    if (cookie) await setEsHidden(cookie, true);
  });

  it("404s for an anonymous visitor while no site-pages record exists", async () => {
    const { status } = await get("/es");
    expect(
      status,
      "unreviewed hand-authored Spanish safety copy must not be publicly reachable",
    ).toBe(404);
  });

  it("renders for an admin, in Spanish, with the hidden-page banner", async () => {
    const { status, html } = await get("/es", cookie);
    expect(status).toBe(200);
    // WCAG 3.1.2 — the Spanish sits inside a lang="es" wrapper, and the one
    // English label on the page carries its own lang="en".
    expect(html).toContain('lang="es"');
    expect(html).toContain('lang="en"');
    // Content actually rendered, not just a shell.
    expect(html).toContain("Kingston en espa");
    expect(html).toContain("Hidden page");
    // The cross-link back to the English page.
    expect(html).toContain('href="/simple"');
    // The one dialable number the page promises.
    expect(telTargets(html).length).toBeGreaterThanOrEqual(1);
  });

  it("renders every Spanish safety section from the dictionary", async () => {
    const { html } = await get("/es", cookie);
    for (const key of SAFETY_SECTION_ORDER) {
      const title = SAFETY_CONTENT.es[key].title;
      expect(html, `missing Spanish safety section "${title}"`).toContain(title);
      // …and its instructions, not just its heading.
      for (const step of SAFETY_CONTENT.es[key].steps) {
        expect(html, `missing Spanish step under "${title}": ${step}`).toContain(escapeHtml(step));
      }
    }
  });

  it(
    "goes public on an explicit hidden:false record, and /simple then links to it",
    async () => {
      await setEsHidden(cookie, false);

      // /es is server-rendered on demand, so this flips immediately.
      await poll("/es to answer 200 anonymously", async () => (await get("/es")).status === 200);

      // /simple is static+ISR, so it catches up within its revalidation window.
      await poll("/simple to link to /es", async () => {
        const { html } = await get("/simple");
        return html.includes('href="/es"');
      });
    },
    150_000,
  );
});

describe("the safety slice ships in English too", () => {
  it("/simple renders every English safety section from the same dictionary", async () => {
    const { status, html } = await get("/simple");
    expect(status).toBe(200);
    for (const key of SAFETY_SECTION_ORDER) {
      const title = SAFETY_CONTENT.en[key].title;
      expect(html, `missing English safety section "${title}"`).toContain(title);
      for (const step of SAFETY_CONTENT.en[key].steps) {
        expect(html, `missing English step under "${title}": ${step}`).toContain(escapeHtml(step));
      }
    }
  });

  it("never promises a last boat — the one thing the return-trip guidance must not do", async () => {
    const { html } = await get("/simple");
    // The section exists…
    expect(html).toContain(SAFETY_CONTENT.en.returnTrip.title);
    // …and tells the reader to confirm with WSF rather than naming a final departure.
    expect(html.toLowerCase()).toContain("confirm the last trip of the day");
    expect(html.toLowerCase()).not.toContain("the last boat is");
    expect(html.toLowerCase()).not.toContain("last boat leaves");
  });
});

describe("/accessibility — the accessibility statement", () => {
  it("states the standard, names both contact channels, and asserts no unverified date", async () => {
    const { status, html } = await get("/accessibility");
    expect(status).toBe(200);

    expect(html).toContain("WCAG 2.1");
    expect(html).toContain("Title II");

    // Feedback channel: an address AND a number, per M-14-01 / FR-47.
    expect(html).toMatch(/href="mailto:[^"]+"/);
    expect(telTargets(html).length).toBeGreaterThanOrEqual(1);

    // …and it says when it was last looked at.
    expect(html).toContain("Last reviewed");

    // The human gate (docs/OPERATIONS.md §9 item 15) was CLOSED on 2026-07-21:
    // the date was verified against ada.gov's compliance table, so this guard is
    // now the inverse — the page must SERVE the verified date end to end, not
    // merely contain it in source.
    expect(
      html.includes("April 26, 2028"),
      "the accessibility page must serve the verified ADA compliance date (OPERATIONS §9 item 15, closed)",
    ).toBe(true);
  });

  it("is linked from the footer on the home page", async () => {
    const { status, html } = await get("/");
    expect(status).toBe(200);
    expect(html).toContain('href="/accessibility"');
  });
});
