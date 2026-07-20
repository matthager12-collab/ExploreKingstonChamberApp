#!/usr/bin/env node
// Mechanical validation of a backup bundle (E10 §7) — the restore drill's "is
// this file actually good?" step, AND a truncation tripwire for the
// belt-and-suspenders streaming backup: a truncated download fails JSON.parse
// (incomplete JSON) or the fileCount === files.length completeness check below.
//
//   node scripts/verify-backup.mjs <bundle.json> [--expect-auth]
//
// --expect-auth asserts the bundle carries account data (a production pull),
// which since E05 lives in the Postgres dump (bundle.db), not files/auth/.
// Exit 0 = valid; exit 1 = a problem (message on stderr).

import { readFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const expectAuth = args.includes("--expect-auth");
const bundlePath = args.find((a) => !a.startsWith("--"));

if (!bundlePath) {
  console.error("usage: node scripts/verify-backup.mjs <bundle.json> [--expect-auth]");
  process.exit(1);
}

function fail(msg) {
  console.error(`INVALID: ${msg}`);
  process.exit(1);
}

let bundle;
try {
  bundle = JSON.parse(await readFile(bundlePath, "utf8"));
} catch (err) {
  fail(`could not parse ${bundlePath} as JSON (truncated download?): ${err.message}`);
}

if (bundle.app !== "explore-kingston") {
  fail(`app is "${bundle.app}", expected "explore-kingston"`);
}
if (!Array.isArray(bundle.files)) fail("files is not an array");

// Completeness: the trailing fileCount must match the files actually present. A
// truncated stream loses the trailing count (or already failed JSON.parse).
if (typeof bundle.fileCount === "number" && bundle.fileCount !== bundle.files.length) {
  fail(`fileCount ${bundle.fileCount} != files.length ${bundle.files.length} (truncated?)`);
}

// Path-traversal guard — the same rule scripts/restore-backup.mjs enforces:
// reject any entry that would escape the restore root.
const root = path.resolve("/restore-root"); // notional root; this only checks relativity
let decodedBytes = 0;
for (const f of bundle.files) {
  if (typeof f.path !== "string") fail("a file entry has no string path");
  const dest = path.resolve(root, f.path);
  if (dest !== root && !dest.startsWith(root + path.sep)) {
    fail(`path traversal in bundle: ${f.path}`);
  }
  if (typeof f.content === "string") {
    decodedBytes +=
      f.encoding === "base64"
        ? Buffer.from(f.content, "base64").length
        : Buffer.byteLength(f.content, "utf8");
  }
}

if (expectAuth) {
  const hasDbData =
    bundle.db && typeof bundle.db === "object" && Object.keys(bundle.db).length > 0;
  const hasAuthFile = bundle.files.some(
    (f) => typeof f.path === "string" && f.path.startsWith("auth" + path.sep),
  );
  if (!hasDbData && !hasAuthFile) {
    fail("--expect-auth: no db section and no auth/ files — not a production bundle?");
  }
}

console.log(
  `OK: ${bundle.files.length} files, ${decodedBytes} decoded bytes, taken ${bundle.createdAt ?? "?"}`,
);
if (bundle.db && typeof bundle.db === "object") {
  console.log(`     db section present (${Object.keys(bundle.db).length} keys)`);
}
process.exit(0);
