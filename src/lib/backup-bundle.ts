// The file-walk + JSON-envelope core of the off-site backup bundle (E10 §4),
// extracted from src/app/api/admin/backup/route.ts so it is unit-testable
// without HTTP and so the route can STREAM it one file at a time.
//
// Why streaming matters: the old route buffered the ENTIRE data dir into one
// JSON.stringify in RAM (base64 inflates binaries +33%), which OOMs the 512 MB
// Render instance exactly when a backup matters most. Here the document is an
// async generator of string chunks; a pull-based ReadableStream in the route
// applies backpressure so peak memory is ~one file (an 8 MB photo → ~11 MB
// base64), not the whole disk. Each file's (potentially huge) content is emitted
// as its OWN chunk with no wrapping JSON.stringify: base64's alphabet is
// JSON-safe so it needs no escaping, and we never hold two copies of it.
//
// The document is byte-shaped for the restore path, not for byte-identity with
// historical bundles: scripts/restore-backup.mjs reads only `app` + `files`
// (per-entry {path, encoding, content}), so `fileCount` sits AFTER `files`
// (a stream can't know the count until it has walked) and the whole thing still
// parses as valid JSON. `fileCount` doubles as an integrity check: a truncated
// download loses it (or the trailing `db`), and verify/restore can flag that.

import { readdir, readFile } from "fs/promises";
import path from "path";

export interface BundledFile {
  path: string;
  encoding: "utf8" | "base64";
  content: string;
}

// text inlines as UTF-8; everything else (photos, .mmdb, …) base64. Preserved
// verbatim from the original route so emit-time encoding matches restore-time
// decoding exactly.
const TEXT_EXT = /\.(json|jsonl|txt|md|csv)$/i;

// Top-level entries never included in the bundle:
//  - backups/ : scripts/backup-data.sh writes growing tar.gz snapshots here;
//               inlining them would nest every prior backup and grow the bundle
//               without bound (correctness, not just size).
//  - geoip/   : the DB-IP City Lite .mmdb (E10 §6) — ~125 MB, not durable
//               state, and always re-obtainable (baked into the image at build,
//               or `scripts/update-geoip.mjs` for dev), so never ship it.
// Anchored to the TOP LEVEL (dir === root) so a legitimately-nested store folder
// that happens to be named "backups"/"geoip" is not silently dropped.
const EXCLUDE_TOP_LEVEL = new Set(["backups", "geoip"]);
//  - .health-probe : the transient file the health route writes then unlinks;
//                    excluded at any depth (it only ever lives at the root today).
const EXCLUDE_ANY = new Set([".health-probe"]);

/** Walk `root` yielding one BundledFile at a time, applying the exclusions. */
export async function* walkBundleFiles(
  root: string,
  dir: string = root,
): AsyncGenerator<BundledFile> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // dir doesn't exist yet — nothing written, empty backup
  }
  for (const e of entries) {
    if (EXCLUDE_ANY.has(e.name)) continue;
    if (dir === root && EXCLUDE_TOP_LEVEL.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkBundleFiles(root, full);
    } else if (e.isFile()) {
      const buf = await readFile(full);
      const isText = TEXT_EXT.test(e.name);
      yield {
        path: path.relative(root, full),
        encoding: isText ? "utf8" : "base64",
        content: isText ? buf.toString("utf8") : buf.toString("base64"),
      };
    }
  }
}

/** Non-streaming convenience (tests, tooling): the full file list in memory. */
export async function collectBundleFiles(root: string): Promise<BundledFile[]> {
  const out: BundledFile[] = [];
  for await (const f of walkBundleFiles(root)) out.push(f);
  return out;
}

/**
 * The full bundle document as an async stream of string chunks. Yields the JSON
 * envelope with `files` streamed one entry at a time and `db` (already
 * serialized, small) emitted last. RETURNS the file count so the route can
 * record the last-success marker only when generation actually completed — a
 * client that disconnects mid-stream never reaches the return, so a partial
 * download is never counted a success.
 */
export async function* streamBundleDocument(
  root: string,
  opts: { createdAt: string; dbSection: unknown },
): AsyncGenerator<string, number> {
  yield `{\n "app": "explore-kingston",\n "version": 2,\n`;
  yield ` "createdAt": ${JSON.stringify(opts.createdAt)},\n`;
  yield ` "dataDir": ${JSON.stringify(root)},\n`;
  yield ` "files": [`;
  let fileCount = 0;
  for await (const file of walkBundleFiles(root)) {
    yield fileCount === 0 ? "\n  " : ",\n  ";
    yield `{"path":${JSON.stringify(file.path)},"encoding":${JSON.stringify(file.encoding)},"content":`;
    if (file.encoding === "base64") {
      // base64 is JSON-safe — emit raw between quotes, no second copy of the
      // (large) content string.
      yield '"';
      yield file.content;
      yield '"';
    } else {
      yield JSON.stringify(file.content); // small text files: escape normally
    }
    yield `}`;
    fileCount++;
  }
  yield `\n ],\n`;
  yield ` "fileCount": ${fileCount},\n`;
  yield ` "db": ${JSON.stringify(opts.dbSection)}\n}`;
  return fileCount;
}
