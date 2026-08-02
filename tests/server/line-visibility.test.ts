// E33 slice 1 — the ship-dark guarantee for /line, cloned from
// tests/server/es-accessibility.test.ts (the DEFAULT_HIDDEN_PAGES proof) and
// adapted for the one deliberate difference: /line's gate is
// assertPageVisibleStatic, the cookie-free variant, so its ISR stays real
// (src/lib/page-visibility.tsx has the full why). Consequences under test:
//
//   - hidden ⇒ 404 for ANONYMOUS **and for ADMINS** — there is no in-place
//     admin pass-through on /line, by design;
//   - the admin preview lives at /line/preview (admin-only, banner, same body);
//   - an explicit `hidden: false` record written through the real admin API
//     flips the PUBLIC page live with NO deploy, within the ISR window;
//   - while hidden, no public surface links to /line.
//
// Run against the standalone production build the harness boots
// (tests/server/global-setup.ts) — the same bytes that deploy.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BOARDING_PASS } from "../../src/lib/data/ferry-info";
import { copyFallback } from "../../src/lib/site-copy-registry";
import { BASE_URL } from "./config";
import { ADMIN_COOKIE_HEADER } from "./admin-session";

/** Seeded by tests/server/global-setup.ts. */

/** React-escaped form of a prose string, for asserting on rendered text nodes
 *  (same helper as es-accessibility.test.ts). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** The document minus <script> blocks — what a visitor can actually read.
 *  (The RSC flight payload echoes raw strings; see the es test's rationale.) */
function visibleHtml(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
}

async function get(path: string, cookie?: string): Promise<{ status: number; html: string }> {
  const res = await fetch(BASE_URL + path, {
    headers: cookie ? { cookie } : undefined,
    redirect: "manual",
  });
  return { status: res.status, html: await res.text() };
}

async function adminCookie(): Promise<string> {
  // Minted, not logged in — see tests/server/admin-session.ts (shared
  // login rate-limit budget). Still async so callers are unchanged.
  return ADMIN_COOKIE_HEADER;
}

/** Flip /line visibility through the real admin API — the same call the
 *  Admin → Site content toggle makes. */
async function setLineHidden(cookie: string, hidden: boolean): Promise<void> {
  const res = await fetch(BASE_URL + "/api/admin/site", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ action: "page", path: "/line", hidden }),
  });
  expect(res.ok, `setting /line hidden=${hidden} failed with ${res.status}`).toBe(true);
}

/** Poll until `predicate` holds. /line is ISR (revalidate 60), so both its 404
 *  and its 200 are legitimately cached for up to a minute after a flip — that
 *  is production behavior, not a bug to assert away. */
async function poll(label: string, fn: () => Promise<boolean>, timeoutMs = 150_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

/** Who does not need a pass at all — the one boarding-pass fact the page still
 *  states in the record's own words. Seed wording: the admin overlay is empty
 *  in the test database, so the page must render exactly it. */
const EXEMPT = escapeHtml(BOARDING_PASS.exempt);

/** Phrases the app must NOT say anywhere any more (2026-07-31, Chamber's call).
 *  The "leave the line and your pass is void" rule is not enforced, so stating
 *  it is a threat we do not back up — see BoardingPass in lib/data/ferry-info.
 *  Asserted against the RENDERED page, not the source, because the wording can
 *  also arrive from an admin copy override. */
const RETIRED_CLAIMS = [
  "stay in the line",
  "leave the line",
  "leaves the line",
  "pass is void",
  "losing your place",
];

function assertNoRetiredClaims(visible: string): void {
  const lower = visible.toLowerCase();
  for (const claim of RETIRED_CLAIMS) {
    expect(lower, `/line rendered the retired boarding-pass claim "${claim}"`).not.toContain(claim);
  }
}

describe("/line — the Line Lander ships dark (fail-closed)", () => {
  let cookie = "";

  beforeAll(async () => {
    cookie = await adminCookie();
    // Settle to the no-record baseline WITHOUT writing anything. The database
    // is truncated by global-setup, but /line's ISR entry lives in the
    // standalone build dir and SURVIVES between local runs — a previous run's
    // flip test can leave a stale 200 there until the first revalidation
    // against the (now empty) store. In CI the build is always fresh and this
    // returns immediately; locally it may take up to the revalidate window.
    // Each poll request itself triggers the background revalidation.
    await poll("/line to settle to its no-record 404", async () => (await get("/line")).status === 404);
  }, 180_000);

  afterAll(async () => {
    // Restore the fixture: back to hidden. Effective state is what matters —
    // DEFAULT_HIDDEN_PAGES makes "no record" and "hidden: true" identical.
    if (cookie) await setLineHidden(cookie, true);
  });

  it("404s for an anonymous visitor while no site-pages record exists", async () => {
    const { status } = await get("/line");
    expect(
      status,
      "an unflipped /line must not be publicly reachable — the QR sign is not up yet",
    ).toBe(404);
  });

  it("404s for an ADMIN too — the static gate has no session pass-through", async () => {
    const { status } = await get("/line", cookie);
    expect(
      status,
      "assertPageVisibleStatic must not read the session: an admin-visible /line here " +
        "would mean cookies() is back in the page tree and ISR is broken again",
    ).toBe(404);
  });

  it("hides the preview from anonymous visitors", async () => {
    const { status } = await get("/line/preview");
    expect(status).toBe(404);
  });

  it("renders the preview for an admin: banner + the don't-leave-the-line block", async () => {
    const { status, html } = await get("/line/preview", cookie);
    expect(status).toBe(200);
    expect(html).toContain("Hidden page");
    const visible = visibleHtml(html);
    // The boarding-pass copy the page still carries, from the shared record.
    expect(visible).toContain(escapeHtml(copyFallback("line.exempt.title")));
    expect(visible).toContain(EXEMPT);
    assertNoRetiredClaims(visible);
    // The boarding-pass status hero rendered one of its two states.
    const on = escapeHtml(copyFallback("line.pass.on"));
    const off = escapeHtml(copyFallback("line.pass.off"));
    expect(visible.includes(on) || visible.includes(off)).toBe(true);
    // And the link-outs the epic requires.
    expect(html).toContain('href="/parking"');
    expect(html).toContain('href="/ferry"');
  });

  it("is linked from no public surface while hidden", async () => {
    for (const path of ["/", "/ferry"]) {
      const { html } = await get(path);
      expect(
        visibleHtml(html).includes('href="/line"'),
        `${path} links to /line while it is hidden — visitors would land on a 404`,
      ).toBe(false);
    }
  });

  it(
    "goes public on an explicit hidden:false record — no deploy, within the ISR window",
    async () => {
      await setLineHidden(cookie, false);

      // The baked 404 is ISR-cached, so the flip legitimately takes up to the
      // revalidate window (60s) plus one stale serve to reach visitors.
      await poll("/line to answer 200 anonymously", async () => (await get("/line")).status === 200);

      const { html } = await get("/line");
      const visible = visibleHtml(html);
      expect(visible).toContain(EXEMPT);
      // The retired claims must be gone from the PUBLIC page too, not just the
      // admin preview — this is the assertion a visitor's eyes correspond to.
      assertNoRetiredClaims(visible);
      // No half-rendered shell: the next-boats module and both link-outs made it.
      expect(html).toContain('href="/parking"');
      expect(html).toContain('href="/ferry"');
    },
    180_000,
  );
});
