// E05 importer CLI: one-time (re-runnable) load of a DATA_DIR-shaped tree
// into the Postgres substrate, with a dry-run diff and a quarantine workflow.
//
//   npm run import:data-dir -- --data-dir <dir> [--dry-run|--apply]
//                              [--force-append] [--yes]
//
// Successor to scripts/migrate-to-db.mjs (deleted this PR). All semantics
// live in import-core.ts (shared with the vitest `importer` suite); this
// wrapper owns argv, the interactive host confirmation, and exit codes:
//   0 = clean · 1 = halt (unparseable file / bad usage / DB error / aborted)
//   2 = completed with quarantined records or corrupt JSONL lines
// (the runbook gate: cutover proceeds only on exit 0, or with every
// quarantine individually acknowledged).
//
// Runs under tsx with NODE_OPTIONS=--conditions=react-server so the data
// layer's `server-only` guard resolves to its empty react-server build.

import { createInterface } from "node:readline/promises";

import { HaltError, runImport } from "./import-core";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const dataDir = opt("--data-dir");
if (!dataDir) {
  console.error(
    "Usage: npm run import:data-dir -- --data-dir <dir> [--dry-run|--apply] [--force-append] [--yes]",
  );
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set (the import target).");
  process.exit(1);
}

const host = (() => {
  try {
    return new URL(process.env.DATABASE_URL!).host;
  } catch {
    return "<unparseable DATABASE_URL>";
  }
})();

runImport({
  dataDir,
  apply: flag("--apply"), // --dry-run is the default
  forceAppend: flag("--force-append"),
  host,
  log: (line) => console.log(line),
  confirm: async (h, summary) => {
    if (flag("--yes")) return true;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `About to WRITE to ${h} (${summary}). Type the host to confirm: `,
    );
    rl.close();
    return answer.trim() === h;
  },
})
  .then((result) => {
    if (result.aborted) process.exit(1);
    process.exit(result.exitCode);
  })
  .catch((e) => {
    console.error("HALT:", e instanceof HaltError ? e.message : e);
    process.exit(1);
  });
