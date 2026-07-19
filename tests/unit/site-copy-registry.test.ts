// Copy-registry consistency guardrail (E07: single-sourced fallbacks).
//
// The contract (documented in src/lib/site-copy-registry.ts): the registry is
// the ONLY home of default copy. The site resolves copy via three call shapes,
// all with STRING-LITERAL keys and NO inline fallback:
//   - copyText(copy, "key")               (server, site-store.ts)
//   - useCopy("key")                      (client hook, copy-context.tsx)
//   - <EditableText copyKey="key" … />    (client component)
//
// This test statically scans src/ for those shapes and enforces:
//   1. every occurrence parses to a literal key — a dynamic key is a contract
//      violation and fails loudly;
//   2. every extracted key exists in COPY_BLOCKS;
//   3. every registry key is referenced by at least one call site — a block
//      nothing renders is a phantom the admin would edit for no effect
//      (ALLOW_UNREFERENCED is the explicit, deliberate exception list);
//   4. no call site carries an inline fallback (3-arg copyText, 2-arg useCopy,
//      or an EditableText fallback= prop) — the wording lives in the registry
//      only, so "Reset to default" is truthful by construction;
//   5. registry keys are unique and every fallback is non-empty.

import fs from "fs";
import path from "path";
import fg from "fast-glob";
import { describe, expect, it } from "vitest";
import { COPY_BLOCKS } from "@/lib/site-copy-registry";

// Registry keys that are deliberately unreferenced (none today). Add a key
// here ONLY with a comment saying why it must outlive its call sites.
const ALLOW_UNREFERENCED: string[] = [];

const SRC = path.join(process.cwd(), "src");

// The definition sites — scanning them would match the function/component
// signatures, not call sites. Excluded by relative path from SRC.
const EXCLUDE = ["lib/copy-context.tsx", "lib/stores/site-store.ts"];

const FILES = fg
  .sync(["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"], {
    cwd: SRC,
    absolute: true,
    ignore: EXCLUDE,
  })
  .sort();

// A double-quoted JS string literal, escape-aware (captures the full "..." incl. quotes).
const STR = String.raw`"(?:[^"\\]|\\.)*"`;

// Remove // line and /* */ block comments while preserving every string/template
// literal verbatim — so a doc-comment that mentions `copyText(` (e.g. the registry
// header) is not miscounted as a call, and a URL's `//` inside a string survives.
// Normal-state `\` escapes are consumed as a pair so regex delimiters like `\/\/`
// are not mistaken for a comment.
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "\\") {
      out += c + (src[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        const ch = src[i];
        out += ch;
        if (ch === "\\") {
          out += src[i + 1] ?? "";
          i += 2;
          continue;
        }
        i++;
        if (ch === quote) break;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      i += 2;
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// Decode a source string literal (e.g. `"you're"`, `"a \"b\""`) to its runtime value.
function decode(literal: string): string {
  try {
    return JSON.parse(literal) as string;
  } catch {
    // Fallback: strip the outer quotes and unescape the common cases.
    return literal
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
}

interface Occurrence {
  key: string;
  file: string;
  kind: "copyText" | "useCopy" | "EditableText";
}

// Count raw invocations of a shape so we can prove every one was parsed (an
// unparsed occurrence = a dynamic key OR a leftover inline fallback).
function countRaw(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

const occurrences: Occurrence[] = [];
const unparsed: string[] = [];
const inlineFallbacks: string[] = [];

// The keys-only call shapes. The legacy 3-arg copyText / 2-arg useCopy shapes
// deliberately do NOT match these, so any leftover lands in `unparsed` — and
// is also reported explicitly by the inline-fallback patterns below.
const copyTextRe = new RegExp(
  String.raw`\bcopyText\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*(` + STR + String.raw`)\s*,?\s*\)`,
  "g",
);
const useCopyRe = new RegExp(
  String.raw`\buseCopy\s*\(\s*(` + STR + String.raw`)\s*,?\s*\)`,
  "g",
);
const editableRe = /<EditableText\b([\s\S]*?)\/>/g;
const attrRe = (name: string) =>
  new RegExp(String.raw`\b${name}\s*=\s*\{?\s*(` + STR + String.raw`)\s*\}?`);

// Inline-fallback (legacy) shapes — must match ZERO times anywhere.
const copyTextInlineRe = new RegExp(
  String.raw`\bcopyText\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*` + STR + String.raw`\s*,`,
  "g",
);
const useCopyInlineRe = new RegExp(String.raw`\buseCopy\s*\(\s*` + STR + String.raw`\s*,`, "g");

for (const file of FILES) {
  const rel = path.relative(SRC, file);
  const text = stripComments(fs.readFileSync(file, "utf8"));

  // copyText
  let m: RegExpExecArray | null;
  copyTextRe.lastIndex = 0;
  let copyTextParsed = 0;
  while ((m = copyTextRe.exec(text))) {
    occurrences.push({ key: decode(m[1]), file: rel, kind: "copyText" });
    copyTextParsed++;
  }
  const copyTextRaw = countRaw(text, /\bcopyText\s*\(/g);
  if (copyTextRaw !== copyTextParsed) {
    unparsed.push(
      `${rel}: ${copyTextRaw} copyText( calls, only ${copyTextParsed} parsed to (ident, "key")`,
    );
  }

  // useCopy
  useCopyRe.lastIndex = 0;
  let useCopyParsed = 0;
  while ((m = useCopyRe.exec(text))) {
    occurrences.push({ key: decode(m[1]), file: rel, kind: "useCopy" });
    useCopyParsed++;
  }
  const useCopyRaw = countRaw(text, /\buseCopy\s*\(/g);
  if (useCopyRaw !== useCopyParsed) {
    unparsed.push(`${rel}: ${useCopyRaw} useCopy( calls, only ${useCopyParsed} parsed to ("key")`);
  }

  // EditableText (attribute order varies; copyKey pulled from the element)
  editableRe.lastIndex = 0;
  let editableParsed = 0;
  while ((m = editableRe.exec(text))) {
    const attrs = m[1];
    const keyM = attrs.match(attrRe("copyKey"));
    if (keyM) {
      occurrences.push({ key: decode(keyM[1]), file: rel, kind: "EditableText" });
      editableParsed++;
    }
    if (attrRe("fallback").test(attrs)) {
      inlineFallbacks.push(`${rel}: <EditableText …> carries a fallback= prop`);
    }
  }
  const copyKeyRaw = countRaw(text, /\bcopyKey\s*=/g);
  if (copyKeyRaw !== editableParsed) {
    unparsed.push(
      `${rel}: ${copyKeyRaw} copyKey= attrs, only ${editableParsed} parsed to a literal key`,
    );
  }

  // Legacy inline-fallback call shapes.
  for (const [re, label] of [
    [copyTextInlineRe, 'copyText(ident, "key", …inline fallback…)'],
    [useCopyInlineRe, 'useCopy("key", …inline fallback…)'],
  ] as const) {
    re.lastIndex = 0;
    const hits = countRaw(text, re);
    if (hits > 0) inlineFallbacks.push(`${rel}: ${hits} × ${label}`);
  }
}

const registryKeys: string[] = COPY_BLOCKS.map((b) => b.key);
const registryKeySet = new Set<string>(registryKeys);

describe("copy-registry consistency", () => {
  it("parses every copyText/useCopy/copyKey occurrence to a literal key (no dynamic keys)", () => {
    expect(
      unparsed,
      `Unparsed copy occurrences (dynamic keys or leftover inline fallbacks):\n${unparsed.join("\n")}`,
    ).toEqual([]);
    // Tripwire: the scanner must actually be finding call sites, not silently matching nothing.
    expect(occurrences.length).toBeGreaterThan(60);
  });

  it("no call site carries an inline fallback — the registry is the only home of default copy", () => {
    expect(
      inlineFallbacks,
      `Inline fallbacks found (the wording belongs in COPY_BLOCKS):\n${inlineFallbacks.join("\n")}`,
    ).toEqual([]);
  });

  it("every extracted key exists in the registry", () => {
    const missing = occurrences
      .filter((o) => !registryKeySet.has(o.key))
      .map((o) => `${o.file} [${o.kind}] key="${o.key}" not in COPY_BLOCKS`);
    expect(missing, `Call-site keys with no registry block:\n${missing.join("\n")}`).toEqual([]);
  });

  it("every registry key is referenced by at least one call site", () => {
    const usedKeys = new Set(occurrences.map((o) => o.key));
    const orphans = registryKeys
      .filter((k) => !usedKeys.has(k) && !ALLOW_UNREFERENCED.includes(k))
      .sort();
    expect(
      orphans,
      `Registry keys with no call site — phantom blocks the admin would edit for no ` +
        `effect. Wire them up, remove them, or add to ALLOW_UNREFERENCED with a reason:\n` +
        JSON.stringify(orphans),
    ).toEqual([]);
    // The allowlist may not rot either: every entry must still be a real key.
    const staleAllow = ALLOW_UNREFERENCED.filter((k) => !registryKeySet.has(k));
    expect(staleAllow, `ALLOW_UNREFERENCED entries no longer in the registry: ${staleAllow}`).toEqual(
      [],
    );
  });

  it("registry keys are unique and fallbacks non-empty", () => {
    const seen = new Set<string>();
    const dupes = registryKeys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
    expect(dupes, `Duplicate registry keys: ${dupes}`).toEqual([]);
    const empty = COPY_BLOCKS.filter((b) => b.fallback.trim() === "").map((b) => b.key);
    expect(empty, `Registry blocks with empty fallbacks: ${empty}`).toEqual([]);
  });
});
