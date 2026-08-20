// A no-op admin save must never detach a record from the shipped seed.
//
// The incident these lock down (2026-08-19): PR #194 corrected factual errors
// in two itineraries, CI passed, the deploy shipped, and the live pages kept
// serving the old text. Someone had once opened those records in the builder
// and pressed Save without editing anything; the resulting overlay row won the
// seed+overlay merge forever, so no later fix to the seed file could surface.
//
// Runs against in-memory PGlite migrated with the checked-in db/migrations —
// the real write choke point, the real audit trigger. The seed arrays are
// local fixtures (the merge helpers take `seed` as a parameter) so a test can
// evolve "the shipped version" the way a PR does, while the `itineraries`
// store name keeps real schema validation in play.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import { createTestDb, type TestDb } from "../setup/pglite-db";
import { audit, record } from "@/lib/db/schema";
import { detachOverlayRecord } from "@/lib/db/records";
import { RESTORABLE_ACTIONS } from "@/lib/audit/restore-registry";
import {
  readMerged,
  readOverlay,
  readSeedOverrides,
  writeOverlayRecord,
  writeOverlayRecordSeedAware,
} from "@/lib/stores/json-store";
import type { Itinerary } from "@/lib/types";

const STORE = "itineraries";

function itinerary(over: Partial<Itinerary> = {}): Itinerary {
  return {
    id: "rainy-day",
    slug: "rainy-day",
    title: "The Rainy Day Plan",
    tagline: "Kingston is good in the rain.",
    duration: "About 4 hours",
    mode: "walk-on",
    audience: ["Couples"],
    stops: [
      {
        time: "10:00 AM",
        title: "Coffee",
        description: "Start indoors.",
        mapQuery: "Kingston, WA",
      },
    ],
    ...over,
  } as Itinerary;
}

/** "The version shipped in the app" before and after a fact-fixing PR. */
const SEED_V1: Itinerary[] = [itinerary()];
const SEED_V2: Itinerary[] = [itinerary({ tagline: "Corrected in PR #194." })];

const META = { actor: "admin@test", source: "admin" } as const;

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

async function rowsFor(id: string) {
  return tdb.db
    .select()
    .from(record)
    .where(and(eq(record.store, STORE), eq(record.id, id)));
}
async function reset() {
  await tdb.db.delete(record).where(eq(record.store, STORE));
}

describe("no-op saves never shadow the seed", () => {
  it("a Save with no edits writes no overlay row at all", async () => {
    await reset();
    await writeOverlayRecordSeedAware(STORE, SEED_V1, itinerary(), META);

    expect(await rowsFor("rainy-day")).toHaveLength(0);
    expect(await readOverlay(STORE)).toHaveLength(0);
  });

  it("...so a later seed fix still reaches the page", async () => {
    await reset();
    await writeOverlayRecordSeedAware(STORE, SEED_V1, itinerary(), META);

    const live = await readMerged<Itinerary>(STORE, SEED_V2);
    expect(live[0].tagline).toBe("Corrected in PR #194.");
  });

  it("key order alone is not an edit (zod parse vs seed literal vs JSONB)", async () => {
    await reset();
    const base = itinerary();
    // Same content, keys in reverse declaration order — what a zod parse or a
    // JSONB round-trip can hand back.
    const reordered = {
      stops: base.stops,
      audience: base.audience,
      mode: base.mode,
      duration: base.duration,
      tagline: base.tagline,
      title: base.title,
      slug: base.slug,
      id: base.id,
    } as Itinerary;
    await writeOverlayRecordSeedAware(STORE, SEED_V1, reordered, META);
    expect(await rowsFor("rainy-day")).toHaveLength(0);
  });

  it("a real edit still writes an overlay and still wins the merge", async () => {
    await reset();
    const edited = itinerary({ title: "The Rainy Day Plan, Revised" });
    await writeOverlayRecordSeedAware(STORE, SEED_V1, edited, META);

    expect(await rowsFor("rainy-day")).toHaveLength(1);
    const live = await readMerged<Itinerary>(STORE, SEED_V1);
    expect(live[0].title).toBe("The Rainy Day Plan, Revised");
  });

  it("a record with no seed twin is written normally", async () => {
    await reset();
    const custom = itinerary({ id: "chamber-special", slug: "chamber-special" });
    await writeOverlayRecordSeedAware(STORE, SEED_V1, custom, META);
    expect(await rowsFor("chamber-special")).toHaveLength(1);
  });
});

describe("re-attaching an already-detached record", () => {
  it("saving the shipped text over a stale overlay drops the row entirely", async () => {
    await reset();
    // The production state: an overlay row identical to the OLD seed.
    await writeOverlayRecord(STORE, itinerary(), META);
    expect(await rowsFor("rainy-day")).toHaveLength(1);

    await writeOverlayRecordSeedAware(STORE, SEED_V1, itinerary(), META);
    expect(await rowsFor("rainy-day")).toHaveLength(0);
  });

  it("an explicit revert reattaches, and subsequent seed changes flow through", async () => {
    await reset();
    await writeOverlayRecord(STORE, itinerary({ tagline: "Stale text." }), META);
    expect((await readMerged<Itinerary>(STORE, SEED_V2))[0].tagline).toBe("Stale text.");

    expect(await detachOverlayRecord(STORE, "rainy-day", META)).toBe("detached");

    expect((await readMerged<Itinerary>(STORE, SEED_V2))[0].tagline).toBe(
      "Corrected in PR #194.",
    );
  });

  it("reverting a record that has no overlay reports 'absent', not success", async () => {
    await reset();
    expect(await detachOverlayRecord(STORE, "rainy-day", META)).toBe("absent");
  });
});

describe("state the seed cannot represent is never discarded", () => {
  it("a takedown is not a no-op: seed doc + hidden status writes a real row", async () => {
    await reset();
    // records.ts documents this as THE way to take a seed record down.
    await writeOverlayRecordSeedAware(STORE, SEED_V1, itinerary(), {
      ...META,
      status: "hidden",
    });

    const [row] = await rowsFor("rainy-day");
    expect(row).toBeDefined();
    expect(row.status).toBe("hidden");

    // Documenting actual behaviour, NOT endorsing it: readMergedRecords seeds
    // the map with every seed record and then overlays only `live` rows, so a
    // non-live row on a SEED record is simply skipped and the seed renders
    // publicly anyway. records.ts prescribes "overlay the seed doc at a
    // non-live status" as the way to take a seed record down, and for seed
    // records that does not actually work. Pre-existing and out of scope here
    // (this epic only stops no-op saves detaching records) — but it is why the
    // detach guard below refuses on status rather than reasoning about
    // visibility. Flagged separately.
    expect(await readMerged<Itinerary>(STORE, SEED_V1)).toHaveLength(1);
  });

  it("refuses to detach a taken-down record — that would silently republish it", async () => {
    await reset();
    await writeOverlayRecord(STORE, itinerary(), { ...META, status: "hidden" });
    expect(await detachOverlayRecord(STORE, "rainy-day", META)).toBe("refused");
    expect(await rowsFor("rainy-day")).toHaveLength(1);
  });

  it("refuses to detach a row carrying an ownership claim (E17)", async () => {
    await reset();
    await writeOverlayRecord(STORE, itinerary(), { ...META, ownerOrgId: "org-7" });
    expect(await detachOverlayRecord(STORE, "rainy-day", META)).toBe("refused");
    // a no-op save falls back to a normal write rather than dropping the claim
    await writeOverlayRecordSeedAware(STORE, SEED_V1, itinerary(), META);
    const [row] = await rowsFor("rainy-day");
    expect(row.ownerOrgId).toBe("org-7");
  });

  it("refuses to detach a row linked to the AMS seam (E16)", async () => {
    await reset();
    await writeOverlayRecord(STORE, itinerary(), { ...META, externalId: "gz-3508" });
    expect(await detachOverlayRecord(STORE, "rainy-day", META)).toBe("refused");
  });

  it("refuses to detach a tombstone — that would un-hide the seed record", async () => {
    await reset();
    await writeOverlayRecord(
      STORE,
      { ...itinerary(), _deleted: true } as Itinerary & { _deleted: true },
      META,
    );
    expect(await detachOverlayRecord(STORE, "rainy-day", META)).toBe("refused");
  });
});

describe("audit trail", () => {
  it("a revert is audited with the discarded doc and no after-snapshot", async () => {
    await reset();
    // The audit table is append-only at the DB level (trigger, migration 0001),
    // so earlier tests' rows cannot be cleared — scope by a unique actor.
    const probe = { actor: "audit-probe@test", source: "admin" } as const;
    await writeOverlayRecord(STORE, itinerary({ tagline: "Stale text." }), probe);
    await detachOverlayRecord(STORE, "rainy-day", probe);

    const rows = await tdb.db.select().from(audit).where(eq(audit.store, STORE));
    const reverted = rows.filter(
      (r) => r.action === "revert" && r.actor === "audit-probe@test",
    );
    expect(reverted).toHaveLength(1);
    expect(reverted[0].actor).toBe("audit-probe@test");
    expect((reverted[0].before as { tagline: string }).tagline).toBe("Stale text.");
    // There is no "after": the content is now whatever the seed says.
    expect(reverted[0].after).toBeNull();
  });

  it("'revert' is not a restorable action — there is no snapshot to replay", () => {
    expect(RESTORABLE_ACTIONS.has("revert")).toBe(false);
  });
});

describe("readSeedOverrides (the admin badge)", () => {
  it("flags a shadowing row and says whether it differs from the shipped text", async () => {
    await reset();
    // identical-to-seed overlay: the pure-dead-weight case, lossless to revert
    await writeOverlayRecord(STORE, itinerary(), META);
    expect(await readSeedOverrides(STORE, SEED_V1)).toEqual({
      "rainy-day": { overridesSeed: true, differsFromSeed: false },
    });

    // ...and against a seed that has since moved on, it now genuinely differs
    expect(await readSeedOverrides(STORE, SEED_V2)).toEqual({
      "rainy-day": { overridesSeed: true, differsFromSeed: true },
    });
  });

  it("reports nothing for seed-only records or a seedless store", async () => {
    await reset();
    expect(await readSeedOverrides(STORE, SEED_V1)).toEqual({});
    expect(await readSeedOverrides(STORE, [])).toEqual({});
  });
});
