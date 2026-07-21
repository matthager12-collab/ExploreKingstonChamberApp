// E14 slice 3 — the CSS half of simple mode and print, which no component test
// can see (jsdom does not apply the stylesheet, and the print surface never
// renders in a test browser).
//
// Lives under tests/ for the same reason as the other grep guards: it names the
// literal selectors it enforces, and every scan is scoped to src/.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string) => readFileSync(path.join(REPO_ROOT, p), "utf8");

const CSS = read("src/app/globals.css");

/** An actual `next/headers` import — not a prose mention of it. */
const IMPORTS_NEXT_HEADERS = /(?:from|require\()\s*["']next\/headers["']/;

describe("E14 simple mode CSS", () => {
  it("scales the whole app from the root font size", () => {
    // Everything is rem after the slice-1 px sweep, so ONE root rule is the
    // entire mechanism. A px size anywhere would silently opt out of it.
    expect(CSS).toMatch(/html\[data-simple="1"\]\s*\{[^}]*font-size:/);
  });

  it("drops the topographic texture in simple mode", () => {
    // The texture is the biggest contrast tax on a phone held in direct sun.
    expect(CSS).toMatch(/html\[data-simple="1"\][^{]*\{[^}]*background-image:\s*none/);
  });

  it("ships the .simple-hide utility for decorative-only elements", () => {
    expect(CSS).toContain(".simple-hide");
  });

  it("promotes muted prose to full ink — but never inside a link or a button", () => {
    // Flattening the background is what makes --color-ink-soft's 4.4993:1
    // measurable, so simple mode has to fix it in the same breath. The :not()
    // guards are load-bearing: side-switcher.tsx applies `text-ink-soft` as a
    // BASE class and its active button adds `bg-tide-deep text-white`, so an
    // unguarded unlayered override repaints that tab ink-on-cyan at 2.88:1.
    const rule = CSS.match(/html\[data-simple="1"\][^{]*text-ink-soft[^{]*\{[^}]*\}/);
    expect(rule, "simple mode must darken muted prose").not.toBeNull();
    expect(rule![0]).toContain(":not(a)");
    expect(rule![0]).toContain(":not(button)");
  });
});

describe("E14 print CSS", () => {
  it("has an @media print block that resets the page fill", () => {
    const block = CSS.match(/@media print\s*\{[\s\S]*?\n\}/);
    expect(block, "globals.css must carry an @media print block").not.toBeNull();
    expect(block![0]).toMatch(/background-image:\s*none/);
  });

  it("never hides <header> globally — PageHeader renders one", () => {
    // A blanket `header { display: none }` in the print block would blank the
    // <h1> on every printed page, because src/components/ui.tsx's PageHeader is
    // a <header>. The chrome is hidden at its usage sites instead.
    expect(CSS).not.toMatch(/@media print\s*\{[\s\S]*?\bheader\s*\{[^}]*display:\s*none/);
  });

  it("hides the site chrome with print:hidden at the usage sites", () => {
    const nav = read("src/components/site-nav.tsx");
    const footer = read("src/components/site-footer.tsx");
    // Sticky header, mobile bottom bar, and the mobile sheet.
    expect((nav.match(/print:hidden/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(footer).toContain("print:hidden");
  });
});

describe("E14 simple mode is never a cookie", () => {
  it("the toggle reads no server state and imports no next/headers", () => {
    const toggle = read("src/components/simple-mode-toggle.tsx");
    // The IMPORT, not the words — these files explain in prose why they must
    // not read cookies, and saying so must not fail the check that says so.
    expect(toggle).not.toMatch(IMPORTS_NEXT_HEADERS);
    expect(toggle).toContain("localStorage");
    expect(toggle).toContain("dataset.simple");
    // document.cookie would be the same ISR trap by another route.
    expect(toggle).not.toContain("document.cookie");
  });

  it("neither new page reads cookies of its own", () => {
    for (const p of ["src/app/simple/page.tsx", "src/app/print/page.tsx"]) {
      const src = read(p);
      expect(src, `${p} must not import next/headers`).not.toMatch(IMPORTS_NEXT_HEADERS);
      // side-server's getSide is the documented cookie read that quietly makes
      // a page dynamic; assertPageVisible is the sanctioned exception.
      expect(src, `${p} must not import side-server`).not.toMatch(
        /(?:from|require\()\s*["'][^"']*side-server["']/,
      );
      expect(src).toContain("assertPageVisible");
    }
  });
});
