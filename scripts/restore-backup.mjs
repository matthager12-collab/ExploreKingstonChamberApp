#!/usr/bin/env node
// Restore a backup bundle produced by GET /api/admin/backup into a data dir.
//
//   node scripts/restore-backup.mjs <bundle.json> <targetDataDir>
//
// Example (restore a downloaded backup into a fresh local .data):
//   node scripts/restore-backup.mjs ~/Downloads/explore-kingston-backup-2026-07-03.json ./.data
//
// On the live Render service you'd instead restore from Render's daily disk
// snapshot (Dashboard → service → Disk → Snapshots). This script is for
// restoring the OFF-SITE bundle onto a new host / local machine / DB import.

import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [, , bundlePath, targetDir] = process.argv;
if (!bundlePath || !targetDir) {
  console.error("usage: node scripts/restore-backup.mjs <bundle.json> <targetDataDir>");
  process.exit(1);
}

const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
if (bundle.app !== "explore-kingston" || !Array.isArray(bundle.files)) {
  console.error("This does not look like an Explore Kingston backup bundle.");
  process.exit(1);
}

const targetAbs = path.resolve(targetDir);
let written = 0;
for (const f of bundle.files) {
  // Guard against path traversal in a malformed/tampered bundle.
  const dest = path.resolve(targetAbs, f.path);
  if (dest !== targetAbs && !dest.startsWith(targetAbs + path.sep)) {
    console.warn(`skipping suspicious path: ${f.path}`);
    continue;
  }
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, f.encoding === "base64" ? Buffer.from(f.content, "base64") : f.content);
  written++;
}
console.log(`Restored ${written}/${bundle.files.length} files into ${targetAbs}`);
console.log(`Backup was taken ${bundle.createdAt} from ${bundle.dataDir}`);
