// E16 GrowthZone roster importer — CSV parser, column resolution, status
// filter, normalizer, the shared-planner bucket matrix, and the apply path
// against a real (PGlite) database: cross-importer precedence (Qwick-owned
// and admin records are local-wins), idempotency, draft invisibility, alias
// namespace isolation, upstream-deletion reporting, and the contacts join
// file. Everything runs on the checked-in fixture — CI never touches the
// network.

import { readFileSync } from "node:fs";
import { count } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { audit } from "@/lib/db/schema";
import { readRecordRows, writeRecord } from "@/lib/db/records";
import { restaurants as restaurantSeed } from "@/lib/data/restaurants";
import {
  applyGrowthZonePlan,
  buildContactsCsv,
  GROWTHZONE_PRINCIPAL,
  GROWTHZONE_SOURCE,
  gzExternalId,
  makeGrowthZoneNormalizer,
  normalizeHeader,
  parseCsv,
  planGrowthZoneImport,
  resolveColumns,
  rosterFromCsv,
  statusIncluded,
  type GzRoster,
} from "@/lib/import/growthzone";
import {
  planStats,
  readAliases,
  readLocalRecords,
  type LocalRecord,
  type QwickPlan,
} from "@/lib/import/qwick";
import { getDirectoryListings, getDirectoryListingsAdmin } from "@/lib/stores/directory-store";
import { createTestDb, type TestDb } from "../setup/pglite-db";

const FIXTURE = readFileSync("tests/fixtures/growthzone/roster.csv", "utf8");

const seedLocals: LocalRecord[] = restaurantSeed.map((r) => ({
  store: "restaurants",
  id: r.id,
  name: r.name,
  phone: r.phone,
  website: r.website,
  doc: r as unknown as Record<string, unknown>,
  governance: null,
}));

/* -------------------------------- CSV ---------------------------------- */

describe("parseCsv", () => {
  it("handles quoted commas, escaped quotes, embedded newlines, CRLF, and a BOM", () => {
    const text = '﻿a,b,c\r\n1,"x, y","he said ""hi"""\r\n2,"line1\nline2",plain\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["1", "x, y", 'he said "hi"'],
      ["2", "line1\nline2", "plain"],
    ]);
  });

  it("drops fully-empty trailing rows but keeps sparse ones", () => {
    expect(parseCsv("a,b\n1,\n\n,\n")).toEqual([
      ["a", "b"],
      ["1", ""],
    ]);
  });
});

/* --------------------------- column mapping ---------------------------- */

describe("resolveColumns", () => {
  it("resolves synonyms case/punctuation-insensitively and lists what it ignored", () => {
    const { mapping, unmappedHeaders } = resolveColumns([
      "Company Name",
      "MEMBERSHIP STATUS",
      "Web Site",
      "Zip/Postal Code",
      "Favorite Color",
    ]);
    expect(mapping.name).toBe("Company Name");
    expect(mapping.status).toBe("MEMBERSHIP STATUS");
    expect(mapping.website).toBe("Web Site");
    expect(mapping.zip).toBe("Zip/Postal Code");
    expect(unmappedHeaders).toEqual(["Favorite Color"]);
  });

  it("overrides win over synonyms; overrides naming absent headers are reported", () => {
    const { mapping, badOverrides } = resolveColumns(["Name", "Legal Name"], {
      name: "Legal Name",
      phone: "No Such Column",
    });
    expect(mapping.name).toBe("Legal Name");
    expect(badOverrides).toEqual(["phone=No Such Column"]);
  });

  it("normalizeHeader collapses punctuation and case", () => {
    expect(normalizeHeader("  Zip/Postal—Code ")).toBe("zip postal code");
  });
});

/* --------------------------- status filter ----------------------------- */

describe("statusIncluded", () => {
  it("prefix-matches include tokens; missing status column includes everything", () => {
    expect(statusIncluded("Active", ["active"])).toBe(true);
    expect(statusIncluded("Active - Courtesy", ["active"])).toBe(true);
    expect(statusIncluded("ACTIVE", ["active"])).toBe(true);
    expect(statusIncluded("Dropped", ["active"])).toBe(false);
    expect(statusIncluded("Courtesy", ["active", "courtesy"])).toBe(true);
    expect(statusIncluded(undefined, ["active"])).toBe(true);
  });
});

/* ----------------------------- normalizer ------------------------------ */

describe("makeGrowthZoneNormalizer", () => {
  const mapping = {
    externalId: "Member ID",
    name: "Member Name",
    phone: "Work Phone",
    website: "Website",
    address1: "Address 1",
    address2: "Address 2",
    city: "City",
    state: "State",
    zip: "Zip",
    categories: "Business Categories",
    description: "Description",
  } as const;
  const normalize = makeGrowthZoneNormalizer(mapping);

  it("assembles the address, canonicalizes the website, precomputes the category", () => {
    const result = normalize({
      "Member ID": "9001",
      "Member Name": "Harborside Widgets",
      "Work Phone": "1-360-555-0123",
      Website: "harborside.example.com",
      "Address 1": "1 Pier Way",
      "Address 2": "Suite 2",
      City: "Kingston",
      State: "WA",
      Zip: "98346",
      "Business Categories": "Retail; Gifts",
      Description: "<p>Widgets &amp; things</p>",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidate.externalId).toBe("gz-9001");
      expect(result.candidate.phoneDigits).toBe("3605550123");
      expect(result.candidate.website).toBe("https://harborside.example.com");
      expect(result.candidate.address).toBe("1 Pier Way, Suite 2, Kingston, WA 98346");
      expect(result.candidate.category).toBe("shop");
      expect(result.candidate.sourceCategories).toEqual(["Retail", "Gifts"]);
      expect(result.candidate.description).toBe("Widgets & things");
      expect(result.candidate.isPromoted).toBe(false);
    }
  });

  it("treats junk placeholders as absent and quarantines namelessness", () => {
    const junk = normalize({
      "Member ID": "9002",
      "Member Name": "Junk Fields",
      "Work Phone": "N/A",
      Website: "none",
    });
    expect(junk.ok).toBe(true);
    if (junk.ok) {
      expect(junk.candidate.phone).toBeUndefined();
      expect(junk.candidate.website).toBeUndefined();
    }
    const nameless = normalize({ "Member ID": "9003", "Member Name": "  " });
    expect(nameless.ok).toBe(false);
    if (!nameless.ok) expect(nameless.reason).toMatch(/no name/);
    expect(normalize("not an object").ok).toBe(false);
  });

  it("falls back to a stable name-derived external id without an id column", () => {
    const noId = { name: "Member Name" } as const;
    expect(gzExternalId({ "Member Name": "The Harbor Café" }, noId)).toBe("name:harbor cafe");
    expect(gzExternalId({ "Member Name": "" }, noId)).toBeUndefined();
  });
});

/* ------------------------------ preflight ------------------------------ */

describe("rosterFromCsv preflight (fixture)", () => {
  const roster = rosterFromCsv(FIXTURE);

  it("resolves the GrowthZone headers, filters by status, counts what it saw", () => {
    const p = roster.preflight;
    expect(p.mapping.name).toBe("Member Name");
    expect(p.mapping.externalId).toBe("Member ID");
    expect(p.mapping.status).toBe("Membership Status");
    expect(p.mapping.categories).toBe("Business Categories");
    expect(p.unmappedHeaders).toEqual(["Member Since"]);
    expect(p.totalRows).toBe(10);
    expect(p.includedRows).toBe(9); // Dropped Business LLC filtered out
    expect(p.statusCounts).toEqual({
      Active: 8,
      Dropped: 1,
      "Active - Courtesy": 1,
    });
    expect(p.statusColumnMissing).toBe(false);
    expect(p.externalIdFallback).toBe(false);
    expect(p.unmappedCategories).toEqual({ Marine: 1 });
    expect(p.rowsMissingName).toBe(1);
  });

  it("throws when no name column can be found", () => {
    expect(() => rosterFromCsv("Foo,Bar\n1,2\n")).toThrow(/No name column/);
  });

  it("courtesy exclusion works when the include list is narrowed", () => {
    const strict = rosterFromCsv(FIXTURE, { includeStatuses: ["active -"] });
    expect(strict.preflight.includedRows).toBe(1); // only Active - Courtesy
  });
});

/* ------------------------- plan matrix (pure) -------------------------- */

describe("planGrowthZoneImport bucket matrix (fixture manifest)", () => {
  const roster = rosterFromCsv(FIXTURE);
  const plan = planGrowthZoneImport(roster, seedLocals, []);

  it("buckets exactly as the fixture manifest expects", () => {
    expect(planStats(plan)).toEqual({
      created: 4, // marine supply, café amélie, courtesy org, junk values
      updated: 0,
      unchanged: 0,
      matched: 2, // gz-2001 by name → jaime-les-crepes; gz-2002 by phone → sourdough-willys
      quarantined: 3, // grub hut pair (ambiguous), nameless row
      deletedUpstream: 0,
    });

    const byId = Object.fromEntries(plan.matched.map((m) => [m.externalId, m]));
    expect(byId["gz-2001"].id).toBe("jaime-les-crepes");
    expect(byId["gz-2002"].id).toBe("sourdough-willys");
    expect(plan.matched.every((m) => m.aliasNew)).toBe(true);
    // The roster phone for 2001 differs from the curated one — report-only.
    expect(byId["gz-2001"].diffs.map((d) => d.field)).toContain("phone");

    const created = Object.fromEntries(plan.created.map((c) => [c.externalId, c.record]));
    expect(Object.keys(created).sort()).toEqual(["gz-2003", "gz-2008", "gz-2009", "gz-2010"]);

    const marine = created["gz-2003"];
    expect(marine.id).toBe("kingston-marine-supply-inc");
    expect(marine.category).toBe("shop"); // Marine unmapped → Retail wins
    expect(marine.address).toBe("123 Ohio Ave NE, Suite B, Kingston, WA 98346");
    expect(marine.website).toBe("https://kingstonmarine.example.com");
    expect(marine.description).toBe("Chandlery & boat supplies.\nSince 1987");
    expect(marine.sourceCategories).toEqual(["Marine", "Retail"]);

    expect(created["gz-2008"].id).toBe("cafe-amelie-bakery");
    expect(created["gz-2008"].category).toBe("eat");
    expect(created["gz-2008"].description).toBe("Fresh bread daily.\nDanish pastries.");
    expect(created["gz-2009"].category).toBe("community");
    expect(created["gz-2010"].category).toBe("services");
    // Junk placeholders never became contact fields.
    expect(created["gz-2010"].phone).toBeUndefined();
    expect(created["gz-2010"].website).toBeUndefined();

    const reasons = plan.quarantined.map((q) => q.reason).join(" | ");
    expect(reasons).toMatch(/same name/);
    expect(reasons).toMatch(/no name/);
  });

  it("the contacts join file carries emails for created and matched rows, out of band", () => {
    const csv = buildContactsCsv(plan, roster);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("bucket,store,listing_id,name,email,phone,level,rep");
    expect(csv).toContain(
      'created,directory,kingston-marine-supply-inc,"Kingston Marine Supply, Inc.",sam@kingstonmarine.example.com',
    );
    expect(csv).toContain("matched,restaurants,jaime-les-crepes");
    expect(csv).toContain("owner@jaimelescrepes.example.com");
    // The dropped member was status-filtered before planning — never invited.
    expect(csv).not.toContain("dropped@example.com");
  });
});

/* --------------------------- apply (PGlite) ---------------------------- */

describe("apply path against PGlite", () => {
  let tdb: TestDb;
  let roster: GzRoster;
  let firstPlan: QwickPlan;

  beforeAll(async () => {
    tdb = await createTestDb();
    roster = rosterFromCsv(FIXTURE);
  });
  afterAll(async () => {
    await tdb.close();
  });

  it("creates drafts with GrowthZone governance and namespaced aliases", async () => {
    firstPlan = planGrowthZoneImport(roster, await readLocalRecords(), await readAliases(GROWTHZONE_SOURCE));
    const { stats } = await applyGrowthZonePlan(firstPlan, "vitest");
    expect(stats.created).toBe(4);

    const rows = await readRecordRows("directory");
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.source).toBe("import");
      expect(row.updatedBy).toBe(GROWTHZONE_PRINCIPAL);
      expect(row.status).toBe("draft");
      expect(row.ownerOrgId).toBeNull();
    }

    // Drafts are admin-visible, publicly invisible.
    expect(await getDirectoryListingsAdmin()).toHaveLength(4);
    expect(await getDirectoryListings()).toHaveLength(0);

    // Aliases: 4 created + 2 matched, all in the growthzone namespace; the
    // qwick namespace stays empty (cross-importer isolation).
    expect(await readAliases(GROWTHZONE_SOURCE)).toHaveLength(6);
    expect(await readAliases()).toHaveLength(0);
  });

  it("a re-run is a no-op: everything unchanged, zero new audit rows", async () => {
    const [{ n: auditBefore }] = await tdb.db.select({ n: count() }).from(audit);

    const rePlan = planGrowthZoneImport(
      roster,
      await readLocalRecords(),
      await readAliases(GROWTHZONE_SOURCE),
    );
    expect(planStats(rePlan)).toEqual({
      created: 0,
      updated: 0,
      unchanged: 4,
      matched: 2,
      quarantined: 3,
      deletedUpstream: 0,
    });
    expect(rePlan.matched.every((m) => m.aliasNew)).toBe(false);

    await applyGrowthZonePlan(rePlan, "vitest");
    const [{ n: auditAfter }] = await tdb.db.select({ n: count() }).from(audit);
    expect(auditAfter).toBe(auditBefore);
  });

  it("refreshes only its own records, preserving draft status", async () => {
    const changed = rosterFromCsv(FIXTURE.replace("(360) 555-0101", "(360) 555-0202"));
    const plan = planGrowthZoneImport(
      changed,
      await readLocalRecords(),
      await readAliases(GROWTHZONE_SOURCE),
    );
    expect(planStats(plan).updated).toBe(1);
    expect(plan.updated[0].id).toBe("kingston-marine-supply-inc");
    expect(plan.updated[0].diffs.map((d) => d.field)).toEqual(["phone"]);

    await applyGrowthZonePlan(plan, "vitest");
    const rows = await readRecordRows("directory");
    const marine = rows.find((r) => r.id === "kingston-marine-supply-inc");
    expect((marine?.doc as { phone?: string }).phone).toBe("(360) 555-0202");
    expect(marine?.status).toBe("draft");
  });

  it("records the QWICK importer owns are local-wins (cross-importer precedence)", async () => {
    await writeRecord(
      "directory",
      {
        id: "legacy-kiosk-shop",
        name: "Legacy Kiosk Shop",
        category: "shop",
        description: "From the kiosk feed.",
        tags: [],
      },
      { actor: "import:qwick", source: "import", status: "draft", action: "import" },
    );
    const mini = rosterFromCsv(
      "Member ID,Member Name,Membership Status\n3001,Legacy Kiosk Shop,Active\n",
    );
    const plan = planGrowthZoneImport(
      mini,
      await readLocalRecords(),
      await readAliases(GROWTHZONE_SOURCE),
    );
    expect(planStats(plan)).toMatchObject({ created: 0, updated: 0, matched: 1 });
    expect(plan.matched[0].id).toBe("legacy-kiosk-shop");
  });

  it("admin-created records are local-wins too", async () => {
    await writeRecord(
      "directory",
      {
        id: "harbor-widgets",
        name: "Harbor Widgets",
        category: "shop",
        description: "Admin-entered.",
        tags: [],
      },
      { actor: "admin@example.test", source: "admin", status: "live", action: "create" },
    );
    const mini = rosterFromCsv(
      "Member ID,Member Name,Membership Status\n3002,Harbor Widgets,Active\n",
    );
    const plan = planGrowthZoneImport(
      mini,
      await readLocalRecords(),
      await readAliases(GROWTHZONE_SOURCE),
    );
    expect(planStats(plan)).toMatchObject({ created: 0, updated: 0, matched: 1 });
    expect(plan.matched[0].id).toBe("harbor-widgets");
  });

  it("upstream deletions are report-only — nothing is deleted", async () => {
    const withoutJunk = rosterFromCsv(
      FIXTURE.replace("(360) 555-0101", "(360) 555-0202")
        .split("\n")
        .filter((line) => !line.startsWith("2010,"))
        .join("\n"),
    );
    const plan = planGrowthZoneImport(
      withoutJunk,
      await readLocalRecords(),
      await readAliases(GROWTHZONE_SOURCE),
    );
    expect(plan.deletedUpstream.map((d) => d.externalId)).toEqual(["gz-2010"]);

    await applyGrowthZonePlan(plan, "vitest");
    const rows = await readRecordRows("directory");
    expect(rows.some((r) => r.id === "junk-values-inc")).toBe(true);
  });
});
