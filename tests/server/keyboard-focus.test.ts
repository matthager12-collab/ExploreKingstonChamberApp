// E14 — the skip link, asserted as RENDERED BEHAVIOUR rather than as source text.
//
// tests/unit/a11y-static-invariants.test.ts already proves the layout contains
// the anchor, its target, and the right DOM order. What it cannot see is CSS: a
// stray `overflow`, a focus style that never un-hides the sr-only chip, or a
// stacking context that leaves the link off-screen would all keep the source
// assertions green while the mechanism is broken for the only people who use
// it. So this file drives a real browser: one Tab from a cold load, on the
// standalone production build the harness boots.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { BASE_URL } from "./config";

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

describe("skip link — rendered keyboard behaviour", () => {
  it.each(["/", "/simple"])("is the first thing Tab reaches on %s, and it is visible", async (path) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(BASE_URL + path, { waitUntil: "load" });
      await page.keyboard.press("Tab");

      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        const style = getComputedStyle(el);
        return {
          tag: el.tagName,
          href: el.getAttribute("href"),
          text: (el.textContent ?? "").trim(),
          position: style.position,
          // sr-only clips the element to a 1px box; a real chip does not.
          width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height,
        };
      });

      expect(focused, "one Tab from a cold load must land on something").not.toBeNull();
      expect(focused!.tag).toBe("A");
      expect(focused!.href, "the first tab stop must be the skip link").toBe("#main");
      expect(focused!.text).toBe("Skip to content");
      // Focused, it un-hides: pinned and big enough for a sighted keyboard user.
      expect(focused!.position).toBe("fixed");
      expect(focused!.height).toBeGreaterThanOrEqual(44);

      // Activating it moves FOCUS, not just the scroll position — this is what
      // <main tabIndex={-1}> buys, and what Safari gets wrong without it.
      await page.keyboard.press("Enter");
      const landed = await page.evaluate(() => document.activeElement?.id ?? "");
      expect(landed, "activating the skip link must move focus into <main>").toBe("main");
    } finally {
      await context.close();
    }
  });
});
