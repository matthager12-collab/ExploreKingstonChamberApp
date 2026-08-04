#!/usr/bin/env node
// Permanently DELETE analytics events older than a cutoff — the destructive
// counterpart to the analytics baseline.
//
//   node scripts/purge-analytics.mjs --before 2026-08-04            # dry run
//   node scripts/purge-analytics.mjs --before 2026-08-04 --confirm  # deletes
//   node scripts/purge-analytics.mjs --before 2026-08-04 --internal-only --confirm
//
// Reads DATABASE_URL from the environment, or from a file named by --env-file
// (e.g. --env-file .env.production.local). Nothing happens without --confirm:
// the default is a dry run that prints exactly what WOULD go.
//
// WHY THIS IS A SCRIPT AND NOT A BUTTON. Reversibility is the whole design of
// the analytics baseline (src/lib/stores/analytics-baseline-store.ts): it hides
// events instead of deleting them, so a mistake at 9pm the night before a
// launch costs nothing. That property only holds while the raw rows exist. A
// delete is the one operation that cannot be taken back, so it lives out here
// where it requires a terminal, a database URL, and a typed flag — three things
// nobody does by accident from a dashboard.
//
// Reach for it when the pre-launch junk stops being worth its storage, or when
// the Chamber would rather not hold data it has no use for. Prefer
// --internal-only where it fits: it clears OUR traffic (the rows nobody will
// ever report on) while leaving real visitor history intact.
//
// Deleting analytics events is privacy-positive and is not gated by the E11
// retention manifest, which sets MAXIMUM lifetimes, not minimums. It does not
// touch analytics_area_rollup (already-anonymized monthly aggregates), survey
// responses, or ferry observations.

import { readFileSync } from "node:fs";
import pg from "pg";

const args = process.argv.slice(2);

function flag(name) {
  return args.includes(`--${name}`);
}
function value(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

const before = value("before");
const confirm = flag("confirm");
const internalOnly = flag("internal-only");
const envFile = value("env-file");

if (!before) {
  console.error(
    [
      "usage: node scripts/purge-analytics.mjs --before <YYYY-MM-DD|ISO> [options]",
      "",
      "  --confirm            actually delete (default is a dry run)",
      "  --internal-only      delete only events marked source='internal'",
      "  --env-file <path>    read DATABASE_URL from this file",
    ].join("\n"),
  );
  process.exit(1);
}

const cutoff = new Date(before);
if (Number.isNaN(cutoff.getTime())) die(`could not parse --before "${before}" as a date`);
if (cutoff.getTime() > Date.now()) die("--before is in the future; refusing to purge everything");

let url = process.env.DATABASE_URL;
if (envFile) {
  const line = readFileSync(envFile, "utf8")
    .split("\n")
    .find((l) => l.startsWith("DATABASE_URL="));
  if (!line) die(`no DATABASE_URL in ${envFile}`);
  url = line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}
if (!url) die("DATABASE_URL is not set (pass --env-file or export it)");

// The source filter, shared verbatim between the count and the delete so the
// dry run cannot describe a different set of rows than the one that goes.
const sourceClause = internalOnly ? `AND event->>'source' = 'internal'` : "";

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  const { rows: [before_] } = await client.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE ts < $1::timestamptz ${sourceClause})::int AS doomed,
            min(ts)::date AS first_day,
            max(ts)::date AS last_day
       FROM analytics_event`,
    [cutoff.toISOString()],
  );

  console.log(`analytics_event: ${before_.total} rows (${before_.first_day} … ${before_.last_day})`);
  console.log(
    `matching --before ${cutoff.toISOString()}${internalOnly ? " and source=internal" : ""}: ${before_.doomed}`,
  );

  if (before_.doomed === 0) {
    console.log("nothing to delete.");
  } else if (!confirm) {
    console.log(`\nDRY RUN — nothing deleted. Re-run with --confirm to delete ${before_.doomed} rows.`);
  } else {
    const res = await client.query(
      `DELETE FROM analytics_event WHERE ts < $1::timestamptz ${sourceClause}`,
      [cutoff.toISOString()],
    );
    console.log(`\nDELETED ${res.rowCount} rows.`);
    const { rows: [after] } = await client.query(
      `SELECT count(*)::int AS total, min(ts)::date AS first_day FROM analytics_event`,
    );
    console.log(`analytics_event now: ${after.total} rows (from ${after.first_day ?? "—"})`);
  }
} finally {
  await client.end();
}
