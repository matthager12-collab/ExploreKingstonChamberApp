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

const PAGES = ["/", "/ferry", "/eat", "/events", "/stay", "/about"];
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
    for (const p of PAGES) ordered[p] = results[p] ?? [];
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(ordered, null, 2) + "\n", "utf8");
    console.warn(`[axe] wrote baseline (${Object.keys(ordered).length} pages) to ${BASELINE_FILE}`);
  }
});

describe("axe accessibility smoke (serious/critical)", () => {
  it.each(PAGES)("%s has no un-baselined serious/critical violations", async (p) => {
    // @axe-core/playwright requires a page from an explicit context (not
    // browser.newPage()) so it can iterate frames — hence newContext() here.
    const context = await browser.newContext();
    const page = await context.newPage();
    let ids: string[];
    try {
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
