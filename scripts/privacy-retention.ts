// E11 retention purge CLI — operator-side runner over the same
// src/lib/privacy/retention.ts core the /api/admin/privacy/retention route
// executes (one implementation, two entry points).
//
//   npm run privacy:retention                  (dry-run: prints the plan, deletes NOTHING)
//   npm run privacy:retention -- --apply       (execute; staging first, always — plan §4-e)
//
// One planned-action line per RETENTION_POLICY entry, including the
// hardcoded refusal for the audit table (never purged — the records floor).
// Legal-holds are skipped with a logged reconciliation, never silently.
//
// Runs under tsx with NODE_OPTIONS=--conditions=react-server so the data
// layer's `server-only` guard resolves to its empty react-server build.

import { runRetention } from "../src/lib/privacy/retention";

const apply = process.argv.includes("--apply");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set (the retention target).");
  process.exit(1);
}

const host = (() => {
  try {
    return new URL(process.env.DATABASE_URL!).host;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
})();

runRetention({ apply }).then(
  (report) => {
    console.log(`privacy-retention ${report.mode} against ${host} at ${report.ranAt}`);
    for (const line of report.lines) {
      const held = line.heldSkipped ? `  [held: ${line.heldSkipped}]` : "";
      console.log(`  ${line.store.padEnd(28)} ${line.action.padEnd(22)} ${line.note}${held}`);
    }
    if (!apply) console.log("dry-run: nothing was deleted. Re-run with --apply to execute.");
    process.exit(0);
  },
  (err) => {
    console.error("privacy-retention failed:", err);
    process.exit(1);
  },
);
