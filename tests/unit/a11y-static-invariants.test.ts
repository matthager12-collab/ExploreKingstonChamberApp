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
  });

  it("the simple-mode bootstrap is inline and localStorage-backed", () => {
    const layout = readFileSync(LAYOUT, "utf8");
    expect(layout).toContain("ek-simple");
    expect(layout).toContain("dataset.simple");
    // Raw inline <script>, not next/script — it has to run before paint.
    expect(layout).not.toMatch(/from "next\/script"/);
  });
});
