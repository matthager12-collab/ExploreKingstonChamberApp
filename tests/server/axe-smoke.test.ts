// Axe accessibility smoke on the public pages (decisions §6: "E02 adds the
// smoke; E14 hardens"). This is a REGRESSION gate, not a full WCAG audit — it
// runs axe on each public page, keeps only serious/critical violations, and
// fails only on a violation rule id NOT already in the committed baseline. It
// fixes nothing (E14 owns remediation).
//
// Regenerate the baseline with AXE_UPDATE_BASELINE=1 (only downward — a NEW
// violation must be fixed, not baselined). See docs/TESTING.md.

import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { BASE_URL } from "./config";

// E14 adds the three pages this epic ships: they are the non-app fallbacks and
// the public accessibility commitment, so of everything on the site they are the
// least acceptable place for an un-caught violation. Their baseline entries are
// deliberately EMPTY — zero tolerance from the day they land, before anything
// has a chance to accrete. /es is left out while it ships dark (it 404s to an
// anonymous scanner); tests/server/es-accessibility.test.ts covers it instead.
const PAGES = [
  "/",
  "/ferry",
  "/eat",
  "/events",
  "/stay",
  "/about",
  "/simple",
  "/print",
  "/accessibility",
];
// Admin surfaces need a session; the global-setup seeds ci@example.test.
// E08 adds the worklist queue. Its baseline entry carries only
// `color-contrast`, which comes from the SHARED site-chrome link
// (text-tide-deep — the same rule already baselined on every public page;
// E14 owns that remediation). The worklist UI itself audits clean — any new
// rule id on this page fails the suite.
//
// E22 adds "/kiosk" here rather than to PAGES, and it is NOT an admin surface —
// this list is really "pages that need a session". The kiosk ships dark, so it
// 404s to an anonymous scanner exactly as /es does; a signed-in admin gets the
// preview render, which is the same markup the panel will serve once the
// Chamber flips it on. Scanning it is a launch gate, not a nicety: the business
// coalition made kiosk accessibility a condition of go-live, and a wall-mounted
// display in a public place is the one screen a visitor cannot work around.
const ADMIN_PAGES = ["/admin/worklist", "/kiosk"];
const ALL_PAGES = [...PAGES, ...ADMIN_PAGES];
const BASELINE_FILE = path.join(process.cwd(), "tests", "server", "axe-baseline.json");
const UPDATE = process.env.AXE_UPDATE_BASELINE === "1";

function readBaseline(): Record<string, string[]> {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")) as Record<string, string[]>;
  } catch {
    return {};
  }
}

let browser: Browser;
const results: Record<string, string[]> = {};

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  if (UPDATE) {
    const ordered: Record<string, string[]> = {};
    for (const p of ALL_PAGES) ordered[p] = results[p] ?? [];
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(ordered, null, 2) + "\n", "utf8");
    console.warn(`[axe] wrote baseline (${Object.keys(ordered).length} pages) to ${BASELINE_FILE}`);
  }
});

describe("axe accessibility smoke (serious/critical)", () => {
  it.each(ALL_PAGES)("%s has no un-baselined serious/critical violations", async (p) => {
    // @axe-core/playwright requires a page from an explicit context (not
    // browser.newPage()) so it can iterate frames — hence newContext() here.
    const context = await browser.newContext();
    const page = await context.newPage();
    let ids: string[];
    try {
      if (ADMIN_PAGES.includes(p)) {
        // context.request shares the cookie jar with the page.
        const login = await context.request.post(BASE_URL + "/api/auth/login", {
          data: { email: "ci@example.test", password: "ci-admin-password" },
        });
        expect(login.ok(), "admin login for the axe run must succeed").toBe(true);
      }
      await page.goto(BASE_URL + p, { waitUntil: "load" });
      const { violations } = await new AxeBuilder({ page }).analyze();
      ids = [
        ...new Set(
          violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id),
        ),
      ].sort();
    } finally {
      await context.close();
    }
    results[p] = ids;

    if (UPDATE) return; // generating the baseline — assert nothing this run

    const baseline = readBaseline();
    const allowed = new Set(baseline[p] ?? []);
    const novel = ids.filter((id) => !allowed.has(id));
    expect(novel, `New axe serious/critical violation ids on ${p} (fix them — E14 — do not baseline): ${novel.join(", ")}`).toEqual(
      [],
    );
    const gone = (baseline[p] ?? []).filter((id) => !ids.includes(id));
    if (gone.length) {
      console.warn(`[axe] ${p}: baselined rules no longer firing (safe to prune): ${gone.join(", ")}`);
    }
  });
});
