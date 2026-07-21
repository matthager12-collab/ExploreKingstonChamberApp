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
import { readMerged, writeOverlayRecord, type WriteMeta } from "./json-store";
import { getObject, hasBlob, hasR2, putImage, putObject } from "../blob-store";
import { stripImageMetadata } from "../image-sanitize";

const VIEW_STORE = "map-views";
const FEATURE_STORE = "map-features";
const IMAGE_DIR = dataPath("map", "images");

export async function getMapViews(): Promise<MapView[]> {
  return readMerged<MapView>(VIEW_STORE, viewSeed);
}

export async function getMapView(id: string): Promise<MapView | undefined> {
  return (await getMapViews()).find((v) => v.id === id);
}

export async function saveMapView(view: MapView, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(VIEW_STORE, view, meta);
}

export async function deleteMapView(id: string, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(VIEW_STORE, { id, _deleted: true } as MapView & { _deleted: true }, meta);
}

export async function getMapFeatures(): Promise<MapFeature[]> {
  return readMerged<MapFeature>(FEATURE_STORE, featureSeed);
}

/** Custom features assigned to a given view. */
export async function getFeaturesForView(viewId: string): Promise<MapFeature[]> {
  return (await getMapFeatures()).filter((f) => f.views.includes(viewId));
}

export async function saveMapFeature(feature: MapFeature, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(FEATURE_STORE, feature, meta);
}

export async function deleteMapFeature(id: string, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord(
    FEATURE_STORE,
    { id, _deleted: true } as MapFeature & { _deleted: true },
    meta,
  );
}

// ---------- feature images ----------

const EXT_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/** True when a stored image value is a full https URL (a Vercel Blob URL)
 *  rather than a bare sha1 name under .data/map/images. */
export function isBlobUrl(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("https://");
}

/**
 * Save an uploaded image and return the value stored on the feature.
 * Prod (Blob): a full https CDN URL. Local dev (fs): a bare "<sha1>.<ext>" name.
 * Either value is later wrapped by callers as /api/map/image?p=<value>, which
 * redirects the URL form and streams the fs form.
 */
export async function saveFeatureImage(bytes: Buffer, ext: string): Promise<string> {
  const safeExt = /^(jpg|jpeg|png|webp|gif)$/i.test(ext) ? ext.toLowerCase() : "jpg";
  const contentType = EXT_CONTENT_TYPES[safeExt] ?? "image/jpeg";
  // M-16-02: strip EXIF/GPS first, and hash the CLEANED bytes — the content
  // hash is the stored file name, so hashing before stripping would name the
  // object after content it does not contain and break dedupe on re-upload.
  const clean = stripImageMetadata(bytes, contentType);
  const { createHash } = await import("crypto");
  const hash = createHash("sha1").update(clean).digest("hex").slice(0, 16);
  const name = `${hash}.${safeExt}`;
  if (hasR2()) {
    // Bare content-hashed name on the record, exactly as in filesystem mode;
    // the key mirrors the disk layout. featureImagePath() still validates it.
    await putObject(`map/images/${name}`, clean, contentType);
    return name;
  }
  if (hasBlob()) {
    // Keep the sha1 in the key so identical content lands on a stable path.
    return putImage(`map/images/${name}`, Buffer.from(clean), contentType);
  }
  await mkdir(IMAGE_DIR, { recursive: true });
  await writeFile(path.join(IMAGE_DIR, name), clean);
  return name;
}

/** Resolve a stored image name to an absolute path, rejecting traversal.
 *  Returns null for full https URLs (those are served by redirect, not fs). */
export function featureImagePath(name: string): string | null {
  if (isBlobUrl(name)) return null;
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  if (!/^[a-f0-9]{8,}\.(jpg|jpeg|png|webp|gif)$/i.test(name)) return null;
  return path.join(IMAGE_DIR, name);
}

export async function readFeatureImage(name: string): Promise<{ bytes: Buffer; type: string } | null> {
  // featureImagePath() is the strict validator (bare sha1-style name, known
  // extension, no separators) and gates the R2 key just as it gates the path.
  const abs = featureImagePath(name);
  if (!abs) return null;
  const ext = name.split(".").pop()!.toLowerCase();
  const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
  try {
    const bytes = await readFile(abs);
    return { bytes, type };
  } catch {
    // Disk first, R2 as the fallback — see the matching note in readPhoto().
    if (!hasR2()) return null;
    try {
      const obj = await getObject(`map/images/${name}`);
      return obj ? { bytes: Buffer.from(obj.bytes), type } : null;
    } catch {
      return null; // a store blip 404s one image, never 500s the page
    }
  }
}
