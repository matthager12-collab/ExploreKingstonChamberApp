// E17 Qwick importer — normalize layer, the planQwickImport bucket matrix,
// and the apply path against a real (PGlite) database: precedence law,
// idempotency, draft invisibility, alias memory, upstream deletions.
// Everything runs on the checked-in fixtures — CI never touches the network.

import { readFileSync } from "node:fs";
import { count } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { audit } from "@/lib/db/schema";
import { readRecordRows, writeRecord } from "@/lib/db/records";
import { restaurants as restaurantSeed } from "@/lib/data/restaurants";
import {
  applyQwickPlan,
  IMPORT_PRINCIPAL,
  normalizeName,
  normalizePhone,
  normalizeQwickRow,
  normalizeWebsiteHost,
  persistDryRun,
  planQwickImport,
  planStats,
  readAliases,
  readLocalRecords,
  rowsFromExport,
  slugify,
  stripHtml,
  type QwickPlan,
} from "@/lib/import/qwick";
import { getDirectoryListings, getDirectoryListingsAdmin } from "@/lib/stores/directory-store";
import { importRun, listingAlias } from "@/lib/db/import-schema";
import { createTestDb, type TestDb } from "../setup/pglite-db";

const FULL = JSON.parse(
  readFileSync("tests/fixtures/qwick/full-response.json", "utf8"),
) as unknown;
const CLEAN = JSON.parse(
  readFileSync("tests/fixtures/qwick/clean-response.json", "utf8"),
) as unknown;

/* ------------------------------ normalize ------------------------------ */

describe("normalize layer", () => {
  it("stripHtml: tags out, entities decoded, scripts dropped, whitespace collapsed", () => {
    expect(stripHtml("<p>Crepes near the <b>ferry</b> &amp; more</p>")).toBe(
      "Crepes near the ferry & more",
    );
    expect(
      stripHtml("<div>Stand<br>Open &#8212; daily &nbsp; <script>alert('x')</script></div>"),
    ).toBe("Stand\nOpen — daily");
  });

  it("normalizeName: diacritics, punctuation, 'the ' prefix, ampersands", () => {
    expect(normalizeName("J'aime Les Crêpes")).toBe("j aime les crepes");
    expect(normalizeName("The Filling Station Espresso")).toBe("filling station espresso");
    expect(normalizeName("Smith & Co.")).toBe("smith and co");
  });

  it("normalizePhone: digits only, US country code dropped", () => {
    expect(normalizePhone("(360) 297-5886")).toBe("3602975886");
    expect(normalizePhone("1-360-555-0173")).toBe("3605550173");
  });

  it("normalizeWebsiteHost: scheme optional, www dropped, garbage → ''", () => {
    expect(normalizeWebsiteHost("https://www.jaimelescrepes.com")).toBe("jaimelescrepes.com");
    expect(normalizeWebsiteHost("fillingstationespresso.example.com")).toBe(
      "fillingstationespresso.example.com",
    );
    expect(normalizeWebsiteHost("not a url")).toBe("");
  });

  it("normalizeQwickRow: canonicalizes a scheme-less website; caps description; quarantines namelessness", () => {
    const good = normalizeQwickRow({
      id: 7,
      name: "  X Shop  ",
      website: "xshop.example.com",
      description: `<p>${"y".repeat(3000)}</p>`,
    });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.candidate.externalId).toBe("7");
      expect(good.candidate.website).toBe("https://xshop.example.com");
      expect(good.candidate.description).toHaveLength(2000);
    }
    const bad = normalizeQwickRow({ id: "qw-105", description: "no name" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.externalId).toBe("qw-105");
  });

  it("slugify caps at 64 chars and never returns an empty id", () => {
    expect(slugify("The Filling Station Espresso")).toBe("filling-station-espresso");
    expect(slugify("!!!")).toBe("listing");
    expect(slugify("x".repeat(200)).length).toBeLessThanOrEqual(64);
  });

  it("rowsFromExport accepts the envelope and a bare array, rejects other shapes", () => {
    expect(rowsFromExport(FULL)).toHaveLength(6);
    expect(rowsFromExport([{ id: "a" }])).toHaveLength(1);
    expect(() => rowsFromExport({ nope: true })).toThrow(/Unrecognized export shape/);
  });
});

/* ------------------------- plan matrix (pure) -------------------------- */

describe("planQwickImport bucket matrix (fixture manifest)", () => {
  const seedLocals = restaurantSeed.map((r) => ({
    store: "restaurants",
    id: r.id,
    name: r.name,
    phone: r.phone,
    website: r.website,
    doc: r as unknown as Record<string, unknown>,
    governance: null,
  }));

  it("buckets exactly as the fixture manifest expects", () => {
    const plan = planQwickImport(rowsFromExport(FULL), seedLocals, []);
    expect(planStats(plan)).toEqual({
      created: 1, // qw-106 The Filling Station Espresso
      updated: 0,
      unchanged: 0,
      matched: 2, // qw-101 by name → jaime-les-crepes; qw-102 by phone → sourdough-willys
      quarantined: 3, // qw-103+qw-104 ambiguous pair, qw-105 nameless
      deletedUpstream: 0,
    });

    const byId = Object.fromEntries(plan.matched.map((m) => [m.externalId, m]));
    expect(byId["qw-101"].id).toBe("jaime-les-crepes");
    expect(byId["qw-102"].id).toBe("sourdough-willys");
    // Both matches are local-wins with fresh aliases; diffs are report-only.
    expect(plan.matched.every((m) => m.aliasNew)).toBe(true);

    const created = plan.created[0];
    expect(created.externalId).toBe("qw-106");
    expect(created.record.id).toBe("filling-station-espresso");
    expect(created.record.category).toBe("eat"); // Coffee → eat via the map
    expect(created.record.website).toBe("https://fillingstationespresso.example.com");
    expect(created.record.sourceCategories).toEqual(["Coffee"]);
    // isPromoted must never reach the record (fair-rotation non-negotiable).
    expect(
      Object.hasOwn(created.record as unknown as Record<string, unknown>, "isPromoted"),
    ).toBe(false);

    const reasons = plan.quarantined.map((q) => q.reason).join(" | ");
    expect(reasons).toMatch(/same name/);
    expect(reasons).toMatch(/no name|expected string/i);
  });

  it("an alias hit resolves without re-guessing, and a missing upstream id reports deleted_upstream", () => {
    const aliases = [
      {
        source: "qwick",
        externalId: "qw-101",
        subjectStore: "restaurants",
        subjectId: "jaime-les-crepes",
      },
      {
        source: "qwick",
        externalId: "qw-999",
        subjectStore: "directory",
        subjectId: "long-gone-listing",
      },
    ];
    const locals = [
      ...seedLocals,
      {
        store: "directory",
        id: "long-gone-listing",
        name: "Long Gone Listing",
        doc: { id: "long-gone-listing", name: "Long Gone Listing" },
        governance: {
          source: "import",
          ownerOrgId: null,
          updatedBy: IMPORT_PRINCIPAL,
          status: "draft" as const,
          deleted: false,
        },
      },
    ];
    const plan = planQwickImport(rowsFromExport(FULL), locals, aliases);
    // qw-101 resolves through the alias (still local-wins, but no new alias).
    const jaime = plan.matched.find((m) => m.externalId === "qw-101");
    expect(jaime?.aliasNew).toBe(false);
    // qw-999 is aliased but absent from the feed → report-only deletion.
    expect(plan.deletedUpstream).toEqual([
      { externalId: "qw-999", store: "directory", id: "long-gone-listing" },
    ]);
  });
});

/* --------------------- apply path (real database) ---------------------- */

describe("apply: precedence law, idempotency, draft invisibility", () => {
  let tdb: TestDb;
  beforeAll(async () => {
    tdb = await createTestDb();
  });
  afterAll(async () => {
    await tdb.close();
  });

  const ADMIN = "admin@example.test";
  let firstPlan: QwickPlan;

  it("apply on a fresh DB: drafts + aliases created; curated seeds untouched; public getter empty", async () => {
    // A claimed record and an admin-edited import must both be local-wins.
    await writeRecord(
      "directory",
      { id: "claimed-listing", name: "Claimed Listing", category: "shop", description: "", tags: [] },
      { actor: ADMIN, source: "admin", status: "live", ownerOrgId: "org-owner" },
    );
    await writeRecord(
      "directory",
      { id: "admin-touched-import", name: "Admin Touched Import", category: "shop", description: "old", tags: [] },
      { actor: IMPORT_PRINCIPAL, source: "import", status: "draft", externalId: "qw-200" },
    );
    await writeRecord(
      "directory",
      { id: "admin-touched-import", name: "Admin Touched Import", category: "shop", description: "admin fixed this", tags: [] },
      { actor: ADMIN, source: "admin", status: "draft" },
    );

    const rows = rowsFromExport(CLEAN);
    const local = await readLocalRecords();
    const aliases = await readAliases();
    firstPlan = planQwickImport(rows, local, aliases);
    const { stats } = await applyQwickPlan(firstPlan);

    expect(stats.created).toBe(2); // kayak rentals + filling station
    expect(stats.matched).toBe(1); // jaime by name+phone

    // Curated seed byte-identical: no overlay row was created for it.
    const restaurantRows = await readRecordRows("restaurants");
    expect(restaurantRows.find((r) => r.id === "jaime-les-crepes")).toBeUndefined();
    // …but its alias row exists (the dedupe decision is remembered).
    const aliasRows = await tdb.db.select().from(listingAlias);
    expect(
      aliasRows.find((a) => a.externalId === "qw-101")?.subjectId,
    ).toBe("jaime-les-crepes");

    // Every created record is an invisible draft with provenance stamped.
    const directoryRows = await readRecordRows("directory");
    const kayak = directoryRows.find((r) => r.id === "kingston-kayak-rentals");
    expect(kayak?.status).toBe("draft");
    expect(kayak?.source).toBe("import");
    expect(kayak?.externalId).toBe("qw-103");
    expect(kayak?.updatedBy).toBe(IMPORT_PRINCIPAL);
    // Public default getter: only the pre-existing LIVE record — no imported
    // draft ever reaches it.
    const publicIds = (await getDirectoryListings()).map((r) => r.id);
    expect(publicIds).toEqual(["claimed-listing"]);
    const admin = await getDirectoryListingsAdmin();
    expect(admin.find((r) => r.id === "filling-station-espresso")?.status).toBe("draft");
  });

  it("idempotency: an immediate second apply is all-unchanged and writes no audit rows beyond the run", async () => {
    const [{ n: auditBefore }] = await tdb.db.select({ n: count() }).from(audit);
    const plan2 = planQwickImport(rowsFromExport(CLEAN), await readLocalRecords(), await readAliases());
    const { stats } = await applyQwickPlan(plan2);
    expect(stats.created).toBe(0);
    expect(stats.updated).toBe(0);
    expect(stats.unchanged).toBe(2);
    const [{ n: auditAfter }] = await tdb.db.select({ n: count() }).from(audit);
    expect(Number(auditAfter)).toBe(Number(auditBefore));
  });

  it("refreshable: an upstream change updates the importer's own record in place (status preserved)", async () => {
    const rows = rowsFromExport(CLEAN) as Record<string, unknown>[];
    const changed = rows.map((r) =>
      r.id === "qw-103" ? { ...r, description: "Paddle the cove — now with tours." } : r,
    );
    const plan = planQwickImport(changed, await readLocalRecords(), await readAliases());
    const { stats } = await applyQwickPlan(plan);
    expect(stats.updated).toBe(1);
    const row = (await readRecordRows("directory")).find((r) => r.id === "kingston-kayak-rentals");
    expect(row?.status).toBe("draft");
    expect((row?.doc as { description: string }).description).toBe(
      "Paddle the cove — now with tours.",
    );
    expect(row?.updatedBy).toBe(IMPORT_PRINCIPAL);
  });

  it("precedence: claimed and admin-touched records are never written, even when upstream matches them", async () => {
    const probeRows = [
      {
        id: "qw-300",
        name: "Claimed Listing",
        description: "upstream wants to overwrite this",
        categories: ["Shopping"],
      },
      {
        id: "qw-200",
        name: "Admin Touched Import",
        description: "upstream wants its old text back",
        categories: ["Shopping"],
      },
    ];
    const before = await readRecordRows("directory");
    const claimedBefore = before.find((r) => r.id === "claimed-listing");
    const touchedBefore = before.find((r) => r.id === "admin-touched-import");

    const plan = planQwickImport(probeRows, await readLocalRecords(), await readAliases());
    // qw-200 has an alias from its original import; qw-300 matches by name.
    const buckets = planStats(plan);
    expect(buckets.created).toBe(0);
    expect(buckets.updated).toBe(0);
    expect(buckets.matched).toBe(2);
    await applyQwickPlan(plan);

    const after = await readRecordRows("directory");
    expect(after.find((r) => r.id === "claimed-listing")?.doc).toEqual(claimedBefore?.doc);
    expect(after.find((r) => r.id === "claimed-listing")?.updatedAt).toEqual(
      claimedBefore?.updatedAt,
    );
    expect(after.find((r) => r.id === "admin-touched-import")?.doc).toEqual(touchedBefore?.doc);
    expect(after.find((r) => r.id === "admin-touched-import")?.updatedAt).toEqual(
      touchedBefore?.updatedAt,
    );
    // The differences surfaced as report-only diffs for hand-verification.
    const claimedMatch = plan.matched.find((m) => m.externalId === "qw-300");
    expect(claimedMatch?.diffs.map((d) => d.field)).toContain("description");
  });

  it("upstream deletion deletes nothing (report-only bucket)", async () => {
    const withoutKayak = (rowsFromExport(CLEAN) as { id: string }[]).filter(
      (r) => r.id !== "qw-103",
    );
    const plan = planQwickImport(withoutKayak, await readLocalRecords(), await readAliases());
    expect(plan.deletedUpstream.map((d) => d.id)).toContain("kingston-kayak-rentals");
    await applyQwickPlan(plan);
    const row = (await readRecordRows("directory")).find((r) => r.id === "kingston-kayak-rentals");
    expect(row?.deleted).toBe(false); // still there, still a draft
  });

  it("dry run persists ONLY an import_run row (mode dry_run)", async () => {
    const recordsBefore = await readRecordRows("directory");
    const [{ n: runsBefore }] = await tdb.db.select({ n: count() }).from(importRun);
    const plan = planQwickImport(rowsFromExport(FULL), await readLocalRecords(), await readAliases());
    await persistDryRun(plan, IMPORT_PRINCIPAL);
    const [{ n: runsAfter }] = await tdb.db.select({ n: count() }).from(importRun);
    expect(Number(runsAfter)).toBe(Number(runsBefore) + 1);
    expect(await readRecordRows("directory")).toEqual(recordsBefore);
    const dryRuns = (await tdb.db.select().from(importRun)).filter((r) => r.mode === "dry_run");
    expect(dryRuns).toHaveLength(1);
    // qw-104 (ambiguous twin) + qw-105 (nameless); qw-103's own twin resolved
    // through its alias from the earlier apply, so it does NOT quarantine.
    expect(dryRuns[0].stats).toMatchObject({ quarantined: 2 });
  });

  it("re-applying an unchanged feed after all of the above stays clean (aliases never re-guess)", async () => {
    const plan = planQwickImport(rowsFromExport(CLEAN), await readLocalRecords(), await readAliases());
    const { stats } = await applyQwickPlan(plan);
    expect(stats.created).toBe(0);
    expect(stats.matched).toBe(1);
  });
});
