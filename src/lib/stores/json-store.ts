// Tiny JSON-file store used by the portal-editable data layers.
// Each store merges a seed array (checked into git) with a custom overlay
// (.data/stores/<name>.json, written by the portals): custom wins by id,
// and records flagged { _deleted: true } in the overlay hide seed entries.

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { dataPath } from "../data-dir";
const STORES_DIR = dataPath("stores");

export type WithId = { id: string };
export type Overlay<T extends WithId> = (T & { _deleted?: boolean })[];

async function overlayPath(name: string): Promise<string> {
  await mkdir(STORES_DIR, { recursive: true });
  return path.join(STORES_DIR, `${name}.json`);
}

export async function readOverlay<T extends WithId>(name: string): Promise<Overlay<T>> {
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
