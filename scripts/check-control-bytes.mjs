#!/usr/bin/env node
// Raw-control-byte enforcement for CI + local use.
//
// Fails (exit 1) if any tracked text file contains a raw C0 control byte other
// than TAB / LF / CR, or a raw DEL.
//
// WHY THIS IS A CI GATE AND NOT A LINT RULE. A single raw control byte makes
// `file` classify the source as binary, and grep then SKIPS THE FILE ENTIRELY —
// returning no output rather than "no match". This repo leans on grep-based
// guards and hand-run sweeps (secret scans, the SW contract test, a11y
// invariant scans), and every one of them is blind to such a file. The defect
// is invisible in review too: editors and `git diff` render a NUL as nothing or
// as a space, so the line looks correct. ESLint cannot catch it either — the
// byte is valid inside a string literal and the parse succeeds.
//
// It has happened twice: src/lib/analytics-store.ts and src/lib/events/dedupe.ts
// both used raw NUL as a composite-key separator, and scripts/check-frozen.mjs
// used one as a glob-substitution sentinel — so this repo's own frozen-file
// guard was itself unsearchable. All three are fixed; this keeps them fixed.
//
// THE FIX is always the same and is free at runtime: write the escape (backslash
// u 0 0 0 0) instead of the raw byte. JavaScript parses it to the identical
// string — only the on-disk bytes change, and the file stays plain UTF-8 text.
//
// Unlike check-frozen.mjs this scans the FULL tracked tree rather than the diff:
// it enforces an invariant, not a policy about what a PR may touch, so it must
// also catch rot that predates the current branch.
//
// Zero-dependency Node ESM. Run: node scripts/check-control-bytes.mjs

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Written as a char code on purpose: a script whose whole job is to ban stray
// control bytes should not embed the very escape sequences it tells you to use,
// and this keeps the advice below readable without quoting gymnastics.
const BACKSLASH = String.fromCharCode(92);

// Extensions whose contents are legitimately binary. Everything else is treated
// as text and scanned.
//
// This is a DENYLIST, deliberately. An allowlist of "source" extensions would
// silently skip any file type nobody remembered to add — the exact
// fails-quietly behaviour this guard exists to eliminate. A denylist fails the
// other way: a new binary format trips the guard loudly on its first commit and
// someone appends one line here. Loud and wrong beats quiet and wrong.
const BINARY_EXTENSIONS = new Set([
  // images
  "avif", "bmp", "gif", "heic", "heif", "ico", "jpeg", "jpg", "png", "webp",
  // fonts
  "eot", "otf", "ttf", "woff", "woff2",
  // documents
  "docx", "pdf", "pptx", "xlsx",
  // archives, media, compiled output
  "br", "bz2", "gz", "mp3", "mp4", "wasm", "webm", "zip",
  // local databases / snapshots
  "db", "sqlite", "sqlite3",
]);

// C0 controls that are legitimate whitespace in a text file.
const ALLOWED = new Set([0x09 /* TAB */, 0x0a /* LF */, 0x0d /* CR */]);

// Per-file reporting cap. Overflow is always reported as a count, never dropped.
const MAX_HITS = 5;

const CONTROL_NAMES = {
  0x00: "NUL", 0x01: "SOH", 0x02: "STX", 0x03: "ETX", 0x04: "EOT", 0x05: "ENQ",
  0x06: "ACK", 0x07: "BEL", 0x08: "BS", 0x0b: "VT", 0x0c: "FF", 0x0e: "SO",
  0x0f: "SI", 0x10: "DLE", 0x11: "DC1", 0x12: "DC2", 0x13: "DC3", 0x14: "DC4",
  0x15: "NAK", 0x16: "SYN", 0x17: "ETB", 0x18: "CAN", 0x19: "EM", 0x1a: "SUB",
  0x1b: "ESC", 0x1c: "FS", 0x1d: "GS", 0x1e: "RS", 0x1f: "US", 0x7f: "DEL",
};

function isForbidden(byte) {
  if (ALLOWED.has(byte)) return false;
  return byte < 0x20 || byte === 0x7f;
}

function extensionOf(file) {
  const base = file.slice(file.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/** Byte offset -> { line, column }, both 1-based, counting LF as the break. */
function locate(buf, offset) {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (buf[i] === 0x0a) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

let files;
try {
  files = execSync("git ls-files -z", {
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
} catch {
  console.log("check-control-bytes: not a git repo; skipping.");
  process.exit(0);
}

const offenders = [];
let scanned = 0;

for (const file of files) {
  if (BINARY_EXTENSIONS.has(extensionOf(file))) continue;

  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    continue; // deleted, or a submodule/symlink pointing nowhere
  }
  scanned++;

  // Report at most MAX_HITS per file — a genuinely corrupted binary would
  // otherwise bury the log — but keep counting so the overflow can be stated.
  // Truncating silently would hide offenders from someone fixing the list, which
  // is the same fail-quietly shape this guard exists to stamp out.
  const hits = [];
  let total = 0;
  for (let i = 0; i < buf.length; i++) {
    if (!isForbidden(buf[i])) continue;
    total++;
    if (hits.length < MAX_HITS) {
      const { line, column } = locate(buf, i);
      hits.push({ line, column, byte: buf[i] });
    }
  }
  if (total) offenders.push({ file, hits, total });
}

if (offenders.length === 0) {
  console.log(`check-control-bytes: OK — ${scanned} tracked text file(s), no raw control bytes.`);
  process.exit(0);
}

console.error("check-control-bytes: FAILED — raw control byte(s) in tracked text files.\n");
for (const { file, hits, total } of offenders) {
  for (const { line, column, byte } of hits) {
    const hex = byte.toString(16).padStart(2, "0");
    const name = CONTROL_NAMES[byte] ?? "control";
    console.error(`  ${file}:${line}:${column}  0x${hex} ${name}`);
  }
  if (total > hits.length) {
    console.error(`  ${file}: ... and ${total - hits.length} more (${total} total in this file)`);
  }
}

const example = `${BACKSLASH}u0000`;
console.error(`
Why this fails the build: a raw control byte makes \`file\` report the source as
binary, so grep skips it silently — returning no output rather than no matches.
Every grep-based guard in this repo, and every hand-run search, goes blind to
that file, and nothing else tells you.

To fix, replace each raw byte with its escape (e.g. NUL becomes ${example}).
JavaScript parses the escape to the identical string, so runtime behaviour is
unchanged; only the on-disk bytes differ and the file becomes text again.

Verify with:  file -b <path>     # should say "text", never "data"
              grep -c . <path>   # should print a count, never nothing

If a file is genuinely binary, add its extension to BINARY_EXTENSIONS in
scripts/check-control-bytes.mjs.`);

process.exit(1);
