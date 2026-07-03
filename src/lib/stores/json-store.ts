// Tiny document store used by the portal-editable data layers.
// Each store merges a seed array (checked into git) with a custom overlay:
// custom wins by id, and records flagged { _deleted: true } hide seed entries.
//
// Two backends behind one interface (the seam):
//  - local dev / no DATABASE_URL → JSON files under .data/stores/<name>.json
//  - production (DATABASE_URL set) → a single Neon Postgres `overlay` table
//    keyed by (store, id), with the tombstone lifted into a `deleted` column.
// readMerged() is backend-agnostic: it merges seed[] (from git) with whatever
// readOverlay() returns, so nothing above this file changes.

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { dataPath } from "../data-dir";
import { db, ensureSchema, hasDb } from "../db";
const STORES_DIR = dataPath("stores");

export type WithId = { id: string };
export type Overlay<T extends WithId> = (T & { _deleted?: boolean })[];

async function overlayPath(name: string): Promise<string> {
  await mkdir(STORES_DIR, { recursive: true });
  return path.join(STORES_DIR, `${name}.json`);
}

export async function readOverlay<T extends WithId>(name: string): Promise<Overlay<T>> {
  if (hasDb()) {
    await ensureSchema();
    const sql = db();
    const rows = (await sql`
      SELECT id, doc, deleted FROM overlay WHERE store = ${name}
    `) as { id: string; doc: T; deleted: boolean }[];
    // Reconstruct the file-shaped record: the doc is the record sans tombstone;
    // re-attach _deleted so readMerged's filter behaves identically.
    return rows.map((r) => (r.deleted ? { ...r.doc, _deleted: true } : r.doc)) as Overlay<T>;
  }
  try {
    return JSON.parse(await readFile(await overlayPath(name), "utf8")) as Overlay<T>;
  } catch {
    return [];
  }
}

export async function writeOverlayRecord<T extends WithId>(
  name: string,
  record: T & { _deleted?: boolean },
): Promise<void> {
  if (hasDb()) {
    await ensureSchema();
    const sql = db();
    const { _deleted, ...doc } = record;
    await sql`
      INSERT INTO overlay (store, id, doc, deleted)
      VALUES (${name}, ${record.id}, ${JSON.stringify(doc)}::jsonb, ${Boolean(_deleted)})
      ON CONFLICT (store, id)
      DO UPDATE SET doc = EXCLUDED.doc, deleted = EXCLUDED.deleted
    `;
    return;
  }
  const overlay = await readOverlay<T>(name);
  const idx = overlay.findIndex((r) => r.id === record.id);
  if (idx >= 0) overlay[idx] = record;
  else overlay.push(record);
  await writeFile(await overlayPath(name), JSON.stringify(overlay, null, 1), "utf8");
}

/** Seed + overlay merge: overlay wins by id; _deleted hides a record. */
export async function readMerged<T extends WithId>(name: string, seed: T[]): Promise<T[]> {
  const overlay = await readOverlay<T>(name);
  const byId = new Map<string, T & { _deleted?: boolean }>();
  for (const s of seed) byId.set(s.id, s);
  for (const o of overlay) byId.set(o.id, o);
  return [...byId.values()].filter((r) => !r._deleted).map(({ _deleted, ...rest }) => rest as unknown as T);
}
