// E14 slice 1 — static a11y invariants (grep guards, CI-blocking via `npm test`).
//
// WHY THIS FILE LIVES UNDER tests/ AND NOT src/: it necessarily contains the
// literal patterns it forbids (`user-scalable`, an arbitrary px font size). Every
// scan below is scoped to `src/`, so keeping the guard outside `src/` is what
// stops it tripping itself. That is the mechanism chosen here — deliberately in
// preference to obfuscating the patterns with string concatenation, which would
// make the rules unreadable to the next reviewer for no extra safety.
//
// What it locks down:
//   1. No arbitrary px font sizes in src/ — type must scale with the reader's
//      browser font-size setting (M-14-02 / NFR-02). Tailwind's own scale is rem.
//   2. No user-scalable / maximumScale — pinch-zoom must never be blocked.
//   3. No next/headers import in the root layout — a cookies() read there makes
//      EVERY page dynamic (the audited v1 ISR trap) and is why simple mode is
//      localStorage + data-simple rather than a cookie.
//   4. The skip link and its target survive in the root layout.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC_ROOT = path.join(REPO_ROOT, "src");
const LAYOUT = path.join(SRC_ROOT, "app", "layout.tsx");

/**
 * The three grandfathered px holdouts. These are the SAME paths the AC-10
 * command pathspec-excludes:
 *
 *   git grep -nE 'text-\[[0-9]+px\]' -- 'src/' \
 *     ':!src/components/feature-map.tsx' \
 *     ':!src/app/admin/maps/editor.tsx' \
 *     ':!src/app/admin/map/editor.tsx'
 *
 * The reason is `.agent-frozen`: all three are frozen-zone files that no agent
 * may edit, so "fix the px size" is not an available move for them. The test
 * below re-reads the manifest and fails if any of them is ever unfrozen without
 * this exclusion list being revisited.
 */
const FROZEN_PX_HOLDOUTS = [
  "src/components/feature-map.tsx",
  "src/app/admin/maps/editor.tsx",
  "src/app/admin/map/editor.tsx",
];

/**
 * Frozen files that still pair `text-fern` with a fern tint. Both are in
 * `.agent-frozen`, so repairing them in place is not an available move:
 *   - src/app/admin/map/editor.tsx — an admin-only toggle button.
 *   - src/lib/ferry-forecast.ts — LEVELS.light.chip, which IS repaired, at the
 *     two non-frozen components that render it (see src/lib/ferry-chip.ts).
 * The test below re-reads the manifest and fails if either is ever unfrozen
 * without this list being revisited.
 */
const FERN_TINT_HOLDOUTS = ["src/app/admin/map/editor.tsx", "src/lib/ferry-forecast.ts"];

/** Arbitrary Tailwind px font size, e.g. the ones swept to rem in E14 slice 1. */
const ARBITRARY_PX_FONT_RE = /text-\[\d+px\]/;
const ZOOM_BLOCK_RE = /user-scalable|maximumScale|maximum-scale/i;

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFilesUnder(p));
    else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(p);
  }
  return out;
}

function rel(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

const SRC_FILES = sourceFilesUnder(SRC_ROOT);

describe("E14 static a11y invariants", () => {
  it("no arbitrary px font sizes in src/ (frozen zones excluded)", () => {
    const violations: string[] = [];
    for (const file of SRC_FILES) {
      const relPath = rel(file);
      if (FROZEN_PX_HOLDOUTS.includes(relPath)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (ARBITRARY_PX_FONT_RE.test(line)) {
            violations.push(`${relPath}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(
      violations,
      `arbitrary px font size(s) — use the rem equivalent so browser text scaling works:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("the px exclusions are exactly the frozen-manifest files (no silent widening)", () => {
    const manifest = readFileSync(path.join(REPO_ROOT, ".agent-frozen"), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    for (const holdout of FROZEN_PX_HOLDOUTS) {
      expect(manifest, `${holdout} is excluded from the px sweep but is no longer frozen`).toContain(
        holdout,
      );
    }
  });

  it("never blocks pinch-zoom anywhere in src/", () => {
    const violations: string[] = [];
    for (const file of SRC_FILES) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (ZOOM_BLOCK_RE.test(line)) violations.push(`${rel(file)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(
      violations,
      `zoom-blocking viewport setting(s) found — low-vision users must be able to pinch-zoom:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("the root layout never imports next/headers", () => {
    // A cookies()/headers() read in the root layout opts every page out of static
    // rendering. Simple mode is therefore localStorage + data-simple, never a cookie.
    expect(readFileSync(LAYOUT, "utf8")).not.toMatch(/next\/headers/);
  });

  it("the root layout carries the skip link and its target", () => {
    const layout = readFileSync(LAYOUT, "utf8");
    expect(layout).toContain('href="#main"');
    expect(layout).toContain('id="main"');
    // The skip link must precede the nav so it is the first thing Tab reaches.
    expect(layout.indexOf('href="#main"')).toBeLessThan(layout.indexOf("<SiteNav"));
    // …and the target must be focusable, or Safari/iOS VoiceOver scroll to it
    // without MOVING focus and the next Tab returns to the top of the header.
    expect(layout).toMatch(/id="main"\s+tabIndex=\{-1\}/);
  });

  it("keeps the frozen map component's contrast override wired to its markup", () => {
    // globals.css repairs --color-ink-soft contrast for three nodes inside
    // src/components/feature-map.tsx (frozen — see .agent-frozen), keyed on that
    // file's exact utility classes. If the markup and the selector ever drift,
    // the rule silently stops applying and the legend goes back to 4.49:1 with
    // nothing failing. Assert BOTH halves of the coupling.
    const css = readFileSync(path.join(SRC_ROOT, "app", "globals.css"), "utf8");
    const map = readFileSync(path.join(SRC_ROOT, "components", "feature-map.tsx"), "utf8");
    expect(css).toContain("ul.max-h-28.overflow-y-auto.text-ink-soft");
    expect(map).toContain("max-h-28 flex-wrap gap-x-4 gap-y-2 overflow-y-auto text-sm text-ink-soft");
    expect(css).toContain(".bg-shell\\/60.text-ink-soft");
    expect(map).toContain("bg-shell/60 text-sm text-ink-soft");
  });

  it("never pairs text-fern with a fern tint (the E14 4.29:1 bug class)", () => {
    // --color-fern (#4a7c59) is 4.86:1 on white — a pass, but only by 0.36. Put
    // it on a tint of its OWN hue and the background moves toward the text while
    // the text stays put: bg-fern/10 composites to #edf2ee and the pair lands at
    // 4.29:1, /20 at 3.76:1. E14 repaired this in ui.tsx and open-badge.tsx; the
    // authed portal/admin copies survived because axe-smoke scans 10 routes and
    // only one of them requires a login.
    //
    // Comments are stripped before scanning: the repairs in src/ necessarily
    // quote the pattern they removed, and a raw grep would flag those notes.
    // Same self-trip hazard this file's header describes, handled inline.
    // Both comment shapes have to go — `//` lines AND `/** */` blocks, whose
    // continuation lines start with `*`. Missing the second is how the first
    // draft of this guard flagged ferry-chip.ts's own docstring.
    const violations: string[] = [];
    for (const file of SRC_FILES) {
      const relPath = rel(file);
      if (FERN_TINT_HOLDOUTS.includes(relPath)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
          const code = line.replace(/(^|\s)\/\/.*$/, "$1");
          if (/bg-fern\/\d/.test(code) && /text-fern\b/.test(code)) {
            violations.push(`${relPath}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(
      violations,
      `text-fern on a fern tint is under AA (bg-fern/10 = 4.29:1). Use ` +
        `\`bg-fern text-white\` (4.86:1) for chips or \`text-ink\` for prose:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("the fern-tint exclusions are exactly the frozen-manifest files", () => {
    // Same no-silent-widening rule as the px sweep above: these two are skipped
    // ONLY because no agent may edit them. If either is unfrozen, fix the
    // classes there and drop it from the list.
    const manifest = readFileSync(path.join(REPO_ROOT, ".agent-frozen"), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    for (const holdout of FERN_TINT_HOLDOUTS) {
      expect(manifest, `${holdout} is excluded from the fern-tint sweep but is no longer frozen`)
        .toContain(holdout);
    }
  });

  it("keeps the frozen forecast module's chip override wired to its consumers", () => {
    // LEVELS.light.chip in the frozen src/lib/ferry-forecast.ts is the failing
    // `bg-fern/10 text-fern`. src/lib/ferry-chip.ts replaces it at the two
    // non-frozen components that render it. Assert BOTH halves, like the
    // feature-map coupling above: if the frozen file is ever repaired upstream
    // the override becomes dead code, and if a consumer goes back to
    // interpolating meta.chip directly the failure returns silently.
    const forecast = readFileSync(path.join(SRC_ROOT, "lib", "ferry-forecast.ts"), "utf8");
    expect(forecast).toContain('chip: "bg-fern/10 text-fern"');

    for (const consumer of [
      path.join(SRC_ROOT, "app", "ferry", "plan", "ferry-planner.tsx"),
      path.join(SRC_ROOT, "components", "ferry-busy-today.tsx"),
    ]) {
      const src = readFileSync(consumer, "utf8");
      expect(src, `${rel(consumer)} must route the chip through chipClass()`).toMatch(
        /\$\{chipClass\(meta\)\}/,
      );
      expect(src, `${rel(consumer)} still renders meta.chip raw`).not.toMatch(/\$\{meta\.chip\}/);
    }
  });

  it("the simple-mode bootstrap is inline and localStorage-backed", () => {
    const layout = readFileSync(LAYOUT, "utf8");
    expect(layout).toContain("ek-simple");
    expect(layout).toContain("dataset.simple");
    // Raw inline <script>, not next/script — it has to run before paint.
    expect(layout).not.toMatch(/from "next\/script"/);
  });
});
