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
import { mapViews } from "@/lib/data/map-views";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC_ROOT = path.join(REPO_ROOT, "src");
const LAYOUT = path.join(SRC_ROOT, "app", "layout.tsx");
// E22 split the app into route groups. The chrome — skip link, nav, <main>,
// footer — moved out of the root layout into a component shared by
// src/app/(site)/layout.tsx and the root 404, so the guards below follow it
// there. All three files are on the shared graph of every public page, so all
// three are held to the no-dynamic-API rule.
const SITE_LAYOUT = path.join(SRC_ROOT, "app", "(site)", "layout.tsx");
const CHROME = path.join(SRC_ROOT, "components", "site-chrome.tsx");

/** The seed view /parking resolves by id, and the source its text alternative needs. */
const PARKING_VIEW_ID = "parking-cash";
const PARKING_ZONES_SOURCE = "parking-zones";
/** The key on `builtins` that src/app/(site)/parking/page.tsx gates the list on. */
const PARKING_ZONES_BUILTIN = "parkingZones";

/**
 * The three grandfathered px holdouts. These are the SAME paths the AC-10
 * command pathspec-excludes:
 *
 *   git grep -nE 'text-\[[0-9]+px\]' -- 'src/' \
 *     ':!src/components/feature-map.tsx' \
 *     ':!src/app/(site)/admin/maps/editor.tsx' \
 *     ':!src/app/(site)/admin/map/editor.tsx'
 *
 * The reason is `.agent-frozen`: all three are frozen-zone files that no agent
 * may edit, so "fix the px size" is not an available move for them. The test
 * below re-reads the manifest and fails if any of them is ever unfrozen without
 * this exclusion list being revisited.
 */
const FROZEN_PX_HOLDOUTS = [
  "src/components/feature-map.tsx",
  "src/app/(site)/admin/maps/editor.tsx",
  "src/app/(site)/admin/map/editor.tsx",
];

/**
 * Frozen files that still pair `text-fern` with a fern tint. Both are in
 * `.agent-frozen`, so repairing them in place is not an available move:
 *   - src/app/(site)/admin/map/editor.tsx — an admin-only toggle button.
 *   - src/lib/ferry-forecast.ts — LEVELS.light.chip, which IS repaired, at the
 *     two non-frozen components that render it (see src/lib/ferry-chip.ts).
 * The test below re-reads the manifest and fails if either is ever unfrozen
 * without this list being revisited.
 */
const FERN_TINT_HOLDOUTS = ["src/app/(site)/admin/map/editor.tsx", "src/lib/ferry-forecast.ts"];

/** Arbitrary Tailwind px font size, e.g. the ones swept to rem in E14 slice 1. */
const ARBITRARY_PX_FONT_RE = /text-\[\d+px\]/;

/* --------------------------------------------------------------------------
 * Palette-wide tint contrast (E15 follow-up).
 *
 * The fern guard below this catches ONE colour. The arithmetic that makes fern
 * dangerous is not special to fern — a tint lifts the background toward the
 * text while the text stays put, so any brand colour whose solid-on-white
 * ratio is close to 4.5:1 fails on a tint. Measured over white:
 *
 *   fern      4.86 solid -> 4.29 on its own /10
 *   coral     4.97 solid -> 4.37 on its own /10
 *   ink-soft  4.62 solid -> 4.09 on its own /10
 *   tide-deep 5.28 solid -> 4.29 on its own /15
 *
 * and the failures are not even confined to same-hue pairs: `text-ink-soft` on
 * `bg-sand/40` was 4.20:1 on the public event-suggestion page, invisible to a
 * fern-shaped rule. So this computes the real ratio for every text/tint pair
 * that lands on the SAME element instead of hard-coding a colour.
 *
 * Same-element is what makes it sound: one className string is one element, so
 * the text genuinely sits on that background. The composite assumes the element
 * is over the white/shell page — true for every card and callout in this app,
 * and the same assumption the fern rule already made.
 * ----------------------------------------------------------------------- */

/** Brand palette, read from the single source of truth rather than restated. */
function readPalette(): Record<string, string> {
  const css = readFileSync(path.join(SRC_ROOT, "app", "globals.css"), "utf8");
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}

function toRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** WCAG relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite a colour at `alpha` over an opaque backdrop. */
function composite(
  fg: [number, number, number],
  alpha: number,
  bg: [number, number, number],
): [number, number, number] {
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha))) as [number, number, number];
}

const PAGE_BACKDROP: [number, number, number] = [255, 255, 255];
const AA_NORMAL = 4.5;
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

  it("nothing on the shared layout graph imports next/headers", () => {
    // A cookies()/headers() read anywhere on the graph EVERY page renders opts
    // the whole site out of static rendering. Simple mode is therefore
    // localStorage + data-simple, never a cookie.
    //
    // E22: checking the root layout alone stopped being sufficient the moment
    // the chrome moved down — a headers() read in (site)/layout.tsx or in
    // site-chrome.tsx would take out every public page while this guard stayed
    // green. tests/server/static-rendering.test.ts is the property-level
    // backstop; these three greps are the fast, specific version.
    for (const file of [LAYOUT, SITE_LAYOUT, CHROME]) {
      expect(readFileSync(file, "utf8"), `${rel(file)} imports next/headers`).not.toMatch(
        /next\/headers/,
      );
    }
  });

  it("the site chrome carries the skip link and its target", () => {
    // Lives in site-chrome.tsx since E22 rather than the root layout, because
    // the (kiosk) group must NOT get a skip link — it has no nav to skip and no
    // #main to land on. The chrome is still the first child of <body>, so the
    // link is still the first thing Tab reaches.
    const chrome = readFileSync(CHROME, "utf8");
    expect(chrome).toContain('href="#main"');
    expect(chrome).toContain('id="main"');
    // The skip link must precede the nav so it is the first thing Tab reaches.
    expect(chrome.indexOf('href="#main"')).toBeLessThan(chrome.indexOf("<SiteNav"));
    // …and the target must be focusable, or Safari/iOS VoiceOver scroll to it
    // without MOVING focus and the next Tab returns to the top of the header.
    expect(chrome).toMatch(/id="main"\s+tabIndex=\{-1\}/);
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

  it("no text colour lands under AA on a same-element brand tint (any colour)", () => {
    // Generalises the fern rule below to the whole palette by MEASURING rather
    // than naming a colour, so the next near-4.5:1 token added to globals.css
    // is covered the day it lands instead of after someone ships a grey chip.
    const palette = readPalette();
    const names = Object.keys(palette);
    const violations: string[] = [];

    for (const file of SRC_FILES) {
      const relPath = rel(file);
      if (FERN_TINT_HOLDOUTS.includes(relPath)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const trimmed = line.trim();
          // Same self-trip hazard the fern rule documents: this file and the
          // repairs in src/ both quote the patterns they forbid.
          if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
            return;
          }
          for (const bgName of names) {
            const tint = line.match(new RegExp(`bg-${bgName}\\/(\\d{1,3})(?![\\w-])`));
            if (!tint) continue;
            const bg = composite(toRgb(palette[bgName]), Number(tint[1]) / 100, PAGE_BACKDROP);
            for (const textName of names) {
              if (!new RegExp(`text-${textName}(?![\\w-])`).test(line)) continue;
              const ratio = contrast(toRgb(palette[textName]), bg);
              if (ratio < AA_NORMAL) {
                violations.push(
                  `${relPath}:${i + 1}: text-${textName} on bg-${bgName}/${tint[1]} = ${ratio.toFixed(2)}:1\n    ${trimmed.slice(0, 100)}`,
                );
              }
            }
          }
        });
    }

    expect(
      violations,
      `text/tint pair(s) under AA (4.5:1). A tint moves the background toward the text, so a colour that passes on white can fail on its own wash — darken the TEXT (text-ink for prose) or use a solid fill with white text:\n${violations.join("\n")}`,
    ).toEqual([]);
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
      path.join(SRC_ROOT, "app", "(site)", "ferry", "plan", "ferry-planner.tsx"),
      path.join(SRC_ROOT, "components", "ferry-busy-today.tsx"),
    ]) {
      const src = readFileSync(consumer, "utf8");
      expect(src, `${rel(consumer)} must route the chip through chipClass()`).toMatch(
        /\$\{chipClass\(meta\)\}/,
      );
      expect(src, `${rel(consumer)} still renders meta.chip raw`).not.toMatch(/\$\{meta\.chip\}/);
    }
  });

  it("keeps the SVG trendline chip routed through the AA-safe fill", () => {
    // Companion to tests/unit/ferry-trendline-contrast.test.ts, which proves the
    // FILLS clear 4.5:1. This proves the component still USES them: the ratios
    // are worthless if the chip goes back to `fill={meta.hex}`, and because the
    // chip renders white text on all five levels, that regression is invisible
    // to axe (it scans DOM/CSS colors, not SVG presentation attributes) and to
    // the fern-tint grep above, which only knows about Tailwind classes.
    //
    // meta.hex is still CORRECT for the dashed rule and the marker dot — they
    // carry no text, so no 1.4.3 obligation. Only the <rect> behind the label
    // is constrained, so the assertion is scoped to <rect> lines specifically.
    const trendline = readFileSync(path.join(SRC_ROOT, "components", "ferry-trendline.tsx"), "utf8");
    expect(trendline, "the chip rect must take its fill from chipFillHex()").toContain(
      "fill={chipFillHex(meta)}",
    );
    const rectWithRawHex = trendline
      .split("\n")
      .map((line, i) => [line, i + 1] as const)
      .filter(([line]) => line.includes("<rect") && line.includes("meta.hex"))
      .map(([line, n]) => `ferry-trendline.tsx:${n}: ${line.trim()}`);
    expect(
      rectWithRawHex,
      `white label text on a raw LEVELS[].hex fill is under AA (busy = 2.27:1). ` +
        `Use chipFillHex(meta):\n${rectWithRawHex.join("\n")}`,
    ).toEqual([]);
  });

  it("the parking view seeds the source its text alternative depends on", () => {
    // /parking's "Every lot, in words" list is M-14-04's text alternative to
    // the frozen map: src/components/feature-map.tsx encodes a lot's parking
    // type in MARKER COLOUR alone, and the type name only appears inside a
    // popup you have to tap. That list is the only non-colour way to get it.
    //
    // The list renders only when `builtins.parkingZones` is non-empty, and
    // resolveMapView() fills that ONLY when the view lists this source. The
    // seed shipped `sources: []`, so the alternative existed only where a
    // human had ticked the box in /admin/maps. On production nobody ever had —
    // the live payload read `"sources":[],"features":[],"builtins":{}`, so the
    // list had never once rendered to a visitor, and the map itself was blank
    // under copy promising colour-coded lots.
    //
    // Seeding it makes the guarantee structural: a restored backup, a wiped
    // store, or a fresh environment now carries the alternative by default.
    const parking = mapViews.find((v) => v.id === PARKING_VIEW_ID);
    expect(parking, `no "${PARKING_VIEW_ID}" seed view — /parking resolves it by id`).toBeDefined();
    expect(
      parking!.sources,
      `/parking's "Every lot, in words" text alternative (M-14-04) renders only when ` +
        `the "${PARKING_VIEW_ID}" view carries the "${PARKING_ZONES_SOURCE}" source. Without ` +
        `it the page drops the list with nothing failing, and the frozen map's ` +
        `colour-coded lot types are left with no non-colour equivalent.`,
    ).toContain(PARKING_ZONES_SOURCE);
  });

  it("keeps the parking seed's source wired to the resolver that reads it", () => {
    // Assert BOTH halves of the coupling, like the feature-map and forecast
    // pairings above. The test directly above proves the SEED says
    // "parking-zones"; it cannot prove the RESOLVER still listens for that
    // exact string, or still parks the result on `builtins.parkingZones`
    // where src/app/(site)/parking/page.tsx looks for it. Rename either end and the
    // seed keeps its source, every existing test stays green, and the text
    // alternative silently disappears again — the precise failure this whole
    // pair exists to prevent.
    //
    // Read, do not import: src/lib/map/resolve.ts is server-only and pulls in
    // the stores (and therefore a database) at import time. Comparing the
    // source text is the same move parking-labels.test.ts makes against the
    // frozen map component, for the same reason.
    const resolver = readFileSync(path.join(SRC_ROOT, "lib", "map", "resolve.ts"), "utf8");
    const page = readFileSync(path.join(SRC_ROOT, "app", "(site)", "parking", "page.tsx"), "utf8");

    // Parse the literals out rather than string-matching a whole expression.
    // The two existing coupling tests in this file match exact class strings,
    // which is fine against frozen files that barely change — but resolve.ts is
    // NOT frozen, so it will get reformatted and refactored. Matching the parsed
    // literal survives a Prettier re-wrap or a switch to a Set, and still fails
    // on the one thing that actually breaks the page: the string changing.
    const gatedSources = [...resolver.matchAll(/sources\.includes\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(
      gatedSources,
      `resolve.ts no longer gates any branch on "${PARKING_ZONES_SOURCE}" (it gates on: ` +
        `${gatedSources.join(", ") || "nothing"}). The seed still lists that source, so the ` +
        `test above keeps passing — but builtins.parkingZones is never filled and /parking ` +
        `drops its text alternative with nothing else failing.`,
    ).toContain(PARKING_ZONES_SOURCE);

    // The other half of the chain: the key the resolver writes has to be the key
    // the page reads. Rename it at either end and the list empties in silence.
    const assignedBuiltins = [...resolver.matchAll(/builtins\.(\w+)\s*=/g)].map((m) => m[1]);
    expect(
      assignedBuiltins,
      `resolve.ts no longer assigns builtins.${PARKING_ZONES_BUILTIN} (it assigns: ` +
        `${assignedBuiltins.join(", ") || "nothing"}).`,
    ).toContain(PARKING_ZONES_BUILTIN);
    expect(
      page,
      `src/app/(site)/parking/page.tsx no longer reads builtins.${PARKING_ZONES_BUILTIN} — if the ` +
        `list moved to another key, this guard is now protecting the wrong one.`,
    ).toContain(`builtins.${PARKING_ZONES_BUILTIN}`);
  });

  it("the simple-mode bootstrap is inline and localStorage-backed", () => {
    const layout = readFileSync(LAYOUT, "utf8");
    expect(layout).toContain("ek-simple");
    expect(layout).toContain("dataset.simple");
    // Raw inline <script>, not next/script — it has to run before paint.
    expect(layout).not.toMatch(/from "next\/script"/);
  });
});
