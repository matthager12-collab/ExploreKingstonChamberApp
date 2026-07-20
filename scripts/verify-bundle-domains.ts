// verify-bundle-domains.ts — the docs/SCHEMAS.md "Wiring the importer" gate.
//
// Runs every record of the four baseline domains (restaurants, lodging,
// webcams, itineraries) found in a backup bundle through the strict
// DOMAIN_SCHEMAS, and reports what a STORE_SCHEMAS strict-swap would
// quarantine. Read-only; exits 1 if any record fails.
//
// Usage:
//   npx tsx scripts/verify-bundle-domains.ts <bundle.json> [more-bundles...]
//   npx tsx scripts/verify-bundle-domains.ts --seeds        # git-seed self-check
//   npx tsx scripts/verify-bundle-domains.ts --self-test    # prove failures are caught
//
// Accepts v1 bundles (files walk only) and v2 bundles (files + db section):
// v1 records come from stores/<domain>.json overlay files; v2 additionally
// checks db.record rows for the four stores (doc column, tombstones skipped —
// the choke point validates tombstones as { id } only).

import { readFileSync } from "node:fs";
import { DOMAIN_SCHEMAS, firstZodMessage } from "../src/lib/schemas";

const DOMAINS = Object.keys(DOMAIN_SCHEMAS) as (keyof typeof DOMAIN_SCHEMAS)[];

type Failure = { domain: string; id: string; message: string };

function validate(domain: keyof typeof DOMAIN_SCHEMAS, records: unknown[], failures: Failure[]): number {
  for (const record of records) {
    const result = DOMAIN_SCHEMAS[domain].safeParse(record);
    if (!result.success) {
      const id = (record as { id?: unknown })?.id;
      failures.push({
        domain,
        id: typeof id === "string" ? id : "(no id)",
        message: firstZodMessage(result.error),
      });
    }
  }
  return records.length;
}

function checkBundle(path: string): boolean {
  const bundle = JSON.parse(readFileSync(path, "utf8"));
  const failures: Failure[] = [];
  console.log(`\n=== ${path} (bundle version ${bundle.version ?? "?"}) ===`);

  for (const domain of DOMAINS) {
    let n = 0;
    const file = (bundle.files ?? []).find(
      (f: { path: string }) => f.path === `stores/${domain}.json`,
    );
    if (file) {
      const raw = file.encoding === "base64"
        ? Buffer.from(file.content, "base64").toString("utf8")
        : file.content;
      n += validate(domain, JSON.parse(raw), failures);
    }
    // v2 bundles: db.records is keyed by store name; each row carries the
    // domain document in `doc`. Tombstoned rows are skipped — the choke point
    // validates tombstones as { id } only.
    const dbRows = (bundle.db?.records?.[domain] ?? []).filter(
      (r: { deleted?: boolean }) => !r.deleted,
    );
    n += validate(domain, dbRows.map((r: { doc: unknown }) => r.doc), failures);
    console.log(`  ${domain}: ${n} record(s) checked${file || dbRows.length ? "" : " (none in bundle)"}`);
  }

  if (failures.length) {
    console.error(`  FAILURES (${failures.length}) — these would quarantine under a strict swap:`);
    for (const f of failures) console.error(`    ${f.domain}/${f.id}: ${f.message}`);
    return false;
  }
  console.log("  CLEAN — nothing would quarantine.");
  return true;
}

async function checkSeeds(): Promise<boolean> {
  const { restaurants } = await import("../src/lib/data/restaurants");
  const { lodging } = await import("../src/lib/data/lodging");
  const { webcams } = await import("../src/lib/data/webcams");
  const { itineraries } = await import("../src/lib/data/itineraries");
  const seedSets = { restaurants, lodging, webcams, itineraries } as const;
  const failures: Failure[] = [];
  console.log("\n=== git seeds (src/lib/data) ===");
  for (const domain of DOMAINS) {
    const n = validate(domain, seedSets[domain], failures);
    console.log(`  ${domain}: ${n} record(s) checked`);
  }
  if (failures.length) {
    for (const f of failures) console.error(`    ${f.domain}/${f.id}: ${f.message}`);
    return false;
  }
  console.log("  CLEAN — nothing would quarantine.");
  return true;
}

async function selfTest(): Promise<boolean> {
  // A record the baseline schema accepts but the strict schema must reject —
  // proves this harness actually detects, rather than vacuously passing.
  const failures: Failure[] = [];
  validate("restaurants", [{ id: "self-test", name: "x", lat: 999 }], failures);
  const caught = failures.length === 1;
  console.log(`\n=== self-test === ${caught ? "PASS (bad record was caught)" : "FAIL (bad record slipped through)"}`);
  return caught;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error("usage: npx tsx scripts/verify-bundle-domains.ts [--seeds] [--self-test] <bundle.json>...");
    process.exit(2);
  }
  let ok = true;
  if (args.includes("--self-test")) ok = (await selfTest()) && ok;
  if (args.includes("--seeds")) ok = (await checkSeeds()) && ok;
  for (const path of args.filter((a) => !a.startsWith("--"))) ok = checkBundle(path) && ok;
  process.exit(ok ? 0 : 1);
}

void main();
