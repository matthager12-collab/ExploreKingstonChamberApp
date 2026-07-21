// Server-only hunt storage. Do NOT import from client components (it touches
// the filesystem); `import type { ... }` is fine anywhere.
//
// Seed hunts ship in src/lib/data/hunts.ts. Admin-created/edited hunts are
// overlay records in the "custom-hunts" store (json-store → Postgres) and
// OVERRIDE a seed hunt with the same id; player submissions are id-keyed
// overlay records in "hunt-submissions". PHOTO BYTES stay off the database:
// reference photos and player photos live under .data/hunts (or Vercel Blob
// when configured):
//
//   .data/hunts/refs/<huntId>-<stopId>.<ext> per-stop reference photos
//   .data/hunts/photos/<huntId>/<stopId>/…   player submissions
//
// Check-off decision: a submission is `verified` when it arrived with GPS
// coordinates and the haversine distance to the stop is within radiusMeters.
// No coords (denied / unavailable) → accepted but verified: false, and the
// player UI labels it honor-system.

import { mkdir, readdir, readFile, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { dataPath } from "./data-dir";
import { hunts as seedHunts } from "@/lib/data/hunts";
import type { Hunt, HuntStop } from "@/lib/types";
import { deleteBlob, hasBlob, putImage } from "@/lib/blob-store";
import { hardDeleteRecords, isUnderLegalHold } from "@/lib/db/privacy-delete";
import { readOverlay, writeOverlayRecord, readMerged, type WriteMeta } from "@/lib/stores/json-store";

// ---------------------------------------------------------------------------
// Types (extend the domain model locally — types.ts stays untouched)
// ---------------------------------------------------------------------------

export type StoredHuntStop = HuntStop & {
  /** Path relative to .data/hunts, e.g. "refs/downtown-discovery-dd-ferry-overlook.jpg" */
  referencePhoto?: string;
};

export type StoredHunt = Omit<Hunt, "stops"> & { stops: StoredHuntStop[] };

export type AdminHunt = StoredHunt & { source: "seed" | "custom" };

export interface HuntSubmission {
  /** Stable id. Present on DB-backed rows (overlay key); optional on legacy
   *  filesystem rows written before ids were assigned. */
  id?: string;
  /** ISO 8601 */
  ts: string;
  huntId: string;
  stopId: string;
  /** Path relative to .data/hunts, e.g. "photos/<huntId>/<stopId>/<file>.jpg" */
  photoPath: string;
  lat?: number;
  lng?: number;
  distanceMeters?: number;
  verified: boolean;
}

// ---------------------------------------------------------------------------
// Paths & shared constants
// ---------------------------------------------------------------------------

const DATA_ROOT = dataPath("hunts");

// json-store overlay collection names.
const CUSTOM_STORE = "custom-hunts";
const SUBMISSIONS_STORE = "hunt-submissions";

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // ~8 MB

/** Cap on total bytes under .data/hunts/photos in filesystem mode (fs disk is
 *  shared by all app state — see /api/hunts/submit). */
export const MAX_PHOTO_STORAGE_BYTES = 400 * 1024 * 1024; // ~400 MB

const PHOTOS_ROOT = path.join(DATA_ROOT, "photos");
const PHOTO_STORAGE_CACHE_MS = 60_000;
let photoStorageCache: { bytes: number; at: number } | undefined;

async function dirSizeRecursive(dir: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0; // missing dir → 0
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSizeRecursive(full);
    } else if (entry.isFile()) {
      total += (await stat(full).catch(() => undefined))?.size ?? 0;
    }
  }
  return total;
}

/** Total bytes under .data/hunts/photos, cached for 60 s. A per-IP rate limit
 *  on the submit route bounds how stale this can get in practice. */
export async function photoStorageBytes(): Promise<number> {
  const now = Date.now();
  if (photoStorageCache && now - photoStorageCache.at < PHOTO_STORAGE_CACHE_MS) {
    return photoStorageCache.bytes;
  }
  const bytes = await dirSizeRecursive(PHOTOS_ROOT);
  photoStorageCache = { bytes, at: now };
  return bytes;
}

/** Test-only: force the next photoStorageBytes() call to recompute. */
export function invalidatePhotoStorageCache(): void {
  photoStorageCache = undefined;
}

const EXT_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

const MIME_EXTS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
};

/** jpeg/png/webp/heic only. Returns a safe file extension or null. */
export function imageExtension(mimeType: string, fileName?: string): string | null {
  const byMime = MIME_EXTS[mimeType.toLowerCase()];
  if (byMime) return byMime;
  const nameExt = fileName?.split(".").pop()?.toLowerCase() ?? "";
  return EXT_CONTENT_TYPES[nameExt] ? (nameExt === "jpeg" ? "jpg" : nameExt) : null;
}

export function contentTypeForPath(p: string): string {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return EXT_CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** URL that streams a stored photo (see /api/hunts/photo). */
export function photoUrl(relPath: string): string {
  return `/api/hunts/photo?p=${encodeURIComponent(relPath)}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** Hunt/stop ids become file-path segments — reject anything exotic. */
export function isSafeId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

/** True when a stored photo value is a full https URL (a Vercel Blob URL) rather
 *  than a .data/hunts-relative path. Blob URLs are served by redirect, not fs. */
export function isBlobUrl(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("https://");
}

export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function readCustomHunts(): Promise<StoredHunt[]> {
  // Overlay rows for this store ARE the custom hunts (seed lives in git).
  const overlay = await readOverlay<StoredHunt>(CUSTOM_STORE);
  return overlay.filter((h) => !h._deleted).map(({ _deleted, ...rest }) => rest as StoredHunt);
}

/** Upsert a single custom hunt as one overlay record. */
async function putCustomHunt(record: StoredHunt, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord<StoredHunt>(CUSTOM_STORE, record, meta);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Seed hunts merged with admin hunts; a custom hunt wins over a seed with the same id. */
export async function getAllHunts(): Promise<AdminHunt[]> {
  const custom = await readCustomHunts();
  const customById = new Map(custom.map((h) => [h.id, h]));
  const merged: AdminHunt[] = seedHunts.map((seed) => {
    const override = customById.get(seed.id);
    if (override) {
      customById.delete(seed.id);
      return { ...override, source: "custom" };
    }
    return { ...seed, source: "seed" };
  });
  for (const extra of customById.values()) merged.push({ ...extra, source: "custom" });
  return merged;
}

export async function getHunt(slug: string): Promise<AdminHunt | undefined> {
  return (await getAllHunts()).find((h) => h.slug === slug);
}

export async function getHuntById(id: string): Promise<AdminHunt | undefined> {
  return (await getAllHunts()).find((h) => h.id === id);
}

export async function listSubmissions(huntId?: string): Promise<HuntSubmission[]> {
  // Each submission is one overlay record (id-keyed); no seed submissions.
  const subs = await readMerged<HuntSubmission & { id: string }>(SUBMISSIONS_STORE, []);
  const filtered = huntId ? subs.filter((s) => s.huntId === huntId) : subs;
  // ts ascending in insertion order isn't guaranteed by the overlay query, so
  // sort by timestamp; newest first.
  return filtered.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
}

/**
 * Destroy a submission's photo bytes — blob store or filesystem, matching
 * how saveSubmission stored them. Missing-file cases count as success (the
 * artifact is gone either way); real failures THROW so the caller keeps the
 * row and can retry — delete-photo-first is the orphan-safety contract.
 */
async function destroySubmissionPhoto(photoPath: string): Promise<void> {
  if (isBlobUrl(photoPath)) {
    await deleteBlob(photoPath);
    return;
  }
  // fs-relative form: "photos/<huntId>/<stopId>/<file>" under DATA_ROOT.
  // Resolve + containment check — a doctored path must never escape the
  // hunts data dir.
  const abs = path.resolve(DATA_ROOT, photoPath);
  if (!abs.startsWith(path.resolve(DATA_ROOT) + path.sep)) {
    throw new Error("destroySubmissionPhoto: path escapes the hunts data dir");
  }
  try {
    await unlink(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err; // already gone = fine; anything else = keep the row
  }
}

export type SubmissionDeleteResult = "deleted" | "not-found" | "legal-hold";

/**
 * E11 privacy deletion: photo first, then the record row — HARD delete
 * (physical, via the privacy carve-out), never a tombstone: a tombstoned
 * submission would keep its GPS in record.doc forever, which is exactly what
 * the 12-month retention promise forbids.
 *
 * The legal-hold check is re-run HERE, immediately before the photo is
 * destroyed — the photo is the unrecoverable half, and callers snapshot
 * holds once up front (a hold set mid-run would otherwise slip past). The
 * SQL-level hold exclusion in hardDeleteRecords is the row's backstop; this
 * is the photo's. Callers still own the audit row (retention job / MHMDA
 * fulfillment both log).
 */
export async function deleteSubmission(id: string): Promise<SubmissionDeleteResult> {
  const subs = await readMerged<HuntSubmission & { id: string }>(SUBMISSIONS_STORE, []);
  const sub = subs.find((s) => s.id === id);
  if (!sub) return "not-found";
  // TOCTOU backstop: a hold may have been set after the caller's snapshot.
  if (await isUnderLegalHold(SUBMISSIONS_STORE, id)) return "legal-hold";
  await destroySubmissionPhoto(sub.photoPath);
  invalidatePhotoStorageCache();
  const { deleted, heldSkipped } = await hardDeleteRecords(SUBMISSIONS_STORE, [id]);
  if (deleted > 0) return "deleted";
  // deleted === 0 has TWO causes; distinguish them by heldSkipped (never
  // infer a hold from the count alone). A hold that appeared between our
  // pre-check and the SQL backstop → report "legal-hold" so the caller logs
  // the reconciliation. A row that was already gone (a concurrent/overlapping
  // delete) is NOT a hold — reporting it as one would write a false, immortal
  // FR-A92 hold-skip audit entry. Content is destroyed either way, so count
  // the already-gone case as deleted.
  return heldSkipped.length > 0 ? "legal-hold" : "deleted";
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Create or update a hunt in the "custom-hunts" store. The caller is expected to have
 * validated the shape; this function re-checks ids (they become file paths),
 * guards against slug collisions, and preserves any reference photo already
 * on record when the incoming stop omits one.
 */
export async function saveHunt(hunt: StoredHunt, meta?: WriteMeta): Promise<StoredHunt> {
  if (!isSafeId(hunt.id)) throw new Error("invalid hunt id");
  for (const stop of hunt.stops) {
    if (!isSafeId(stop.id)) throw new Error(`invalid stop id: ${String(stop.id)}`);
  }
  const all = await getAllHunts();
  const slugClash = all.find((h) => h.slug === hunt.slug && h.id !== hunt.id);
  if (slugClash) throw new Error(`slug "${hunt.slug}" is already used by "${slugClash.title}"`);

  const existing = all.find((h) => h.id === hunt.id);
  const toSave: StoredHunt = {
    id: hunt.id,
    slug: hunt.slug,
    title: hunt.title,
    description: hunt.description,
    difficulty: hunt.difficulty,
    durationMinutes: hunt.durationMinutes,
    stops: hunt.stops.map((stop) => {
      const prior = existing?.stops.find((s) => s.id === stop.id);
      const referencePhoto = stop.referencePhoto ?? prior?.referencePhoto;
      return {
        id: stop.id,
        title: stop.title,
        clue: stop.clue,
        hint: stop.hint,
        lat: stop.lat,
        lng: stop.lng,
        radiusMeters: stop.radiusMeters,
        photoPrompt: stop.photoPrompt,
        funFact: stop.funFact,
        // only accept values our own code shape produces: a full blob URL, or
        // a .data/hunts-relative "refs/…" path that resolves safely.
        ...(referencePhoto &&
        (isBlobUrl(referencePhoto) ||
          (getPhotoAbsolutePath(referencePhoto) && referencePhoto.startsWith("refs/")))
          ? { referencePhoto }
          : {}),
      };
    }),
  };

  await putCustomHunt(toSave, meta);
  return toSave;
}

/**
 * Save a stop's reference photo and point the hunt record at it. If the hunt
 * only exists as a seed, it is materialized into the "custom-hunts" store first (the
 * custom copy then overrides the seed).
 */
export async function saveReferencePhoto(
  huntId: string,
  stopId: string,
  data: Uint8Array,
  ext: string,
  meta?: WriteMeta,
): Promise<string> {
  if (!isSafeId(huntId) || !isSafeId(stopId)) throw new Error("invalid hunt or stop id");
  if (!EXT_CONTENT_TYPES[ext]) throw new Error("unsupported image type");
  const hunt = await getHuntById(huntId);
  if (!hunt) throw new Error("hunt not found");
  const stop = hunt.stops.find((s) => s.id === stopId);
  if (!stop) throw new Error("stop not found");

  // The value stored on the record: a full https blob URL (prod) or a
  // .data/hunts-relative path (local dev). Both are consumed identically by
  // photoUrl() → /api/hunts/photo, which redirects the former and streams the
  // latter.
  let stored: string;
  if (hasBlob()) {
    // sha-of-content is not needed here (ref photos are keyed by hunt+stop);
    // addRandomSuffix in putImage keeps replacements from serving a stale copy.
    stored = await putImage(
      `hunts/refs/${huntId}-${stopId}.${ext}`,
      Buffer.from(data),
      EXT_CONTENT_TYPES[ext],
    );
  } else {
    const relPath = `refs/${huntId}-${stopId}.${ext}`;
    const absPath = path.join(DATA_ROOT, "refs", `${huntId}-${stopId}.${ext}`);
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, data);

    // Drop a stale reference in another format (e.g. old .png replaced by .jpg).
    // Only meaningful for fs-relative values; blob URLs aren't unlinkable here.
    if (stop.referencePhoto && stop.referencePhoto !== relPath && !isBlobUrl(stop.referencePhoto)) {
      const stale = getPhotoAbsolutePath(stop.referencePhoto);
      if (stale) await unlink(stale).catch(() => {});
    }
    stored = relPath;
  }

  const custom = await readCustomHunts();
  const existing = custom.find((h) => h.id === huntId);
  const record: StoredHunt = existing ?? {
    id: hunt.id,
    slug: hunt.slug,
    title: hunt.title,
    description: hunt.description,
    difficulty: hunt.difficulty,
    durationMinutes: hunt.durationMinutes,
    stops: hunt.stops,
  };
  record.stops = record.stops.map((s) => (s.id === stopId ? { ...s, referencePhoto: stored } : s));
  await putCustomHunt(record, meta);

  return stored;
}

/**
 * Store a player's photo submission and decide the check-off:
 * verified = GPS coords present AND haversine distance <= stop.radiusMeters.
 * Missing/denied GPS still saves the photo, just unverified (honor system).
 */
export async function saveSubmission(
  input: {
    huntId: string;
    stopId: string;
    photo: Uint8Array;
    ext: string;
    lat?: number;
    lng?: number;
  },
  meta?: WriteMeta,
): Promise<HuntSubmission> {
  const { huntId, stopId, photo, ext, lat, lng } = input;
  if (!isSafeId(huntId) || !isSafeId(stopId)) throw new Error("invalid hunt or stop id");
  if (!EXT_CONTENT_TYPES[ext]) throw new Error("unsupported image type");
  const hunt = await getHuntById(huntId);
  const stop = hunt?.stops.find((s) => s.id === stopId);
  if (!hunt || !stop) throw new Error("hunt or stop not found");

  const hasCoords = typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng);
  const distance = hasCoords ? haversineMeters(lat, lng, stop.lat, stop.lng) : undefined;
  const verified = distance !== undefined && distance <= stop.radiusMeters;

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fileName = `${id}.${ext}`;

  // Store the photo bytes: blob URL (prod) or .data/hunts-relative path (dev).
  let photoPath: string;
  if (hasBlob()) {
    photoPath = await putImage(
      `hunts/photos/${huntId}/${stopId}/${fileName}`,
      Buffer.from(photo),
      EXT_CONTENT_TYPES[ext],
    );
  } else {
    const relPath = `photos/${huntId}/${stopId}/${fileName}`;
    const absPath = path.join(DATA_ROOT, "photos", huntId, stopId, fileName);
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, photo);
    photoPath = relPath;
  }

  const submission: HuntSubmission = {
    id,
    ts: new Date().toISOString(),
    huntId,
    stopId,
    photoPath,
    ...(hasCoords ? { lat, lng } : {}),
    ...(distance !== undefined ? { distanceMeters: Math.round(distance) } : {}),
    verified,
  };

  await writeOverlayRecord<HuntSubmission & { id: string }>(
    SUBMISSIONS_STORE,
    {
      ...submission,
      id,
    },
    meta,
  );
  return submission;
}

// ---------------------------------------------------------------------------
// Photo path resolution (strict — these values arrive from query strings)
// ---------------------------------------------------------------------------

/**
 * Resolve a stored photo's relative path to an absolute path inside
 * .data/hunts. Returns null for anything suspicious: traversal, absolute
 * paths, null bytes, backslashes, or a non-image extension.
 */
export function getPhotoAbsolutePath(relPath: string): string | null {
  if (typeof relPath !== "string" || relPath.length === 0 || relPath.length > 400) return null;
  if (relPath.includes("\0") || relPath.includes("\\")) return null;
  if (relPath.startsWith("/") || relPath.startsWith("~")) return null;
  if (relPath.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return null;
  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  if (!EXT_CONTENT_TYPES[ext]) return null;
  const abs = path.resolve(DATA_ROOT, relPath);
  if (abs !== DATA_ROOT && !abs.startsWith(DATA_ROOT + path.sep)) return null;
  return abs;
}

/** Read a stored photo. Returns null when the path is invalid or the file is gone. */
export async function readPhoto(
  relPath: string,
): Promise<{ data: Uint8Array<ArrayBuffer>; contentType: string } | null> {
  const abs = getPhotoAbsolutePath(relPath);
  if (!abs) return null;
  try {
    const buf = await readFile(abs);
    // Copy into a plain ArrayBuffer-backed view so it satisfies BodyInit.
    const data = new Uint8Array(buf.byteLength);
    data.set(buf);
    return { data, contentType: contentTypeForPath(relPath) };
  } catch {
    return null;
  }
}
