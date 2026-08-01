// E17 importer CLI: re-runnable load of the Qwick kiosk listings into the
// directory domain, with a dry-run diff, the dedupe/claim-precedence policy,
// and a quarantine workflow.
//
//   npm run import:qwick -- [--dry-run|--apply] [--yes]
//                           [--fixture <file>] [--archive-images <dir>]
//
// All semantics live in src/lib/import/qwick.ts (shared with the vitest
// qwick suites); this wrapper owns argv, the interactive host confirmation,
// and exit codes (import-data-dir conventions):
//   0 = clean · 1 = halt (bad usage / unreadable fixture / DB error /
//   aborted / dead endpoint) · 2 = completed with quarantined rows
//
// --fixture reads a saved export (raw GraphQL envelope or a bare rows array)
// instead of the network. As of 2026-08-01 the vendor endpoint is DEAD
// (node.qwickmedia.com no longer resolves), so --fixture is the operative
// path; the network path remains for the case the service resurrects.
//
// Runs under tsx with NODE_OPTIONS=--conditions=react-server so the data
// layer's `server-only` guard resolves to its empty react-server build.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  applyQwickPlan,
  fetchQwickListings,
  IMPORT_PRINCIPAL,
  persistDryRun,
  planQwickImport,
  planStats,
  readAliases,
  readLocalRecords,
  rowsFromExport,
  type QwickPlan,
} from "../src/lib/import/qwick";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

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
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must be set (the import target).");
    return 1;
  }
  const apply = flag("--apply"); // --dry-run is the default
  const fixture = opt("--fixture");
  const archiveDir = opt("--archive-images");

  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL!).host;
    } catch {
      return "<unparseable DATABASE_URL>";
    }
  })();

  let rows: unknown[];
  if (fixture) {
    let text: string;
    try {
      text = await readFile(fixture, "utf8");
    } catch {
      console.error(`HALT: cannot read fixture file ${fixture}`);
      return 1;
    }
    rows = rowsFromExport(JSON.parse(text));
    console.log(`${rows.length} upstream row(s) from fixture ${fixture}`);
  } else {
    try {
      rows = await fetchQwickListings();
      console.log(`${rows.length} upstream row(s) from the live GraphQL read`);
    } catch (e) {
      console.error(
        "HALT: the live Qwick read failed (the endpoint has been dead since 2026-08-01).",
      );
      console.error("      Use --fixture <saved-export.json> instead.");
      console.error(`      (${e instanceof Error ? e.message : e})`);
      return 1;
    }
  }

  const [local, aliases] = await Promise.all([readLocalRecords(), readAliases()]);
  const plan = planQwickImport(rows, local, aliases);
  printPlan(plan);
  const quarantines = plan.quarantined.length;

  if (archiveDir) {
    await archiveImages(rows, archiveDir);
  }

  if (!apply) {
    const { runId } = await persistDryRun(plan, IMPORT_PRINCIPAL);
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

  const { runId } = await applyQwickPlan(plan);
  console.log(`applied — import_run ${runId}.`);
  return quarantines ? 2 : 0;
}

/** Decommission escape hatch: save each row's logo/listingImage to a local
 *  directory (network; never CI). Failures are listed, never fatal — with
 *  the vendor dead, whatever still downloads is worth keeping. */
async function archiveImages(rows: unknown[], dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  let saved = 0;
  let failed = 0;
  for (const raw of rows) {
    const row = raw as { id?: unknown; logo?: unknown; listingImage?: unknown };
    for (const key of ["logo", "listingImage"] as const) {
      const url = row[key];
      if (typeof url !== "string" || !/^https?:\/\//.test(url)) continue;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ext = new URL(url).pathname.split(".").pop()?.slice(0, 5) || "img";
        const name = `${String(row.id ?? "row")}-${key}.${ext}`.replace(/[^\w.-]/g, "_");
        await writeFile(join(dir, name), Buffer.from(await res.arrayBuffer()));
        saved += 1;
      } catch {
        failed += 1;
        console.error(`  archive failed: ${url}`);
      }
    }
  }
  console.log(`archived ${saved} image(s) to ${dir}${failed ? `, ${failed} failed` : ""}`);
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("HALT:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
