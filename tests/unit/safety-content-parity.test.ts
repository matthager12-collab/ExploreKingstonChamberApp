// E14 — EN/ES parity for the safety slice (FR-92). CI-blocking via `npm test`.
//
// The whole review gate for /es rests on one assumption: that the Spanish is a
// COMPLETE counterpart of the English, so a bilingual reviewer reading the
// Spanish has read everything a Spanish-speaking visitor will see. TypeScript
// already forces both halves to have the same keys (they share the
// SafetyStrings interface). What it cannot see is a section translated to ""
// as a placeholder, a `note` dropped on one side, or a steps list that lost an
// entry in translation — each of which silently removes an instruction from one
// language only. That is what this file catches.

import { describe, expect, it } from "vitest";
import {
  fillSafetyText,
  SAFETY_CONTENT,
  SAFETY_LANG,
  SAFETY_PLACEHOLDERS,
  SAFETY_SECTION_ORDER,
  safetyPlaceholdersIn,
  type SafetySection,
  type SafetyStrings,
} from "@/lib/i18n/safety-content";

const LANGS = ["en", "es"] as const;

function sectionKeys(strings: SafetyStrings): string[] {
  return Object.keys(strings).sort();
}

interface Flat {
  path: string;
  value: string;
  /** Headings are legitimately short ("Baños"); prose is not. */
  kind: "title" | "prose";
}

/** Every string in ONE section, flattened with a path label. */
function sectionStrings(key: string, section: SafetySection): Flat[] {
  const out: Flat[] = [{ path: `${key}.title`, value: section.title, kind: "title" }];
  section.steps.forEach((s, i) => out.push({ path: `${key}.steps[${i}]`, value: s, kind: "prose" }));
  if (section.note !== undefined) {
    out.push({ path: `${key}.note`, value: section.note, kind: "prose" });
  }
  return out;
}

/** Every string a reader would see in one half, flattened with a path label. */
function everyString(strings: SafetyStrings): Flat[] {
  const out: Flat[] = [];
  for (const [key, section] of Object.entries(strings) as [string, SafetySection][]) {
    out.push(...sectionStrings(key, section));
  }
  return out;
}

describe("EN/ES safety dictionary parity", () => {
  it("both halves expose the identical set of sections", () => {
    expect(sectionKeys(SAFETY_CONTENT.es)).toEqual(sectionKeys(SAFETY_CONTENT.en));
  });

  it("the render order covers every section exactly once", () => {
    // If a section is added to the interface but not to SAFETY_SECTION_ORDER it
    // never renders on either page — the failure mode this catches is silent.
    expect([...SAFETY_SECTION_ORDER].sort()).toEqual(sectionKeys(SAFETY_CONTENT.en));
    expect(new Set(SAFETY_SECTION_ORDER).size).toBe(SAFETY_SECTION_ORDER.length);
  });

  it("each section has the same number of steps in both languages", () => {
    const mismatches: string[] = [];
    for (const key of SAFETY_SECTION_ORDER) {
      const en = SAFETY_CONTENT.en[key].steps.length;
      const es = SAFETY_CONTENT.es[key].steps.length;
      if (en !== es) mismatches.push(`${key}: en has ${en} steps, es has ${es}`);
    }
    expect(
      mismatches,
      `A step exists in one language only — a visitor in the other language never sees that instruction:\n${mismatches.join("\n")}`,
    ).toEqual([]);
  });

  it("a section either has a note in both languages or in neither", () => {
    const mismatches = SAFETY_SECTION_ORDER.filter(
      (key) =>
        (SAFETY_CONTENT.en[key].note === undefined) !==
        (SAFETY_CONTENT.es[key].note === undefined),
    );
    expect(mismatches, `Sections whose closing note exists in one language only: ${mismatches}`).toEqual(
      [],
    );
  });

  it.each(LANGS)("%s has no empty or whitespace-only strings", (lang) => {
    const empty = everyString(SAFETY_CONTENT[lang])
      .filter((s) => s.value.trim().length === 0)
      .map((s) => s.path);
    expect(
      empty,
      `Empty ${lang} strings — an untranslated placeholder must never ship:\n${empty.join("\n")}`,
    ).toEqual([]);
  });

  it.each(LANGS)("%s says something substantial in every string", (lang) => {
    // A one-word "TODO" passes the empty check but is not content. Headings are
    // legitimately short — "Baños" is a complete, correct heading — so only the
    // prose carries a sentence-length floor.
    const stubs = everyString(SAFETY_CONTENT[lang])
      .filter((s) => s.value.trim().length < (s.kind === "title" ? 4 : 20))
      .map((s) => `${s.path}: ${JSON.stringify(s.value)}`);
    expect(stubs, `Suspiciously short ${lang} strings:\n${stubs.join("\n")}`).toEqual([]);
  });

  it("the two halves are actually different text (not English pasted into es)", () => {
    // Cheap tripwire for the "translate it later" mistake: if the Spanish
    // titles are byte-identical to the English ones, nobody translated them.
    const identical = SAFETY_SECTION_ORDER.filter(
      (key) => SAFETY_CONTENT.en[key].title === SAFETY_CONTENT.es[key].title,
    );
    expect(identical, `Section titles identical in en and es: ${identical}`).toEqual([]);
  });

  it("declares the BCP-47 tags the render sites put on lang= (WCAG 3.1.2)", () => {
    expect(SAFETY_LANG.en).toBe("en");
    expect(SAFETY_LANG.es).toBe("es");
  });

  it.each(LANGS)("%s uses only declared placeholders", (lang) => {
    // An undeclared {token} would render as literal braces on a page a visitor
    // is acting on. The declared set is also what the render sites must supply.
    const unknown = everyString(SAFETY_CONTENT[lang])
      .flatMap((s) => safetyPlaceholdersIn(s.value).map((t) => `${s.path}: {${t}}`))
      .filter((entry) => !SAFETY_PLACEHOLDERS.some((t) => entry.endsWith(`{${t}}`)));
    expect(unknown, `Undeclared placeholder tokens:\n${unknown.join("\n")}`).toEqual([]);
  });

  it("both halves carry the same placeholders in the same places", () => {
    // A translator dropping `{phone}` is how /es ends up with no Chamber number
    // at all, or — worse — with a stale one pasted back in as a literal.
    const mismatches: string[] = [];
    for (const key of SAFETY_SECTION_ORDER) {
      const en = sectionStrings(key, SAFETY_CONTENT.en[key]);
      const es = sectionStrings(key, SAFETY_CONTENT.es[key]);
      en.forEach((s, i) => {
        const a = safetyPlaceholdersIn(s.value).sort().join(",");
        const b = safetyPlaceholdersIn(es[i]?.value ?? "").sort().join(",");
        if (a !== b) mismatches.push(`${s.path}: en has [${a}], es has [${b}]`);
      });
    }
    expect(mismatches, `Placeholder drift between languages:\n${mismatches.join("\n")}`).toEqual([]);
  });

  it("the Chamber phone is never a literal in the dictionary", () => {
    // It is a copy-registry block so the office can change it without a deploy.
    // A second copy frozen in here keeps publishing the old number forever.
    const literals = LANGS.flatMap((lang) =>
      everyString(SAFETY_CONTENT[lang])
        .filter((s) => /\b\d{3}-\d{3}-\d{4}\b/.test(s.value))
        .map((s) => `${lang}.${s.path}: ${s.value}`),
    ).filter((entry) => !/\b(?:888-808-7977|800-501-7433)\b/.test(entry));
    expect(
      literals,
      `Hardcoded local phone number(s) — use {phone} and let the render site fill it:\n${literals.join("\n")}`,
    ).toEqual([]);
  });

  it("filling a string substitutes every declared token and leaves nothing behind", () => {
    const filled = fillSafetyText(SAFETY_CONTENT.en.help.steps[0], { phone: "555-0100" });
    expect(filled).toContain("555-0100");
    expect(filled).not.toContain("{phone}");
  });
});
