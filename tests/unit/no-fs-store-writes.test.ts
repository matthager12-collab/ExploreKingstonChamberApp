// Static guard (E05 Never tier): after the Postgres cutover, no src/ code
// may touch the retired DATA_DIR file stores again. Grep-like by design —
// it scans every non-test .ts/.tsx under src/ and fails on:
//   1. dataPath("stores"...) or dataPath("auth"...) — store/auth JSON lives
//      in the `record` table now; nothing should even build those paths.
//   2. writeFile/appendFile calls that reference the retired log/store files
//      (events.jsonl, ltac-responses.jsonl, observations.jsonl,
//      submissions.jsonl, custom-hunts.json) — those are Postgres append
//      tables / records now.
// Deliberately ALLOWED: photo/image writes (hunts refs & photos, map/images)
// and the health probe — binary assets stay on disk this epic.
// Comment lines are skipped so prose mentioning the old layout (e.g. the
// dataPath() JSDoc example in src/lib/data-dir.ts) doesn't trip the guard.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("../../src", import.meta.url));

const DATA_PATH_STORES_RE = /dataPath\(\s*["']stores["']/;
const DATA_PATH_AUTH_RE = /dataPath\(\s*["']auth["']/;
const FS_WRITE_RE = /\b(?:writeFile|appendFile)(?:Sync)?\s*\(/;
/** Files the importer now owns — any fs write mentioning one is a violation. */
const RETIRED_FILES = [
  "events.jsonl",
  "ltac-responses.jsonl",
  "observations.jsonl",
  "submissions.jsonl",
  "custom-hunts.json",
];
/** How many following (non-comment) lines to include when matching a
 *  writeFile/appendFile call whose arguments wrap onto the next lines. */
const CALL_WINDOW = 3;

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(p));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")) out.push(p);
  }
  return out;
}

function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*");
}

describe("no fs writes to retired DATA_DIR stores (static guard)", () => {
  it("src/ never builds stores//auth paths or fs-writes the retired json/jsonl files", () => {
    const violations: string[] = [];

    for (const file of tsFilesUnder(SRC_ROOT)) {
      const rel = path.relative(path.join(SRC_ROOT, ".."), file);
      // Keep line numbers, but blank out comment lines so prose about the
      // old layout can't trip the patterns.
      const lines = readFileSync(file, "utf8")
        .split("\n")
        .map((l) => (isCommentLine(l) ? "" : l));

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const at = `${rel}:${i + 1}`;

        if (DATA_PATH_STORES_RE.test(line)) {
          violations.push(
            `${at}: dataPath("stores", ...) — store JSON lives in the record table now: ${line.trim()}`,
          );
        }
        if (DATA_PATH_AUTH_RE.test(line)) {
          violations.push(
            `${at}: dataPath("auth", ...) — auth stores live in the record table now: ${line.trim()}`,
          );
        }
        if (FS_WRITE_RE.test(line)) {
          const window = lines.slice(i, i + 1 + CALL_WINDOW).join("\n");
          const hit = RETIRED_FILES.find((f) => window.includes(f));
          if (hit) {
            violations.push(
              `${at}: fs write referencing retired file '${hit}' — use the db append/record helpers: ${line.trim()}`,
            );
          }
        }
      }
    }

    expect(violations, `retired DATA_DIR write(s) found:\n${violations.join("\n")}`).toEqual([]);
  });
});
