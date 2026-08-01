// E17 step 8 (AC15): authenticated axe scan of the two admin surfaces the
// claim flow ships — the claims console and the Qwick import page. Unlike
// tests/server/axe-smoke.test.ts (a serious/critical REGRESSION gate with a
// committed baseline), this suite is zero-tolerance from day one: ANY axe
// violation on these pages fails, and the fix belongs in the page, never in a
// baseline. The smoke suite and its baseline are deliberately untouched.
//
// Auth reuses the harness admin the global-setup seeds (ci@example.test) via
// the real login route — the same pattern the E32 editor suite uses; the
// login sets the vk-session cookie in the context's shared jar.
//
// Vacuity guard: an unauthenticated load of these pages REDIRECTS (page-level
// role re-check -> /portal, and the admin layout gates too), and a scan of the
// login/portal page would pass while proving nothing about the console. So
// each test first asserts the final URL is still the target path AND that the
// page-specific <h1> actually rendered before axe runs.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { BASE_URL } from "./config";

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
      // context.request shares the cookie jar with pages from this context.
      const login = await context.request.post(BASE_URL + "/api/auth/login", {
        data: { email: "ci@example.test", password: "ci-admin-password" },
      });
      expect(login.ok(), "admin login for the axe run must succeed").toBe(true);

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
