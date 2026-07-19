// records-parity (E05): golden tests for the seed+overlay merge semantics,
// carried forward VERBATIM from the retired json-store characterization suite
// (tests/unit/json-store.test.ts, E02) and run against the Postgres data layer
// through the SAME public surface the app uses (readOverlay/writeOverlayRecord/
// readMerged delegates). What the old suite froze, this suite proves the new
// layer preserves: overlay wins by id, tombstones hide, `_deleted` is stripped
// on merge and re-attached on raw reads, and `doc` is stored WITHOUT
// `_deleted` (the tombstone lives in the `deleted` column).
//
// The one behavior deliberately NOT carried forward: the file backend's
// corrupt-overlay-as-silent-reset (data-loss amplifier, audits §traps) died
// with the file backend.

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { record } from "@/lib/db/schema";
import { readMerged, readOverlay, writeOverlayRecord } from "@/lib/stores/json-store";
import { validWebcam } from "../setup/domain-docs";
import { createTestDb, type TestDb } from "../setup/pglite-db";

type Row = { id: string; name: string };

// Real store names so the baseline schemas (id + name) validate the fixtures.
let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

describe("records parity — merge semantics over Postgres", () => {
  it("seed-only: readMerged returns the seed array when the store is empty", async () => {
    const seed: Row[] = [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Bravo" },
    ];
    expect(await readMerged("restaurants", seed)).toEqual(seed);
  });

  it("readOverlay returns [] for an empty store", async () => {
    expect(await readOverlay<Row>("lodging")).toEqual([]);
  });

  it("overlay-wins-by-id: an overlay record whose id matches a seed id replaces it", async () => {
    const seed: Row[] = [
      { id: "a", name: "seed-Alpha" },
      { id: "b", name: "seed-Bravo" },
    ];
    const overlayAlpha = validWebcam({ id: "a", name: "overlay-Alpha" });
    await writeOverlayRecord("webcams", overlayAlpha);
    // Seed id order preserved (seed inserted first into the Map), but "a" now
    // carries the overlay's value; "b" is untouched.
    expect(await readMerged("webcams", seed)).toEqual([
      overlayAlpha,
      { id: "b", name: "seed-Bravo" },
    ]);
  });

  it("tombstone: { _deleted: true } hides a matching seed row AND an overlay-only row", async () => {
    const seed: Row[] = [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Bravo" },
    ];
    await writeOverlayRecord<Row>("charities", { id: "a", name: "Alpha", _deleted: true });
    await writeOverlayRecord<Row>("charities", { id: "z", name: "Zulu", _deleted: true });

    const merged = await readMerged("charities", seed);
    expect(merged).toEqual([{ id: "b", name: "Bravo" }]);
  });

  it("_deleted stripped: no record returned by readMerged carries a _deleted key", async () => {
    const seed: Row[] = [{ id: "a", name: "Alpha" }];
    await writeOverlayRecord<Row & { _deleted?: boolean }>("parking-zones", {
      id: "a",
      name: "overlay-Alpha",
      _deleted: false,
    });
    await writeOverlayRecord<Row>("parking-zones", { id: "c", name: "Charlie" });

    const merged = await readMerged("parking-zones", seed);
    for (const r of merged) {
      expect(Object.prototype.hasOwnProperty.call(r, "_deleted")).toBe(false);
    }
    expect(merged).toEqual([
      { id: "a", name: "overlay-Alpha" },
      { id: "c", name: "Charlie" },
    ]);
  });

  it("readOverlay re-attaches _deleted:true on tombstones and leaves live rows bare", async () => {
    await writeOverlayRecord<Row>("map-views", { id: "a", name: "Alpha" });
    await writeOverlayRecord<Row>("map-views", { id: "b", name: "Bravo", _deleted: true });

    const overlay = await readOverlay<Row>("map-views");
    const byId = new Map(overlay.map((r) => [r.id, r]));
    expect(byId.get("a")).toEqual({ id: "a", name: "Alpha" });
    expect(Object.prototype.hasOwnProperty.call(byId.get("a"), "_deleted")).toBe(false);
    expect(byId.get("b")).toEqual({ id: "b", name: "Bravo", _deleted: true });
  });

  it("doc column stores the record WITHOUT _deleted — the tombstone lives in `deleted`", async () => {
    await writeOverlayRecord<Row>("itineraries", {
      id: "gone",
      name: "n/a",
      slug: "gone",
      title: "Gone",
      _deleted: true,
    } as Row & { slug: string; title: string; _deleted: true });

    const [raw] = await tdb.db
      .select()
      .from(record)
      .where(eq(record.id, "gone"));
    expect(raw.store).toBe("itineraries");
    expect(raw.deleted).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(raw.doc, "_deleted")).toBe(false);
  });

  it("write-then-update: writing twice with the same id leaves exactly one row", async () => {
    await writeOverlayRecord<Row>("events", {
      id: "a",
      name: "x",
      title: "first",
      start: "2026-08-01T10:00:00-07:00",
    } as Row & { title: string; start: string });
    await writeOverlayRecord<Row>("events", {
      id: "a",
      name: "x",
      title: "second",
      start: "2026-08-01T10:00:00-07:00",
    } as Row & { title: string; start: string });

    const overlay = await readOverlay<Row & { title?: string }>("events");
    expect(overlay).toHaveLength(1);
    expect(overlay[0].title).toBe("second");
  });
});
