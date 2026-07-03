// Portal-editable map views + features, plus feature image storage.
// Seed data ships in src/lib/data/map-{views,features}.ts; admin edits overlay
// it. Images live under .data/map/images (gitignored) and are served through
// /api/map/image with strict path sanitization.

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { dataPath } from "../data-dir";
import type { MapFeature, MapView } from "../map/types";
import { mapViews as viewSeed } from "../data/map-views";
import { mapFeatures as featureSeed } from "../data/map-features";
import { readMerged, writeOverlayRecord } from "./json-store";

const VIEW_STORE = "map-views";
const FEATURE_STORE = "map-features";
const IMAGE_DIR = dataPath("map", "images");

export async function getMapViews(): Promise<MapView[]> {
  return readMerged<MapView>(VIEW_STORE, viewSeed);
}

export async function getMapView(id: string): Promise<MapView | undefined> {
  return (await getMapViews()).find((v) => v.id === id);
}

export async function saveMapView(view: MapView): Promise<void> {
  await writeOverlayRecord(VIEW_STORE, view);
}

export async function deleteMapView(id: string): Promise<void> {
  await writeOverlayRecord(VIEW_STORE, { id, _deleted: true } as MapView & { _deleted: true });
}

export async function getMapFeatures(): Promise<MapFeature[]> {
  return readMerged<MapFeature>(FEATURE_STORE, featureSeed);
}

/** Custom features assigned to a given view. */
export async function getFeaturesForView(viewId: string): Promise<MapFeature[]> {
  return (await getMapFeatures()).filter((f) => f.views.includes(viewId));
}

export async function saveMapFeature(feature: MapFeature): Promise<void> {
  await writeOverlayRecord(FEATURE_STORE, feature);
}

export async function deleteMapFeature(id: string): Promise<void> {
  await writeOverlayRecord(FEATURE_STORE, { id, _deleted: true } as MapFeature & { _deleted: true });
}

// ---------- feature images ----------

/** Save an uploaded image, returning its relative name for imageUrl. */
export async function saveFeatureImage(bytes: Buffer, ext: string): Promise<string> {
  await mkdir(IMAGE_DIR, { recursive: true });
  // Deterministic-enough unique name without Date.now()/random (unavailable
  // in some contexts): hash the content.
  const { createHash } = await import("crypto");
  const hash = createHash("sha1").update(bytes).digest("hex").slice(0, 16);
  const safeExt = /^(jpg|jpeg|png|webp|gif)$/i.test(ext) ? ext.toLowerCase() : "jpg";
  const name = `${hash}.${safeExt}`;
  await writeFile(path.join(IMAGE_DIR, name), bytes);
  return name;
}

/** Resolve a stored image name to an absolute path, rejecting traversal. */
export function featureImagePath(name: string): string | null {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  if (!/^[a-f0-9]{8,}\.(jpg|jpeg|png|webp|gif)$/i.test(name)) return null;
  return path.join(IMAGE_DIR, name);
}

export async function readFeatureImage(name: string): Promise<{ bytes: Buffer; type: string } | null> {
  const abs = featureImagePath(name);
  if (!abs) return null;
  try {
    const bytes = await readFile(abs);
    const ext = name.split(".").pop()!.toLowerCase();
    const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
    return { bytes, type };
  } catch {
    return null;
  }
}
