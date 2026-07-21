import type { LevelMeta } from "@/lib/ferry-forecast";

/**
 * AA-safe chip classes for a ferry busyness level.
 *
 * Why this exists instead of a one-line edit to LEVELS:
 * `LEVELS.light.chip` in src/lib/ferry-forecast.ts is `bg-fern/10 text-fern`.
 * That composites to #edf2ee and measures 4.29:1 — under the 4.5:1 AA floor of
 * WCAG 1.4.3 for the 12–14px chips it renders as. It is the same defect E14
 * repaired in ui.tsx and open-badge.tsx.
 *
 * ferry-forecast.ts is FROZEN (.agent-frozen), so the fix lands at the usage
 * sites instead — the two non-frozen components that render `meta.chip`. The
 * other four levels (tide/amber/orange/coral tints) already pass and are passed
 * through untouched.
 *
 * This REPLACES the class rather than appending an override, deliberately:
 * `text-fern` and `text-white` are both single-class Tailwind utilities with
 * equal specificity, so which one wins is decided by their order in the
 * generated stylesheet, not by their order in the class attribute. Appending
 * would be a coin flip that happens to look right today.
 *
 * If ferry-forecast.ts is ever unfrozen, move `bg-fern text-white` into
 * LEVELS.light.chip and delete this module.
 * tests/unit/a11y-static-invariants.test.ts asserts both halves of that coupling.
 */
export function chipClass(meta: LevelMeta): string {
  // Solid fern with white text is 4.86:1 — the house style for green chips.
  return meta.level === "light" ? "bg-fern text-white" : meta.chip;
}
