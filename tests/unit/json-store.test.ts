// Characterization tests for the tiny document store (src/lib/stores/json-store.ts).
// These freeze the CURRENT behavior of the seed+overlay merge, the file backend's
// corrupt-file-as-reset, and (in an isolated describe) the Postgres backend branch.
//
// The unit setup (tests/setup/unit-env.ts) establishes a scratch DATA_DIR and
// deletes DATABASE_URL BEFORE any store import, so hasDb() is false by default and
// the file backend is exercised. STORES_DIR is captured at import time as
// dataPath("stores") === <DATA_DIR>/stores. Each test uses a UNIQUE store name so
// overlay files never collide across tests.

import { readFile, mkdir, writeFile } from "fs/promises";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readMerged, readOverlay, writeOverlayRecord } from "@/lib/stores/json-store";

type Row = { id: string; name: string };

function storesDir(): string {
  // Mirror json-store's STORES_DIR: dataPath("stores") === <DATA_DIR>/stores.
  return path.join(process.env.DATA_DIR as string, "stores");
}

async function overlayFilePath(name: string): Promise<string> {
  const dir = storesDir();
  await mkdir(dir, { recursive: true });
  return path.join(dir, `${name}.json`);
}

// ---------------------------------------------------------------------------
// File backend (default: hasDb() === false because unit-env.ts deletes DATABASE_URL)
// ---------------------------------------------------------------------------
describe("json-store file backend", () => {
  it("seed-only: readMerged returns the seed array when no overlay file exists", async () => {
    const seed: Row[] = [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Bravo" },
    ];
    const merged = await readMerged("file-seed-only", seed);
    expect(merged).toEqual(seed);
  });

  it("readOverlay returns [] when no overlay file exists", async () => {
    expect(await readOverlay<Row>("file-no-overlay")).toEqual([]);
  });

  it("overlay-wins-by-id: an overlay record whose id matches a seed id replaces it", async () => {
    const name = "file-overlay-wins";
    const seed: Row[] = [
      { id: "a", name: "seed-Alpha" },
      { id: "b", name: "seed-Bravo" },
    ];
    await writeOverlayRecord<Row>(name, { id: "a", name: "overlay-Alpha" });
    const merged = await readMerged(name, seed);
    // Seed id order preserved (seed inserted first into the Map), but "a" now
    // carries the overlay's value; "b" is untouched.
    expect(merged).toEqual([
      { id: "a", name: "overlay-Alpha" },
      { id: "b", name: "seed-Bravo" },
    ]);
  });

  it("tombstone: { _deleted: true } hides a matching seed row AND an overlay-only row", async () => {
    const name = "file-tombstone";
    const seed: Row[] = [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Bravo" },
    ];
    // Tombstone a seed id.
    await writeOverlayRecord<Row>(name, { id: "a", name: "Alpha", _deleted: true });
    // Tombstone an overlay-only id (not present in seed) — still hidden.
    await writeOverlayRecord<Row>(name, { id: "z", name: "Zulu", _deleted: true });

    const merged = await readMerged(name, seed);
    expect(merged).toEqual([{ id: "b", name: "Bravo" }]);
    expect(merged.some((r) => r.id === "a")).toBe(false);
    expect(merged.some((r) => r.id === "z")).toBe(false);
  });

  it("_deleted stripped: no record returned by readMerged carries a _deleted key", async () => {
    const name = "file-strip-deleted";
    const seed: Row[] = [{ id: "a", name: "Alpha" }];
    // A live (non-deleted) overlay record still written with an explicit
    // _deleted:false, plus a plain overlay-only record.
    await writeOverlayRecord<Row & { _deleted?: boolean }>(name, {
      id: "a",
      name: "overlay-Alpha",
      _deleted: false,
    });
    await writeOverlayRecord<Row>(name, { id: "c", name: "Charlie" });

    const merged = await readMerged(name, seed);
    for (const r of merged) {
      expect(Object.prototype.hasOwnProperty.call(r, "_deleted")).toBe(false);
    }
    expect(merged).toEqual([
      { id: "a", name: "overlay-Alpha" },
      { id: "c", name: "Charlie" },
    ]);
  });

  it("corrupt overlay file: readOverlay returns [] and readMerged falls back to seed-only (data-loss-as-reset)", async () => {
    const name = "file-corrupt";
    const file = await overlayFilePath(name);
    await writeFile(file, "{not json", "utf8");

    // JSON.parse throws → caught → []. The bad overlay is silently discarded.
    expect(await readOverlay<Row>(name)).toEqual([]);

    const seed: Row[] = [{ id: "a", name: "Alpha" }];
    expect(await readMerged(name, seed)).toEqual(seed);
  });

  it("write-then-update: writing twice with the same id leaves exactly one record", async () => {
    const name = "file-write-update";
    await writeOverlayRecord<Row>(name, { id: "a", name: "first" });
    await writeOverlayRecord<Row>(name, { id: "a", name: "second" });

    const overlay = await readOverlay<Row>(name);
    expect(overlay).toHaveLength(1);
    expect(overlay[0]).toEqual({ id: "a", name: "second" });

    // And the on-disk file is pretty-printed with JSON.stringify(overlay, null, 1).
    const onDisk = await readFile(await overlayFilePath(name), "utf8");
    expect(JSON.parse(onDisk)).toEqual([{ id: "a", name: "second" }]);
  });
});

// ---------------------------------------------------------------------------
// DB backend branch (isolated): mock @/lib/db so hasDb() === true and db()
// returns a canned tagged-template function returning rows { id, doc, deleted }.
// ---------------------------------------------------------------------------
describe("json-store DB backend branch", () => {
  // Canned rows the mocked SQL client returns for the SELECT in readOverlay.
  // Shape mirrors json-store's cast: { id: string; doc: T; deleted: boolean }[].
  let cannedRows: { id: string; doc: Row; deleted: boolean }[] = [];
  const ensureSchema = vi.fn(async () => {});

  // A tagged-template function: db() returns this; readOverlay calls it as
  //   sql`SELECT id, doc, deleted FROM overlay WHERE store = ${name}`
  // so it receives (strings, ...values) and just resolves to cannedRows.
  // Invoked as a tagged template (sql`...`); it ignores its args and resolves
  // to cannedRows. Declaring no params keeps it valid (JS drops extra args).
  const sqlTag = vi.fn(async () => cannedRows);

  beforeEach(() => {
    vi.resetModules();
    cannedRows = [];
    ensureSchema.mockClear();
    sqlTag.mockClear();
    vi.doMock("@/lib/db", () => ({
      hasDb: () => true,
      ensureSchema,
      db: () => sqlTag,
    }));
  });

  afterEach(() => {
    vi.doUnmock("@/lib/db");
    vi.resetModules();
  });

  it("readOverlay re-attaches _deleted:true for rows with deleted=true and leaves live rows bare", async () => {
    cannedRows = [
      { id: "a", doc: { id: "a", name: "Alpha" }, deleted: false },
      { id: "b", doc: { id: "b", name: "Bravo" }, deleted: true },
    ];
    const { readOverlay: readOverlayDb } = await import("@/lib/stores/json-store");

    const overlay = await readOverlayDb<Row>("db-readoverlay");
    expect(ensureSchema).toHaveBeenCalledOnce();
    // Live row: doc returned as-is, NO _deleted key.
    expect(overlay[0]).toEqual({ id: "a", name: "Alpha" });
    expect(Object.prototype.hasOwnProperty.call(overlay[0], "_deleted")).toBe(false);
    // Tombstoned row: _deleted:true re-attached onto the doc.
    expect(overlay[1]).toEqual({ id: "b", name: "Bravo", _deleted: true });
  });

  it("readMerged filters out DB-tombstoned rows and merges live overlay rows over seed by id", async () => {
    cannedRows = [
      // Overrides seed "a".
      { id: "a", doc: { id: "a", name: "overlay-Alpha" }, deleted: false },
      // Tombstones seed "b".
      { id: "b", doc: { id: "b", name: "Bravo" }, deleted: true },
    ];
    const { readMerged: readMergedDb } = await import("@/lib/stores/json-store");

    const seed: Row[] = [
      { id: "a", name: "seed-Alpha" },
      { id: "b", name: "seed-Bravo" },
      { id: "c", name: "seed-Charlie" },
    ];
    const merged = await readMergedDb("db-readmerged", seed);
    // "a" overridden, "b" tombstoned/hidden, "c" untouched seed; _deleted stripped.
    expect(merged).toEqual([
      { id: "a", name: "overlay-Alpha" },
      { id: "c", name: "seed-Charlie" },
    ]);
    for (const r of merged) {
      expect(Object.prototype.hasOwnProperty.call(r, "_deleted")).toBe(false);
    }
  });
});
