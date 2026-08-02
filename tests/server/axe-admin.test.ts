// E17 step 8 (AC15): authenticated axe scan of the two admin surfaces the
// claim flow ships — the claims console and the Qwick import page. Unlike
// tests/server/axe-smoke.test.ts (a serious/critical REGRESSION gate with a
// committed baseline), this suite is zero-tolerance from day one: ANY axe
// violation on these pages fails, and the fix belongs in the page, never in a
// baseline. The smoke suite and its baseline are deliberately untouched.
//
// Auth MINTS the harness admin's session cookie directly rather than posting
// to /api/auth/login. That is not a shortcut, it is a budget decision: the
// login route is rate-limited to 8 attempts per 60s per IP *and* per email
// (src/app/api/auth/login/route.ts), every server suite logs in as the same
// ci@example.test from 127.0.0.1, and there are already eight such suites —
// the cap exactly. A suite that logs in once per test case pushes the shared
// window over, and the 429 lands on whichever suite happens to be running
// (observed: admin-media-library and admin-parking-curb failing their login
// hooks). Minting costs zero login budget. The cookie is built from the same
// tokens module the server verifies with, using the seeded admin id and the
// AUTH_SECRET global-setup hands the server process.
//
// Vacuity guard: an unauthenticated load of these pages REDIRECTS (page-level
// role re-check -> /portal, and the admin layout gates too), and a scan of the
// login/portal page would pass while proving nothing about the console. So
// each test first asserts the final URL is still the target path AND that the
// page-specific <h1> actually rendered before axe runs. A stale or unsigned
// cookie therefore fails this suite loudly instead of scanning a login page.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { makeSessionToken, sessionCookie } from "@/lib/auth/tokens";
import { BASE_URL } from "./config";

// Mirrors tests/server/global-setup.ts: the seeded admin's id, and the secret
// it exports to the server. session_version starts at 0 (auth-schema default)
// and nothing in this suite bumps it.
const ADMIN_ID = "ci-admin";
const HARNESS_SECRET = "vitest-only-secret";
const ADMIN_COOKIE = {
  name: sessionCookie.name,
  value: makeSessionToken(ADMIN_ID, 0, HARNESS_SECRET),
  url: BASE_URL,
};

const PAGES: { path: string; heading: string }[] = [
  { path: "/admin/claims", heading: "Claims console" },
  { path: "/admin/import/qwick", heading: "Qwick listings import" },
];

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

describe("axe on the authenticated E17 admin surfaces (zero violations)", () => {
  it.each(PAGES)("$path scans clean", async ({ path, heading }) => {
    // @axe-core/playwright needs a page from an explicit context (frame
    // iteration) — same constraint as the smoke suite.
    const context = await browser.newContext();
    try {
      await context.addCookies([ADMIN_COOKIE]);

      const page = await context.newPage();
      await page.goto(BASE_URL + path, { waitUntil: "load" });

      // Anti-vacuity: still on the admin page (not bounced to /portal or the
      // login screen), and the page's own heading is really in the document.
      expect(new URL(page.url()).pathname, "authenticated load must not redirect").toBe(path);
      await page.waitForSelector(`h1:has-text("${heading}")`, { timeout: 15_000 });

      const { violations } = await new AxeBuilder({ page }).analyze();
      const report = violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
      }));
      expect(report, `axe violations on ${path} — fix the page, do not baseline`).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
