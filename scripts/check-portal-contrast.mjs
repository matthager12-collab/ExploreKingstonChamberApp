#!/usr/bin/env node
/**
 * Contrast gate for the console role tokens — portal AND admin.
 *
 * Both consoles render the same role tokens and share the same [data-surface]
 * override block, so one set of pairs covers both.
 *
 * Scope note: this checks the role tokens the console archetypes use, not the
 * whole app. The public site's palette is unchanged and out of scope here —
 * its conformance is covered by the existing axe and Lighthouse passes.
 *
 * It reads src/app/globals.css directly, so the tokens stay the single source
 * of truth and this file never carries a second copy of a hex value. The
 * scoped [data-surface] overrides are layered on top, exactly as the cascade
 * applies them.
 *
 * WCAG ratios are the right and only test for TEXT. They are deliberately not
 * applied to decorative fills, where hue and chroma separation carry meaning
 * that a ratio cannot rank.
 *
 * Run: npm run check:portal-contrast
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSS = join(ROOT, "src/app/globals.css");

function readTokens() {
  const css = readFileSync(CSS, "utf8");

  const theme = css.match(/@theme inline\s*\{([\s\S]*?)\n\}/);
  if (!theme) throw new Error("no @theme inline block in globals.css");

  const tokens = {};
  const collect = (body) => {
    for (const [, name, hex] of body.matchAll(
      /--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g,
    )) {
      tokens[name] = hex;
    }
  };

  collect(theme[1]);

  // Scoped overrides win, because that is what the cascade does inside a
  // console subtree. Missing this block would test the PUBLIC value of
  // ink-soft and pass on a colour neither console renders.
  //
  // Matched by "any selector list containing [data-surface=...]" rather than by
  // the exact selector text. The literal form broke the moment admin joined the
  // rule and it became a two-selector list — the parser silently stopped
  // finding the block and the gate went red on the public value. A gate that
  // depends on the exact shape of a selector is a gate that fails for the wrong
  // reason.
  const scoped = css.match(
    /(?:\[data-surface="[a-z]+"\]\s*,?\s*)+\{([\s\S]*?)\n\}/,
  );
  if (!scoped) throw new Error("no [data-surface=...] override block found in globals.css");
  collect(scoped[1]);

  // The property alone is INERT, and this gate once passed because of it.
  //
  // `@theme inline` compiles tokens to literals: the built utility is
  // `.text-ink-soft{color:#6b7683}`, never `color:var(--color-ink-soft)`. So
  // re-pointing the custom property changes nothing a browser paints, and this
  // gate read the property and reported green on a colour that was never
  // rendered. axe on /admin/worklist caught what this file missed — 4.15:1,
  // serious.
  //
  // Every token overridden in that block must therefore ALSO have a rule that
  // applies it to the compiled utility. Without this assertion the gate is
  // measuring an intention rather than an outcome.
  for (const [, name] of scoped[1].matchAll(/--color-([a-z0-9-]+):/g)) {
    // The TOKEN is --color-ink-soft; the UTILITY is .text-ink-soft. Any of the
    // colour-bearing prefixes counts as applying it.
    const applied = new RegExp(
      `\\[data-surface="[a-z]+"\\]\\s+\\[class~="(?:text|bg|border)-${name}(?:/\\d+)?"\\]`,
    ).test(css);
    if (!applied) {
      throw new Error(
        `--color-${name} is overridden for a console surface but no rule applies it ` +
          `to the compiled utility. @theme inline bakes the token into the utility ` +
          `as a literal, so the override is inert and this gate would pass on a ` +
          `colour nothing renders. Add a rule like:\n` +
          `  [data-surface="portal"] [class~="text-${name}"] { color: var(--color-${name}); }`,
      );
    }
  }

  return tokens;
}

function toRgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// min: 4.5 = AA normal text; 3.0 = AA large text and non-text contrast (1.4.11).
const SURFACES = ["surface", "surface-raised", "surface-sunken"];

const PAIRS = [
  ...SURFACES.flatMap((bg) => [
    { fg: "ink", bg, min: 4.5, note: "body + headings" },
    { fg: "ink-soft", bg, min: 4.5, note: "secondary text" },
    { fg: "primary", bg, min: 4.5, note: "brand text / links" },
    { fg: "secondary", bg, min: 4.5, note: "links" },
    { fg: "accent-deep", bg, min: 4.5, note: "CTA text on light" },
    { fg: "success-deep", bg, min: 4.5, note: "success TEXT" },
    { fg: "success", bg, min: 3.0, note: "success fills / large text only" },
    { fg: "warning", bg, min: 4.5 },
    { fg: "danger", bg, min: 4.5 },
    { fg: "focus", bg, min: 3.0, note: "focus ring, WCAG 1.4.11" },
    { fg: "border-strong", bg, min: 3.0, note: "control borders, WCAG 1.4.11" },
  ]),
  { fg: "surface-raised", bg: "primary", min: 4.5, note: "white on navy" },
  { fg: "surface-raised", bg: "primary-deep", min: 4.5 },
  { fg: "surface-raised", bg: "secondary", min: 4.5, note: "white on cyan" },
  { fg: "surface-raised", bg: "secondary-deep", min: 4.5 },
  { fg: "surface-raised", bg: "accent", min: 4.5, note: "white on coral CTA" },
  { fg: "surface-raised", bg: "success", min: 4.5 },
  { fg: "surface-raised", bg: "danger", min: 4.5 },
  { fg: "secondary-tint", bg: "primary", min: 3.0, note: "ring on navy" },
  { fg: "secondary-tint", bg: "primary-deep", min: 3.0 },
];

const tokens = readTokens();
const rows = [];
let failed = 0;

for (const { fg, bg, min, note } of PAIRS) {
  if (!tokens[fg] || !tokens[bg]) {
    console.error(`unknown token in pair: ${fg} on ${bg}`);
    failed++;
    continue;
  }
  const ratio = contrast(tokens[fg], tokens[bg]);
  const ok = ratio >= min;
  if (!ok) failed++;
  rows.push({
    pair: `${fg} on ${bg}`,
    ratio: ratio.toFixed(2),
    min: min.toFixed(1),
    ok,
    note: note ?? "",
  });
}

const width = Math.max(4, ...rows.map((r) => r.pair.length));
for (const r of rows) {
  console.log(
    [
      r.ok ? "  ok  " : "  FAIL",
      r.pair.padEnd(width),
      `${r.ratio.padStart(6)} : 1`,
      `(min ${r.min})`,
      r.note,
    ].join("  "),
  );
}

console.log(
  `\n${rows.length - failed}/${rows.length} portal pairs pass` +
    (failed ? ` — ${failed} FAILED` : ""),
);

if (failed) {
  console.error(
    "\nPortal contrast gate failed. Re-derive the role token rather than\n" +
      "nudging it until it looks right, and never change a BRAND token to fix\n" +
      "a portal pair — that would move the public site.",
  );
  process.exit(1);
}
