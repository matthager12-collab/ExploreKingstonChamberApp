// Scarecrow Crawl votes — the domain API every consumer imports.
//
// Wraps src/lib/db/scarecrow-votes.ts (route handlers and pages never import
// src/lib/db directly — lint:boundaries enforces it) and owns the photo bytes,
// which live in blob storage rather than the database.
//
// The photo half is deliberately a near-copy of the same block in
// src/lib/hunt-store.ts rather than a shared abstraction: the two differ in
// root, key prefix and validation, and one storage helper serving both would
// have to take all three as parameters to save about fifteen lines.
// ponytail: copied, not factored — if a third uploader appears, factor then.

import "server-only";

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  deleteBlob,
  deleteObject,
  getObject,
  hasBlob,
  hasR2,
  isTrustedBlobUrl,
  putImage,
  putObject,
} from "@/lib/blob-store";
import { dataPath } from "@/lib/data-dir";
import {
  CRAWL_VIEW_ID,
  effectiveCrawlPhase,
  isVotingOverride,
  scarecrowsFromFeatures,
  type CrawlPhase,
  type Scarecrow,
  type VotingOverride,
} from "@/lib/data/scarecrows";
import { getFeaturesForView } from "@/lib/stores/map-store";
import { readMerged, writeOverlayRecord, type WriteMeta } from "@/lib/stores/json-store";
// The MIME/extension tables and the 8 MB ceiling are hunt-store's, reused
// rather than restated: one upload cap for the whole app is the point.
import { MAX_PHOTO_BYTES, contentTypeForPath, imageExtension } from "@/lib/hunt-store";
import { stripImageMetadata } from "@/lib/image-sanitize";
import {
  countVotes,
  countVotesBefore,
  deleteAllVotes,
  deleteVote,
  deleteVotesBefore,
  getVoteById,
  getVoteCounts,
  insertVote,
  listVotes,
  listVotesWithPhotos,
  type ScarecrowVoteRow,
} from "@/lib/db/scarecrow-votes";

export { MAX_PHOTO_BYTES, imageExtension };
export {
  countVotes,
  countVotesBefore,
  getVoteById,
  getVoteCounts,
  listVotes,
  listVotesWithPhotos,
  type ScarecrowVoteRow,
};

const DATA_ROOT = dataPath("scarecrow");
/** Key prefix in R2, and the directory under DATA_ROOT on disk. */
const PHOTO_PREFIX = "photos";
/** What a stored relative path is allowed to look like — we generate every
 *  one of them, so anything else is a bug or a doctored value. */
const REL_PATH = /^photos\/[A-Za-z0-9._-]+\.(jpg|png|webp|heic)$/;

/**
 * The crawl's entries: the markers the Chamber has put on the crawl map view.
 *
 * THE ONE READ. The public page, the words list and the vote route's allowlist
 * all come through here, so "what is on the map" and "what can be voted for"
 * cannot drift apart — an entry the Chamber removes stops accepting votes the
 * moment the page next renders.
 */
export async function getCrawlScarecrows(): Promise<Scarecrow[]> {
  return scarecrowsFromFeatures(await getFeaturesForView(CRAWL_VIEW_ID));
}

// ---------------------------------------------------------------------------
// The voting switch — one record, so the Chamber can rehearse the crawl
// ---------------------------------------------------------------------------

const SETTINGS_STORE = "scarecrow-settings";
const SETTINGS_ID = "settings";

interface CrawlSettingsRecord {
  id: string;
  voting: VotingOverride;
}

/** The switch's position. NO RECORD MEANS "auto": a wiped store, a restore or
 *  a fresh database leaves the real crawl on its real dates rather than stuck
 *  in whatever state someone last tested in. */
export async function getVotingOverride(): Promise<VotingOverride> {
  const rows = await readMerged<CrawlSettingsRecord>(SETTINGS_STORE, []);
  const row = rows.find((r) => r.id === SETTINGS_ID);
  return row && isVotingOverride(row.voting) ? row.voting : "auto";
}

export async function setVotingOverride(
  voting: VotingOverride,
  meta?: WriteMeta,
): Promise<void> {
  await writeOverlayRecord<CrawlSettingsRecord>(SETTINGS_STORE, { id: SETTINGS_ID, voting }, meta);
}

/** THE phase read: the dates, with the Chamber's switch on top. The page and
 *  the vote route both come through here so a rehearsal cannot half-happen. */
export async function getCrawlPhase(now?: Date): Promise<CrawlPhase> {
  return effectiveCrawlPhase(await getVotingOverride(), now);
}

/** Delete every vote and every photo — the "clear the test votes" button.
 *  Returns how many votes went, which is what the confirmation quoted. */
export async function clearAllVotes(): Promise<number> {
  const { deleted, photoPaths } = await deleteAllVotes();
  for (const p of photoPaths) {
    // A photo we cannot reach is logged by its absence, not by keeping the
    // vote: the Chamber asked for the tally to be empty.
    await deletePhotoBytes(p).catch(() => undefined);
  }
  return deleted;
}

/**
 * Record one vote, with the voter's optional photo.
 *
 * The photo is stripped of metadata BEFORE it is stored, fail-closed: an image
 * whose container cannot be parsed throws UnstrippableImageError and the whole
 * vote is refused, rather than storing bytes we cannot prove carry no GPS.
 */
export async function castVote(input: {
  scarecrowId: string;
  photo?: { bytes: Uint8Array; ext: string };
  /** The visitor's answer to "the Chamber may use this photo" — recorded with
   *  the photo it applies to, so a later "can we post this?" is answered by
   *  the row rather than by someone's memory. */
  photoSocialOk?: boolean;
}): Promise<{ id: string }> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const photoPath = input.photo
    ? await savePhoto(id, input.photo.bytes, input.photo.ext)
    : undefined;
  await insertVote({
    id,
    scarecrowId: input.scarecrowId,
    photoPath,
    ...(input.photoSocialOk !== undefined ? { photoSocialOk: input.photoSocialOk } : {}),
  });
  return { id };
}

async function savePhoto(voteId: string, bytes: Uint8Array, ext: string): Promise<string> {
  const contentType = contentTypeForPath(`photo.${ext}`);
  if (contentType === "application/octet-stream") throw new Error("unsupported image type");

  // M-16-02: strip EXIF/GPS before storage. A visitor photographing a
  // scarecrow outside a business is photographing a street they are standing
  // in — the embedded coordinate goes, and the crawl never asks for location.
  const clean = stripImageMetadata(bytes, contentType);

  const relPath = `${PHOTO_PREFIX}/${voteId}.${ext}`;
  if (hasR2()) {
    await putObject(`scarecrow/${relPath}`, clean, contentType);
    return relPath;
  }
  if (hasBlob()) {
    return putImage(`scarecrow/${relPath}`, Buffer.from(clean), contentType);
  }
  const abs = path.join(DATA_ROOT, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, clean);
  return relPath;
}

/** Read a stored photo for the ADMIN photo route. The path always comes from a
 *  database row, never from a query string; the shape check is belt-and-braces
 *  in case a row is ever written by something other than savePhoto(). */
export async function readPhoto(
  relPath: string,
): Promise<{ data: Uint8Array<ArrayBuffer>; contentType: string } | null> {
  if (!REL_PATH.test(relPath)) return null;
  if (hasR2()) {
    try {
      const obj = await getObject(`scarecrow/${relPath}`);
      if (obj) {
        const data = new Uint8Array(obj.bytes.byteLength);
        data.set(obj.bytes);
        return { data, contentType: contentTypeForPath(relPath) };
      }
    } catch {
      // An R2 blip 404s this one photo; it must never 500 the review page.
      return null;
    }
  }
  try {
    const buf = await readFile(path.join(DATA_ROOT, relPath));
    const data = new Uint8Array(buf.byteLength);
    data.set(buf);
    return { data, contentType: contentTypeForPath(relPath) };
  } catch {
    return null;
  }
}

/** Delete one vote and its photo. Used by the Chamber's reject button and by
 *  the retention purge. The row goes even if the bytes cannot be reached. */
export async function removeVote(id: string): Promise<boolean> {
  const { deleted, photoPath } = await deleteVote(id);
  if (photoPath) await deletePhotoBytes(photoPath);
  return deleted;
}

/** Retention: delete every vote past the cutoff, photos included. Returns the
 *  number of rows deleted and how many photos could not be removed (their rows
 *  are already gone — the bytes are reported so a run can be reconciled). */
export async function purgeVotesBefore(
  cutoff: string,
): Promise<{ deleted: number; photoFailures: number }> {
  const { deleted, photoPaths } = await deleteVotesBefore(cutoff);
  let photoFailures = 0;
  for (const p of photoPaths) {
    try {
      await deletePhotoBytes(p);
    } catch {
      photoFailures++;
    }
  }
  // `deleted` counts ROWS; photoPaths counts the subset that carried a photo.
  // Reporting paths.length here would under-report every photoless vote.
  return { deleted, photoFailures };
}

async function deletePhotoBytes(stored: string): Promise<void> {
  if (isTrustedBlobUrl(stored)) {
    await deleteBlob(stored);
    return;
  }
  if (!REL_PATH.test(stored)) return;
  if (hasR2()) {
    await deleteObject(`scarecrow/${stored}`);
    return;
  }
  await unlink(path.join(DATA_ROOT, stored)).catch(() => undefined);
}

/** URL that streams a stored photo (admin only — see /api/scarecrow/photo). */
export function photoUrl(voteId: string): string {
  return `/api/scarecrow/photo?id=${encodeURIComponent(voteId)}`;
}
