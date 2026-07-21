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
  SAFETY_CONTENT,
  SAFETY_LANG,
  SAFETY_SECTION_ORDER,
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

/** Every string a reader would see in one half, flattened with a path label. */
function everyString(strings: SafetyStrings): Flat[] {
  const out: Flat[] = [];
  for (const [key, section] of Object.entries(strings) as [string, SafetySection][]) {
    out.push({ path: `${key}.title`, value: section.title, kind: "title" });
    section.steps.forEach((s, i) =>
      out.push({ path: `${key}.steps[${i}]`, value: s, kind: "prose" }),
    );
    if (section.note !== undefined) {
      out.push({ path: `${key}.note`, value: section.note, kind: "prose" });
    }
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
});
