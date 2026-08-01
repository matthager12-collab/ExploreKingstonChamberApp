import { join } from "node:path";

import { describe, expect, it } from "vitest";

import checkedInTable from "@/lib/map/street-abbrevs.json";
import { abbreviateStreetName } from "@/lib/map/street-abbrev";
import { extractLabeledRoadNames } from "../../../scripts/lib/extract-road-names";

// DRIFT GUARD for the street-abbreviation table (owner request 2026-08-01).
//
// The basemap style ships a generated full->abbreviated ["match"] table
// (src/lib/map/street-abbrevs.json) derived from the road names in the served
// PMTiles archive. The fixture below is a byte copy of that served archive —
// refreshing one without regenerating the other silently strands new streets
// on their unabbreviated fallback. This suite re-derives the table from the
// fixture and fails the moment they disagree; the fix is always:
//
//   npm run tiles:abbrevs            (fixture -> table)
//   npm run tiles:abbrevs -- --live https://<prod-host>   (after tile rebuilds)
const FIXTURE = join(process.cwd(), "tests/fixtures/tiles/kingston.pmtiles");

describe("street-abbrevs.json stays in lockstep with the tiles fixture", () => {
  it("re-derives byte-identically from the fixture (else: npm run tiles:abbrevs)", async () => {
    const names = await extractLabeledRoadNames(FIXTURE);
    const derived: Record<string, string> = {};
    for (const name of names) {
      const abbr = abbreviateStreetName(name);
      if (abbr !== name) derived[name] = abbr;
    }
    expect(checkedInTable).toEqual(derived);
  });

  it("extraction is non-vacuous and kind-filtered", async () => {
    const names = await extractLabeledRoadNames(FIXTURE);
    // A broken decoder returning [] would make the lockstep test pass vacuously.
    expect(names.length).toBeGreaterThan(400);
    expect(names).toContain("Northeast State Highway 104");
    expect(names).toContain("Northeast West Kingston Road");
    // ferry/rail kinds are never label-eligible, so their names must never
    // reach the table pipeline (they'd float over water if they did).
    expect(names).not.toContain("Edmonds - Kingston Ferry");
    expect(names).not.toContain("BNSF Scenic Subdivision");
  });

  it("every table entry is mechanically derived — no hand-edited nicknames can hide here", () => {
    const entries = Object.entries(checkedInTable as Record<string, string>);
    expect(entries.length).toBeGreaterThan(400);
    for (const [full, abbr] of entries) {
      expect(abbr, `entry for "${full}"`).toBe(abbreviateStreetName(full));
      expect(abbr, `entry for "${full}" must differ from its key`).not.toBe(full);
    }
    // Sorted keys keep regeneration diffs reviewable.
    const keys = entries.map(([k]) => k);
    expect(keys).toEqual([...keys].sort());
  });

  it("abbreviation is idempotent over every real road name in the archive", async () => {
    for (const name of await extractLabeledRoadNames(FIXTURE)) {
      const once = abbreviateStreetName(name);
      expect(abbreviateStreetName(once), `"${name}"`).toBe(once);
    }
  });
});
