// Server-only hunt storage. Do NOT import from client components (it touches
// the filesystem); `import type { ... }` is fine anywhere.
//
// Seed hunts ship in src/lib/data/hunts.ts. Admin-created/edited hunts live in
// .data/hunts/custom-hunts.json (gitignored) and OVERRIDE a seed hunt with the
// same id. Reference photos and player submissions live under .data/hunts too:
//
//   .data/hunts/custom-hunts.json            admin hunts (full StoredHunt objects)
//   .data/hunts/refs/<huntId>-<stopId>.<ext> per-stop reference photos
//   .data/hunts/photos/<huntId>/<stopId>/…   player submissions
//   .data/hunts/submissions.jsonl            one JSON line per submission
//
// Check-off decision: a submission is `verified` when it arrived with GPS
// coordinates and the haversine distance to the stop is within radiusMeters.
// No coords (denied / unavailable) → accepted but verified: false, and the
// player UI labels it honor-system.

import { appendFile, mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { dataPath } from "./data-dir";
import { hunts as seedHunts } from "@/lib/data/hunts";
import type { Hunt, HuntStop } from "@/lib/types";

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
const CUSTOM_FILE = path.join(DATA_ROOT, "custom-hunts.json");
const SUBMISSIONS_FILE = path.join(DATA_ROOT, "submissions.jsonl");

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // ~8 MB

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
  try {
    const raw = await readFile(CUSTOM_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredHunt[]) : [];
  } catch {
    return []; // no custom hunts yet (or unreadable file — treat as empty)
  }
}

async function writeCustomHunts(hunts: StoredHunt[]): Promise<void> {
  await mkdir(DATA_ROOT, { recursive: true });
  await writeFile(CUSTOM_FILE, JSON.stringify(hunts, null, 2) + "\n", "utf8");
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
  let lines: string[] = [];
  try {
    lines = (await readFile(SUBMISSIONS_FILE, "utf8")).split("\n").filter(Boolean);
  } catch {
    // no submissions yet
  }
  const subs: HuntSubmission[] = [];
  for (const line of lines) {
    try {
      subs.push(JSON.parse(line) as HuntSubmission);
    } catch {
      // skip corrupt line
    }
  }
  const filtered = huntId ? subs.filter((s) => s.huntId === huntId) : subs;
  return filtered.reverse(); // newest first
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Create or update a hunt in custom-hunts.json. The caller is expected to have
 * validated the shape; this function re-checks ids (they become file paths),
 * guards against slug collisions, and preserves any reference photo already
 * on record when the incoming stop omits one.
 */
export async function saveHunt(hunt: StoredHunt): Promise<StoredHunt> {
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
        // only accept paths our own code shape produces
        ...(referencePhoto && getPhotoAbsolutePath(referencePhoto) && referencePhoto.startsWith("refs/")
          ? { referencePhoto }
          : {}),
      };
    }),
  };

  const custom = await readCustomHunts();
  const idx = custom.findIndex((h) => h.id === hunt.id);
  if (idx >= 0) custom[idx] = toSave;
  else custom.push(toSave);
  await writeCustomHunts(custom);
  return toSave;
}

/**
 * Save a stop's reference photo and point the hunt record at it. If the hunt
 * only exists as a seed, it is materialized into custom-hunts.json first (the
 * custom copy then overrides the seed).
 */
export async function saveReferencePhoto(
  huntId: string,
  stopId: string,
  data: Uint8Array,
  ext: string,
): Promise<string> {
  if (!isSafeId(huntId) || !isSafeId(stopId)) throw new Error("invalid hunt or stop id");
  if (!EXT_CONTENT_TYPES[ext]) throw new Error("unsupported image type");
  const hunt = await getHuntById(huntId);
  if (!hunt) throw new Error("hunt not found");
  const stop = hunt.stops.find((s) => s.id === stopId);
  if (!stop) throw new Error("stop not found");

  const relPath = `refs/${huntId}-${stopId}.${ext}`;
  const absPath = path.join(DATA_ROOT, "refs", `${huntId}-${stopId}.${ext}`);
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, data);

  // Drop a stale reference in another format (e.g. old .png replaced by .jpg).
  if (stop.referencePhoto && stop.referencePhoto !== relPath) {
    const stale = getPhotoAbsolutePath(stop.referencePhoto);
    if (stale) await unlink(stale).catch(() => {});
  }

  const custom = await readCustomHunts();
  const idx = custom.findIndex((h) => h.id === huntId);
  const plainHunt: StoredHunt = {
    id: hunt.id,
    slug: hunt.slug,
    title: hunt.title,
    description: hunt.description,
    difficulty: hunt.difficulty,
    durationMinutes: hunt.durationMinutes,
    stops: hunt.stops,
  };
  const record: StoredHunt = idx >= 0 ? custom[idx] : plainHunt;
  record.stops = record.stops.map((s) => (s.id === stopId ? { ...s, referencePhoto: relPath } : s));
  if (idx >= 0) custom[idx] = record;
  else custom.push(record);
  await writeCustomHunts(custom);

  return relPath;
}

/**
 * Store a player's photo submission and decide the check-off:
 * verified = GPS coords present AND haversine distance <= stop.radiusMeters.
 * Missing/denied GPS still saves the photo, just unverified (honor system).
 */
export async function saveSubmission(input: {
  huntId: string;
  stopId: string;
  photo: Uint8Array;
  ext: string;
  lat?: number;
  lng?: number;
}): Promise<HuntSubmission> {
  const { huntId, stopId, photo, ext, lat, lng } = input;
  if (!isSafeId(huntId) || !isSafeId(stopId)) throw new Error("invalid hunt or stop id");
  if (!EXT_CONTENT_TYPES[ext]) throw new Error("unsupported image type");
  const hunt = await getHuntById(huntId);
  const stop = hunt?.stops.find((s) => s.id === stopId);
  if (!hunt || !stop) throw new Error("hunt or stop not found");

  const hasCoords = typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng);
  const distance = hasCoords ? haversineMeters(lat, lng, stop.lat, stop.lng) : undefined;
  const verified = distance !== undefined && distance <= stop.radiusMeters;

  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const relPath = `photos/${huntId}/${stopId}/${fileName}`;
  const absPath = path.join(DATA_ROOT, "photos", huntId, stopId, fileName);
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, photo);

  const submission: HuntSubmission = {
    ts: new Date().toISOString(),
    huntId,
    stopId,
    photoPath: relPath,
    ...(hasCoords ? { lat, lng } : {}),
    ...(distance !== undefined ? { distanceMeters: Math.round(distance) } : {}),
    verified,
  };
  await mkdir(DATA_ROOT, { recursive: true });
  await appendFile(SUBMISSIONS_FILE, JSON.stringify(submission) + "\n", "utf8");
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
