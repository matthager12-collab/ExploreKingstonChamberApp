// GrowthZone roster importer CLI: re-runnable load of a GrowthZone member
// CSV export into the directory domain, with a dry-run diff, the shared
// dedupe/claim-precedence policy, and a preflight report that makes an
// unexpected export a --map flag away from working.
//
//   npm run import:growthzone -- --file roster.csv
//                                [--dry-run|--apply] [--yes]
//                                [--preflight-only]
//                                [--include-status active,courtesy]
//                                [--map field="Header Name"]...
//                                [--contacts-out contacts.csv]
//                                [--report-out report.json]
//                                [--claim-contacts]
//
// --claim-contacts (with --apply) additionally loads (listing, email) pairs
// into the claim_contact table so the self-serve claim flow can auto-approve
// roster matches (E17 claim-signup slice — a deliberate, Mat-approved
// exception to the PII-stays-in-the-CSV rule below; emails only, never
// levels/reps).
//
// All semantics live in src/lib/import/growthzone.ts (shared with the vitest
// suite); this wrapper owns argv, the interactive host confirmation, and
// exit codes (import-qwick conventions):
//   0 = clean · 1 = halt (bad usage / unreadable file / DB error / aborted)
//   · 2 = completed with quarantined rows
//
// --preflight-only parses the CSV and prints the column/status/category
// report WITHOUT touching any database — the first thing to run against a
// fresh export (DATABASE_URL not required).
//
// --contacts-out writes the operator-side join file (listing id ↔ email/
// level/rep) for the invite mail-merge. Member PII deliberately lands in
// this FILE, never in the app database.
//
// Runs under tsx with NODE_OPTIONS=--conditions=react-server so the data
// layer's `server-only` guard resolves to its empty react-server build.

import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

import { upsertClaimContacts } from "../src/lib/db/claim-store";
import {
  applyGrowthZonePlan,
  buildClaimContactRows,
  buildContactsCsv,
  DEFAULT_INCLUDE_STATUSES,
  GROWTHZONE_PRINCIPAL,
  GROWTHZONE_SOURCE,
  persistGrowthZoneDryRun,
  planGrowthZoneImport,
  rosterFromCsv,
  GZ_FIELDS,
  type ColumnMapping,
  type GzField,
  type GzPreflight,
  type GzRoster,
} from "../src/lib/import/growthzone";
import { planStats, readAliases, readLocalRecords, type QwickPlan } from "../src/lib/import/qwick";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const optAll = (name: string) => {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name && args[i + 1] !== undefined) out.push(args[i + 1]);
  }
  return out;
};

function parseMapFlags(values: string[]): { overrides: ColumnMapping; errors: string[] } {
  const overrides: ColumnMapping = {};
  const errors: string[] = [];
  for (const value of values) {
    const eq = value.indexOf("=");
    const field = eq >= 0 ? value.slice(0, eq).trim() : "";
    const header = eq >= 0 ? value.slice(eq + 1).trim() : "";
    if (!field || !header || !(GZ_FIELDS as readonly string[]).includes(field)) {
      errors.push(
        `--map expects field="Header Name" with field one of: ${GZ_FIELDS.join(", ")} (got "${value}")`,
      );
      continue;
    }
    overrides[field as GzField] = header;
  }
  return { overrides, errors };
}

function printPreflight(preflight: GzPreflight): void {
  console.log("— preflight —");
  console.log(`rows: ${preflight.totalRows} in file, ${preflight.includedRows} pass the status filter`);
  console.log("column mapping:");
  for (const field of GZ_FIELDS) {
    const header = preflight.mapping[field];
    console.log(`  ${field.padEnd(11)} ${header === undefined ? "(not found)" : `← "${header}"`}`);
  }
  if (preflight.badOverrides.length) {
    console.log(`  BAD --map (header not in file): ${preflight.badOverrides.join("; ")}`);
  }
  if (preflight.unmappedHeaders.length) {
    console.log(`ignored columns: ${preflight.unmappedHeaders.join(", ")}`);
  }
  const statuses = Object.entries(preflight.statusCounts).sort((a, b) => b[1] - a[1]);
  if (statuses.length) {
    console.log(
      `statuses seen: ${statuses.map(([status, count]) => `${status}=${count}`).join(", ")}`,
    );
  }
  if (preflight.statusColumnMissing) {
    console.log("WARNING: no status column found — NOTHING was filtered out.");
  }
  if (preflight.externalIdFallback) {
    console.log(
      "WARNING: no member-id column found — external ids fall back to name keys " +
        "(renames will read as delete+create on future re-runs). Prefer an export " +
        "that includes the member id.",
    );
  }
  const misses = Object.entries(preflight.unmappedCategories).sort((a, b) => b[1] - a[1]);
  if (misses.length) {
    console.log(
      `unmapped categories (land as 'other'; extend src/lib/import/gz-category-map.ts): ` +
        misses.map(([cat, count]) => `${cat}=${count}`).join(", "),
    );
  }
  if (preflight.rowsMissingName) {
    console.log(`rows with no name (will quarantine): ${preflight.rowsMissingName}`);
  }
}

function printPlan(plan: QwickPlan): void {
  const stats = planStats(plan);
  console.log(
    `plan: created=${stats.created} updated=${stats.updated} unchanged=${stats.unchanged} ` +
      `matched=${stats.matched} quarantined=${stats.quarantined} deletedUpstream=${stats.deletedUpstream}`,
  );
  for (const c of plan.created) console.log(`  create  directory/${c.record.id}  «${c.record.name}»`);
  for (const u of plan.updated) {
    console.log(`  update  ${u.store}/${u.id}  (${u.diffs.map((d) => d.field).join(", ")})`);
  }
  for (const m of plan.matched) {
    const diffNote = m.diffs.length
      ? `  diffs to hand-verify: ${m.diffs.map((d) => d.field).join(", ")}`
      : "";
    console.log(`  match   ${m.store}/${m.id}  «${m.name}» (local wins)${diffNote}`);
  }
  for (const q of plan.quarantined) {
    console.log(`  QUARANTINE  ${q.name ?? q.externalId ?? "(unidentified row)"} — ${q.reason}`);
  }
  for (const d of plan.deletedUpstream) {
    console.log(`  gone-upstream  ${d.store}/${d.id} (report only — nothing deleted)`);
  }
}

async function main(): Promise<number> {
  const file = opt("--file");
  if (!file) {
    console.error("HALT: --file <roster.csv> is required (a GrowthZone member CSV export).");
    return 1;
  }
  const apply = flag("--apply"); // --dry-run is the default
  const preflightOnly = flag("--preflight-only");
  const contactsOut = opt("--contacts-out");
  const reportOut = opt("--report-out");
  const includeStatuses = (opt("--include-status") ?? DEFAULT_INCLUDE_STATUSES.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const { overrides, errors } = parseMapFlags(optAll("--map"));
  if (errors.length) {
    for (const e of errors) console.error(`HALT: ${e}`);
    return 1;
  }

  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    console.error(`HALT: cannot read ${file}`);
    return 1;
  }

  let roster: GzRoster;
  try {
    roster = rosterFromCsv(text, { overrides, includeStatuses });
  } catch (e) {
    console.error(`HALT: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  printPreflight(roster.preflight);
  if (roster.preflight.badOverrides.length) {
    console.error("HALT: fix the --map flags above (header not present in the file).");
    return 1;
  }

  if (preflightOnly) {
    console.log("preflight only — no database touched.");
    return 0;
  }

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must be set (the import target).");
    return 1;
  }
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL!).host;
    } catch {
      return "<unparseable DATABASE_URL>";
    }
  })();

  const [local, aliases] = await Promise.all([
    readLocalRecords(),
    readAliases(GROWTHZONE_SOURCE),
  ]);
  const plan = planGrowthZoneImport(roster, local, aliases);
  printPlan(plan);
  const quarantines = plan.quarantined.length;

  if (contactsOut) {
    await writeFile(contactsOut, buildContactsCsv(plan, roster));
    console.log(`contacts join file written to ${contactsOut} (PII stays out of the DB).`);
  }
  if (reportOut) {
    await writeFile(
      reportOut,
      JSON.stringify({ preflight: roster.preflight, plan }, null, 2) + "\n",
    );
    console.log(`full report written to ${reportOut}.`);
  }

  if (!apply) {
    const { runId } = await persistGrowthZoneDryRun(plan, GROWTHZONE_PRINCIPAL);
    console.log(`dry run recorded as import_run ${runId} — nothing written.`);
    return quarantines ? 2 : 0;
  }

  const stats = planStats(plan);
  const summary = `create ${stats.created}, update ${stats.updated}, alias ${stats.matched}`;
  if (!flag("--yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `About to WRITE to ${host} (${summary}). Type the host to confirm: `,
    );
    rl.close();
    if (answer.trim() !== host) {
      console.error("aborted — host mismatch.");
      return 1;
    }
  } else {
    console.log(`Writing to ${host} (${summary}) — confirmed via --yes.`);
  }

  const { runId } = await applyGrowthZonePlan(plan);
  console.log(`applied — import_run ${runId}.`);

  // E17 claim-signup slice, opt-in: load (listing, email) pairs so the
  // self-serve claim flow can auto-approve roster matches. Idempotent upsert;
  // levels/reps still land only in the --contacts-out CSV.
  if (flag("--claim-contacts")) {
    const rows = buildClaimContactRows(plan, roster);
    const inserted = await upsertClaimContacts(
      rows.map((r) => ({
        ...r,
        source: GROWTHZONE_PRINCIPAL,
        createdBy: GROWTHZONE_PRINCIPAL,
      })),
    );
    console.log(
      `claim contacts: ${rows.length} (listing, email) pairs in the roster, ${inserted} new rows written.`,
    );
  }
  return quarantines ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("HALT:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
