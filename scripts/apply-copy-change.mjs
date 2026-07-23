#!/usr/bin/env node
// Applies a "Copy change request" issue to the registry: swaps one block's
// built-in `fallback` for the requested wording, so the copy-change workflow can
// open a PR for review. The button that files these issues embeds a base64 JSON
// payload in an HTML comment (src/app/api/admin/site/route.ts); this reads it.
//
// applyCopyChange() is a pure function (unit-tested in
// tests/unit/apply-copy-change.test.ts). main() is the workflow entrypoint and
// never throws — it reports "applied=false" so the workflow can comment on the
// issue instead of failing red.

import { readFileSync, writeFileSync } from "node:fs";

const REGISTRY = "src/lib/site-copy-registry.ts";
// Keep in sync with the marker written in src/app/api/admin/site/route.ts.
const MARKER_RE = /<!-- copy-change-data: ([A-Za-z0-9+/=]+) -->/;

/**
 * Replace the `fallback` string of the block whose key === `key` with `text`,
 * returning the new file contents. `text` is JSON-stringified, so any quotes,
 * newlines, or unicode land as a valid TS string literal. Throws if the key is
 * missing, duplicated, or its fallback can't be located.
 */
export function applyCopyChange(src, key, text) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("Requested wording is empty");
  }
  const keyEsc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyCount = (src.match(new RegExp(`key:\\s*"${keyEsc}"`, "g")) || []).length;
  if (keyCount === 0) throw new Error(`Copy key not found in registry: ${key}`);
  if (keyCount > 1) throw new Error(`Copy key appears ${keyCount}× in registry: ${key}`);
  // From the key, the first `fallback: "…"` is this block's own (blocks are
  // key-then-fallback; comments/flags between them are matched by [\s\S]*?).
  const re = new RegExp(
    `(key:\\s*"${keyEsc}"[\\s\\S]*?fallback:\\s*\\n?\\s*)"(?:[^"\\\\]|\\\\.)*"`,
  );
  if (!re.test(src)) throw new Error(`Could not locate the fallback for key: ${key}`);
  return src.replace(re, (_m, prefix) => `${prefix}${JSON.stringify(text)}`);
}

/** Pull the {key, text} payload out of an issue body, or null if absent/invalid. */
export function parsePayload(body) {
  const m = MARKER_RE.exec(body || "");
  if (!m) return null;
  try {
    const data = JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
    if (typeof data?.key === "string" && typeof data?.text === "string") return data;
  } catch {
    /* fall through to null */
  }
  return null;
}

function hashStr(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/** Append `key=value` to $GITHUB_OUTPUT (multiline-safe heredoc). */
function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const delim = `EOF_${hashStr(String(value))}`;
  writeFileSync(file, `${name}<<${delim}\n${value}\n${delim}\n`, { flag: "a" });
}

function main() {
  const data = parsePayload(process.env.ISSUE_BODY);
  if (!data) {
    console.log("No copy-change payload in the issue body — nothing to apply.");
    setOutput("applied", "false");
    setOutput("reason", "This issue has no machine-readable copy-change payload.");
    return;
  }
  const src = readFileSync(REGISTRY, "utf8");
  const before = (src.match(/\bkey:\s*"/g) || []).length;
  let next;
  try {
    next = applyCopyChange(src, data.key, data.text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.log(`Could not apply: ${reason}`);
    setOutput("applied", "false");
    setOutput("reason", reason);
    return;
  }
  // Integrity guard: a fallback swap must never change the number of blocks.
  const after = (next.match(/\bkey:\s*"/g) || []).length;
  if (after !== before || next === src) {
    console.log("Refusing to write: the edit looked unsafe (block count changed or no-op).");
    setOutput("applied", "false");
    setOutput("reason", "The automated edit looked unsafe and was skipped.");
    return;
  }
  writeFileSync(REGISTRY, next);
  console.log(`Applied copy change for ${data.key}.`);
  setOutput("applied", "true");
  setOutput("key", data.key);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
