// Copy-registry consistency guardrail (admin-CMS audit §6, guardrail 1).
//
// The contract (documented in src/lib/site-copy-registry.ts): every CopyBlock's
// `fallback` is "the exact string hardcoded in the page component". The site
// resolves copy via three call shapes, all with STRING-LITERAL keys today:
//   - copyText(copy, "key", "fallback")           (server, site-store.ts)
//   - useCopy("key", "fallback")                  (client hook, copy-context.tsx)
//   - <EditableText ... copyKey="key" fallback="fallback" />   (client component)
//
// This test statically scans src/ for those three shapes and enforces:
//   1. every occurrence parses to a literal (key, fallback) pair — a dynamic key
//      is a contract violation and fails loudly;
//   2. every extracted key exists in COPY_BLOCKS;
//   3. every extracted fallback string-equals the registry `fallback` (the drift
//      guard — a mismatch means /admin/content shows operators a "default" the
//      site does not actually render, and "Reset to default" restores the wrong
//      text);
//   4. the set of registry keys with NO call site equals the committed allowlist
//      tests/unit/copy-orphans.json (orphans are kept explicitly, not deleted).
//
// Direction of truth is always registry -> call site: when a fallback drifts, the
// registry is corrected to match the rendering code, never the other way around.

import fs from "fs";
import path from "path";
import fg from "fast-glob";
import { describe, expect, it } from "vitest";
import { COPY_BLOCKS } from "@/lib/site-copy-registry";
import orphanAllowlist from "./copy-orphans.json";

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
// header) is not miscounted as a call, and a URL's `//` inside a fallback survives.
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
  fallback: string;
  file: string;
  kind: "copyText" | "useCopy" | "EditableText";
}

// Count raw invocations of a shape so we can prove every one was parsed (an
// unparsed occurrence = a dynamic key = a contract violation).
function countRaw(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

const occurrences: Occurrence[] = [];
const unparsed: string[] = [];

const copyTextRe = new RegExp(
  String.raw`\bcopyText\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*(` + STR + String.raw`)\s*,\s*(` + STR + String.raw`)\s*,?\s*\)`,
  "g",
);
const useCopyRe = new RegExp(
  String.raw`\buseCopy\s*\(\s*(` + STR + String.raw`)\s*,\s*(` + STR + String.raw`)\s*\)`,
  "g",
);
const editableRe = /<EditableText\b([\s\S]*?)\/>/g;
const attrRe = (name: string) =>
  new RegExp(String.raw`\b${name}\s*=\s*\{?\s*(` + STR + String.raw`)\s*\}?`);

for (const file of FILES) {
  const rel = path.relative(SRC, file);
  const text = stripComments(fs.readFileSync(file, "utf8"));

  // copyText
  let m: RegExpExecArray | null;
  copyTextRe.lastIndex = 0;
  let copyTextParsed = 0;
  while ((m = copyTextRe.exec(text))) {
    occurrences.push({ key: decode(m[1]), fallback: decode(m[2]), file: rel, kind: "copyText" });
    copyTextParsed++;
  }
  const copyTextRaw = countRaw(text, /\bcopyText\s*\(/g);
  if (copyTextRaw !== copyTextParsed) {
    unparsed.push(`${rel}: ${copyTextRaw} copyText( calls, only ${copyTextParsed} parsed to literals`);
  }

  // useCopy
  useCopyRe.lastIndex = 0;
  let useCopyParsed = 0;
  while ((m = useCopyRe.exec(text))) {
    occurrences.push({ key: decode(m[1]), fallback: decode(m[2]), file: rel, kind: "useCopy" });
    useCopyParsed++;
  }
  const useCopyRaw = countRaw(text, /\buseCopy\s*\(/g);
  if (useCopyRaw !== useCopyParsed) {
    unparsed.push(`${rel}: ${useCopyRaw} useCopy( calls, only ${useCopyParsed} parsed to literals`);
  }

  // EditableText (attribute order varies; copyKey + fallback pulled from the element)
  editableRe.lastIndex = 0;
  let editableParsed = 0;
  while ((m = editableRe.exec(text))) {
    const attrs = m[1];
    const keyM = attrs.match(attrRe("copyKey"));
    const fbM = attrs.match(attrRe("fallback"));
    if (keyM && fbM) {
      occurrences.push({ key: decode(keyM[1]), fallback: decode(fbM[1]), file: rel, kind: "EditableText" });
      editableParsed++;
    }
  }
  const copyKeyRaw = countRaw(text, /\bcopyKey\s*=/g);
  if (copyKeyRaw !== editableParsed) {
    unparsed.push(`${rel}: ${copyKeyRaw} copyKey= attrs, only ${editableParsed} parsed to (key,fallback) pairs`);
  }
}

const registryByKey = new Map(COPY_BLOCKS.map((b) => [b.key, b]));

describe("copy-registry consistency", () => {
  it("parses every copyText/useCopy/copyKey occurrence to a literal (no dynamic keys)", () => {
    expect(unparsed, `Unparsed copy occurrences (dynamic keys are a contract violation):\n${unparsed.join("\n")}`).toEqual(
      [],
    );
    // Tripwire: the scanner must actually be finding call sites, not silently matching nothing.
    expect(occurrences.length).toBeGreaterThan(60);
  });

  it("every extracted key exists in the registry", () => {
    const missing = occurrences
      .filter((o) => !registryByKey.has(o.key))
      .map((o) => `${o.file} [${o.kind}] key="${o.key}" not in COPY_BLOCKS`);
    expect(missing, `Call-site keys with no registry block:\n${missing.join("\n")}`).toEqual([]);
  });

  it("every extracted fallback matches the registry fallback exactly", () => {
    const drift = occurrences
      .filter((o) => registryByKey.has(o.key))
      .filter((o) => registryByKey.get(o.key)!.fallback !== o.fallback)
      .map(
        (o) =>
          `${o.file} [${o.kind}] key="${o.key}"\n    registry:  ${JSON.stringify(registryByKey.get(o.key)!.fallback)}\n    callsite:  ${JSON.stringify(o.fallback)}`,
      );
    expect(drift, `Registry/call-site fallback drift (fix the REGISTRY to match the call site):\n${drift.join("\n\n")}`).toEqual(
      [],
    );
  });

  it("registry keys with no call site equal the committed orphan allowlist", () => {
    const usedKeys = new Set(occurrences.map((o) => o.key));
    const orphans = COPY_BLOCKS.map((b) => b.key)
      .filter((k) => !usedKeys.has(k))
      .sort();
    const allowlist = [...(orphanAllowlist as string[])].sort();
    expect(
      orphans,
      `Registry keys with no call site. If genuinely unrendered, add to tests/unit/copy-orphans.json; ` +
        `otherwise wire them up or remove them.\nOrphans found: ${JSON.stringify(orphans)}\nAllowlist: ${JSON.stringify(allowlist)}`,
    ).toEqual(allowlist);
  });
});
