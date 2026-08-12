// E17 step 8 (AC15): authenticated axe scan of the two admin surfaces the
// claim flow ships — the claims console and the Qwick import page. Unlike
// tests/server/axe-smoke.test.ts (a serious/critical REGRESSION gate with a
// committed baseline), this suite is zero-tolerance from day one: ANY axe
// violation on these pages fails, and the fix belongs in the page, never in a
// baseline. The smoke suite and its baseline are deliberately untouched.
//
// Auth mints the harness admin's session cookie (./admin-session) instead of
// posting to the rate-limited login route — see that module for the budget
// arithmetic this suite would otherwise have broken.
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
import { BASE_URL } from "./config";
import { signInAdmin } from "./admin-session";

/* All 19 admin surfaces, not the two this file shipped with.
 *
 * The rail rebuild touches the chrome of every one of them at once, so a walk
 * that covered claims and qwick only would have proved almost nothing. Headings
 * are the EXACT rendered text — note the three that are written `&amp;` in
 * source: Playwright matches what the browser paints, so the entity must be
 * decoded here or the wait hangs until it times out.
 *
 * The three canvas editors (map, maps, hunts) are included deliberately. They
 * are the surfaces nobody will restyle, which makes them exactly the ones most
 * likely to rot unnoticed.
 */
const PAGES: { path: string; heading: string }[] = [
  { path: "/admin", heading: "Visitor Insights" },
  { path: "/admin/feedback", heading: "Page feedback" },
  { path: "/admin/content", heading: "Site content" },
  { path: "/admin/media", heading: "Photos" },
  { path: "/admin/listings", heading: "Listings Workbench" },
  { path: "/admin/itineraries", heading: "Itinerary Builder" },
  { path: "/admin/hunts", heading: "Scavenger Hunt Builder" },
  { path: "/admin/ferry-info", heading: "Ferry settings" },
  { path: "/admin/map", heading: "Parking map editor" },
  { path: "/admin/maps", heading: "Map builder" },
  { path: "/admin/accounts", heading: "Accounts & invites" },
  { path: "/admin/claims", heading: "Claims console" },
  { path: "/admin/worklist", heading: "Worklist" },
  { path: "/admin/events", heading: "Events Workbench" },
  { path: "/admin/events-sources", heading: "Events sources & unified calendar" },
  { path: "/admin/kiosk", heading: "Ferry-dock kiosk" },
  { path: "/admin/import/qwick", heading: "Qwick listings import" },
  { path: "/admin/audit", heading: "Change history" },
  { path: "/admin/ops", heading: "Ops & status" },
];

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

describe("axe on every authenticated admin surface (zero violations)", () => {
  it.each(PAGES)("$path scans clean", async ({ path, heading }) => {
    // @axe-core/playwright needs a page from an explicit context (frame
    // iteration) — same constraint as the smoke suite.
    const context = await browser.newContext();
    try {
      await signInAdmin(context);

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
