// E05 restore CLI: load a backup bundle's `db` section back into Postgres.
//
//   npm run restore:db -- <bundle.json> [--force] [--yes]
//
// Accepts either bundle shape that carries a db section: the
// /api/admin/backup v2 download (which also has `files` — ignored here;
// restore those with scripts/restore-backup.mjs) or scripts/export-json.ts
// output. Rows go back VERBATIM through the data layer's restoreDb(): raw
// inserts, original statuses/sources/timestamps, audit ids preserved, no
// fresh audit rows. Refuses a non-empty target `record` table unless
// --force is passed (and even then, colliding keys fail the transaction —
// nothing is silently merged).
//
// Exit codes: 0 = restored · 1 = halt (bad usage / bad bundle / refusal /
// DB error / aborted confirmation).
//
// Runs under tsx with NODE_OPTIONS=--conditions=react-server so the data
// layer's `server-only` guard resolves to its empty react-server build.

import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

import { restoreDb, type DbSection } from "../src/lib/db/export";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);

const bundlePath = args.find((a) => !a.startsWith("--"));
if (!bundlePath) {
  console.error("Usage: npm run restore:db -- <bundle.json> [--force] [--yes]");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set (the restore target).");
  process.exit(1);
}

const host = (() => {
  try {
    return new URL(process.env.DATABASE_URL!).host;
  } catch {
    return "<unparseable DATABASE_URL>";
  }
})();

const SECTION_KEYS = [
  "records",
  "audit",
  "quarantine",
  "analytics_event",
  "survey_response",
  "ferry_observation",
] as const;

/** Pull the db section out of whichever bundle shape we were handed. */
function extractSection(parsed: unknown): DbSection {
  const bundle = parsed as Record<string, unknown> | null;
  const candidate = bundle && typeof bundle === "object" ? bundle.db : undefined;
  if (!candidate || typeof candidate !== "object") {
    throw new Error(
      `${bundlePath} has no "db" section — is this a v1 file-only bundle? ` +
        "(v1 bundles restore with scripts/restore-backup.mjs; the db section " +
        "ships in v2 bundles and export:json output.)",
    );
  }
  const section = candidate as Record<string, unknown>;
  for (const key of SECTION_KEYS) {
    const ok =
      key === "records"
        ? section[key] !== null && typeof section[key] === "object" && !Array.isArray(section[key])
        : Array.isArray(section[key]);
    if (!ok) throw new Error(`bundle db section is malformed: missing/invalid "${key}"`);
  }
  return candidate as DbSection;
}

async function main(): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(bundlePath!, "utf8");
  } catch (e) {
    throw new Error(`cannot read ${bundlePath}: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${bundlePath} is not valid JSON (${(e as Error).message})`);
  }
  const section = extractSection(parsed);

  const recordCount = Object.values(section.records).reduce((n, rows) => n + rows.length, 0);
  console.log(`restore-db: ${bundlePath} → target ${host}`);
  console.log("");
  console.log("table               source-rows");
  console.log(`record            ${String(recordCount).padStart(8)}  (${Object.keys(section.records).length} store(s))`);
  console.log(`audit             ${String(section.audit.length).padStart(8)}`);
  console.log(`quarantine        ${String(section.quarantine.length).padStart(8)}`);
  console.log(`analytics_event   ${String(section.analytics_event.length).padStart(8)}`);
  console.log(`survey_response   ${String(section.survey_response.length).padStart(8)}`);
  console.log(`ferry_observation ${String(section.ferry_observation.length).padStart(8)}`);
  console.log("");

  if (!flag("--yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `About to WRITE to ${host} (${recordCount} record row(s) + logs). Type the host to confirm: `,
    );
    rl.close();
    if (answer.trim() !== host) {
      console.log("Confirmation failed — aborting with no writes.");
      process.exit(1);
    }
  }

  const counts = await restoreDb(section, { force: flag("--force") });
  console.log(
    `Restored: record=${counts.record} audit=${counts.audit} quarantine=${counts.quarantine} ` +
      `analytics=${counts.analytics_event} survey=${counts.survey_response} ferry=${counts.ferry_observation}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("HALT:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
