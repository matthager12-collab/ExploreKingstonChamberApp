// Regenerate the street-name abbreviation table the basemap style ships.
//
//   npm run tiles:abbrevs                      # derive from the checked-in fixture
//   npm run tiles:abbrevs -- --from <path>     # derive from another archive
//   npm run tiles:abbrevs -- --live <base-url> # re-download the SERVED archive
//                                              # to the fixture, then derive
//
// Reads every label-eligible road name out of the PMTiles archive, applies the
// mechanical USPS rules (src/lib/map/street-abbrev.ts), and writes the entries
// that actually change to src/lib/map/street-abbrevs.json — basemap.ts folds
// that table into the label layers' ["match"] expression.
//
// The fixture at tests/fixtures/tiles/kingston.pmtiles must BE the archive the
// app serves (it is a byte copy of the R2 object behind /api/map/tiles): the
// drift-guard test derives the table from the fixture, so table + fixture +
// served tiles move together. After a quarterly tile rebuild
// (scripts/build-tiles.mjs, docs/OPERATIONS.md §7) rerun:
//
//   npm run tiles:abbrevs -- --live https://<prod-host>
//
// and commit the refreshed fixture + table in the same PR.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { abbreviateStreetName } from "../src/lib/map/street-abbrev";
import { TILES_PMTILES_PATH } from "../src/lib/map/basemap";
import { extractLabeledRoadNames } from "./lib/extract-road-names";

const FIXTURE = join(process.cwd(), "tests/fixtures/tiles/kingston.pmtiles");
const TABLE = join(process.cwd(), "src/lib/map/street-abbrevs.json");

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main(): Promise<void> {
  let source = flag("--from") ?? FIXTURE;

  const liveBase = flag("--live");
  if (liveBase) {
    const url = liveBase.replace(/\/+$/, "") + TILES_PMTILES_PATH;
    console.log(`[tiles:abbrevs] downloading served archive: ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    await writeFile(FIXTURE, Buffer.from(await res.arrayBuffer()));
    console.log(`[tiles:abbrevs] refreshed fixture ${FIXTURE}`);
    source = FIXTURE;
  }

  const names = await extractLabeledRoadNames(source);
  const table: Record<string, string> = {};
  for (const name of names) {
    const abbr = abbreviateStreetName(name);
    if (abbr !== name) table[name] = abbr;
  }

  await writeFile(TABLE, JSON.stringify(table, null, 2) + "\n");
  console.log(
    `[tiles:abbrevs] ${names.length} label-eligible road names in ${source}`,
  );
  console.log(
    `[tiles:abbrevs] wrote ${Object.keys(table).length} abbreviated entries to ${TABLE}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
