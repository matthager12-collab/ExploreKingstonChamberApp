// E05 export CLI: serialize the entire Postgres substrate (record/audit/
// quarantine + append-only logs) to a pretty-printed JSON bundle.
//
//   npm run export:json -- <out.json>          (default: export.json)
//
// DB-only twin of the /api/admin/backup route: no disk-file walk (photos and
// maps are the route's job) — this is the operator-side path for pulling the
// database when the app isn't reachable. Restore with `npm run restore:db`.
// The bundle contains password hashes (auth-users record rows) — treat the
// output file as sensitive.
//
// Runs under tsx with NODE_OPTIONS=--conditions=react-server so the data
// layer's `server-only` guard resolves to its empty react-server build.

import { writeFile } from "node:fs/promises";

import { serializeDb } from "../src/lib/db/export";

const args = process.argv.slice(2);
const outPath = args.find((a) => !a.startsWith("--")) ?? "export.json";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set (the export source).");
  process.exit(1);
}

const host = (() => {
  try {
    return new URL(process.env.DATABASE_URL!).host;
  } catch {
    return "<unparseable DATABASE_URL>";
  }
})();

async function main(): Promise<void> {
  const db = await serializeDb();
  const bundle = {
    app: "explore-kingston",
    version: 2,
    createdAt: new Date().toISOString(),
    db,
  };
  // Pretty-printed (indent 1) per M-20-07: bundles must stay human-readable.
  await writeFile(outPath, JSON.stringify(bundle, null, 1));

  const recordCount = Object.values(db.records).reduce((n, rows) => n + rows.length, 0);
  console.log(`export-json: source ${host} → ${outPath}`);
  console.log("");
  console.log("table               rows");
  console.log(`record            ${String(recordCount).padStart(6)}  (${Object.keys(db.records).length} store(s))`);
  console.log(`audit             ${String(db.audit.length).padStart(6)}`);
  console.log(`quarantine        ${String(db.quarantine.length).padStart(6)}`);
  console.log(`analytics_event   ${String(db.analytics_event.length).padStart(6)}`);
  console.log(`survey_response   ${String(db.survey_response.length).padStart(6)}`);
  console.log(`ferry_observation ${String(db.ferry_observation.length).padStart(6)}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("HALT:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
