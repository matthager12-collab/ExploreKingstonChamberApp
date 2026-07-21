// Server-only storage for event artwork/flyer attachments (E12 follow-up).
// Mirrors hunt-store's photo storage exactly: prod writes to the public Vercel
// Blob store, local dev writes bytes under .data/events and serves them via
// /api/events/attachment. Do NOT import from a client component.
//
// Unlike hunt player-photos (admin-only), event attachments are PUBLIC once
// their event is approved — a flyer is the event's promo image. The control is
// the same posture the rest of the app already accepts: the file bytes are
// unguessable (random id + suffix) and unlisted until the moderator approves
// and the event goes live, at which point the card links them. A rejected or
// deleted submission's bytes are cleaned up (deleteAttachment) so nothing is
// left orphaned.

import "server-only";

import { mkdir, readdir, readFile, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { dataPath } from "@/lib/data-dir";
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
import { canStrip, stripImageMetadata } from "@/lib/image-sanitize";
import {
  ATTACHMENT_EXT_CONTENT_TYPES,
  attachmentContentType,
  isStoredBlobRef,
} from "./attachment-refs";

const DATA_ROOT = dataPath("events");

/** Cap on total bytes under .data/events in filesystem mode — the fs disk is
 *  shared by all app state (see docs/OPERATIONS.md "Abuse response"). Blob
 *  storage has no such shared quota to guard here. */
export const MAX_ATTACHMENT_STORAGE_BYTES = 400 * 1024 * 1024; // ~400 MB

const STORAGE_CACHE_MS = 60_000;
let storageCache: { bytes: number; at: number } | undefined;

async function dirSizeRecursive(dir: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSizeRecursive(full);
    else if (entry.isFile()) total += (await stat(full).catch(() => undefined))?.size ?? 0;
  }
  return total;
}

/** Total bytes under .data/events, cached 60 s (the per-IP suggest rate limit
 *  bounds how stale this gets). */
export async function attachmentStorageBytes(): Promise<number> {
  const now = Date.now();
  if (storageCache && now - storageCache.at < STORAGE_CACHE_MS) return storageCache.bytes;
  const bytes = await dirSizeRecursive(DATA_ROOT);
  storageCache = { bytes, at: now };
  return bytes;
}

/** Test-only: force the next attachmentStorageBytes() to recompute. */
export function invalidateAttachmentStorageCache(): void {
  storageCache = undefined;
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** Event ids become a path segment — reject anything exotic. */
function isSafeId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

/**
 * Persist one attachment's bytes and return its stored ref (a blob URL in
 * prod, a .data/events-relative path in dev). Throws on an unsafe id or an
 * extension outside the allowlist — the route validated already; this is the
 * defense-in-depth backstop.
 */
export async function saveAttachment(
  eventId: string,
  bytes: Uint8Array,
  ext: string,
): Promise<string> {
  if (!isSafeId(eventId)) throw new Error("invalid event id");
  const contentType = ATTACHMENT_EXT_CONTENT_TYPES[ext];
  if (!contentType) throw new Error("unsupported attachment type");

  // M-16-02: strip EXIF/GPS before storage. Flyers are member-submitted AND
  // become PUBLIC once a moderator approves the event, which makes this the
  // widest-audience upload path in the app — a phone photo of a poster carries
  // the photographer's location to every visitor who loads the events page.
  //
  // PDFs are passed through deliberately: they are authored artwork rather than
  // camera output, so they are not a GPS vector, and hand-rewriting a PDF to
  // drop /Info risks producing a file some viewer rejects. canStrip() is the
  // explicit allow-list — see the "NOT COVERED" note in image-sanitize.ts and
  // the corresponding line in docs/LAUNCH.md.
  const clean = canStrip(contentType) ? stripImageMetadata(bytes, contentType) : bytes;

  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const relPath = `${eventId}/${fileName}`;
  if (hasR2()) {
    await putObject(`events/${relPath}`, clean, contentType);
    return relPath;
  }
  if (hasBlob()) {
    return putImage(`events/${eventId}/${fileName}`, Buffer.from(clean), contentType);
  }
  const absPath = path.join(DATA_ROOT, eventId, fileName);
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, clean);
  return relPath;
}

/** Sanitized absolute path for a dev-mode ref, or null if it escapes
 *  .data/events or isn't an allowlisted extension (mirrors hunt-store). */
export function getAttachmentAbsolutePath(relPath: string): string | null {
  if (typeof relPath !== "string" || relPath.length === 0 || relPath.length > 400) return null;
  if (relPath.includes("\0") || relPath.includes("\\")) return null;
  if (relPath.startsWith("/") || relPath.startsWith("~")) return null;
  if (relPath.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return null;
  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  if (!ATTACHMENT_EXT_CONTENT_TYPES[ext]) return null;
  const abs = path.resolve(DATA_ROOT, relPath);
  if (abs !== DATA_ROOT && !abs.startsWith(DATA_ROOT + path.sep)) return null;
  return abs;
}

/** Stream a dev-mode attachment's bytes, or null when missing/illegal. */
export async function readAttachment(
  relPath: string,
): Promise<{ data: Uint8Array<ArrayBuffer>; contentType: string } | null> {
  const abs = getAttachmentAbsolutePath(relPath);
  if (!abs) return null;
  try {
    const buf = await readFile(abs);
    const data = new Uint8Array(buf.byteLength);
    data.set(buf);
    return { data, contentType: attachmentContentType(relPath) };
  } catch {
    // Disk first, R2 as the fallback — see the matching note in readPhoto().
    if (!hasR2()) return null;
    try {
      const obj = await getObject(`events/${relPath}`);
      if (!obj) return null;
      const data = new Uint8Array(obj.bytes.byteLength);
      data.set(obj.bytes);
      return { data, contentType: attachmentContentType(relPath) };
    } catch {
      return null; // a store blip 404s one attachment, never 500s the page
    }
  }
}

/**
 * Best-effort delete of a stored attachment (moderation reject/tombstone, or
 * E11 privacy purge). A blob ref goes through the trusted-URL delete guard; a
 * dev path is unlinked. Never throws — callers clean up on a best-effort basis
 * and a leftover file is a housekeeping issue, not a correctness one.
 */
export async function deleteAttachment(ref: string): Promise<void> {
  try {
    if (isStoredBlobRef(ref)) {
      if (isTrustedBlobUrl(ref)) await deleteBlob(ref);
      return;
    }
    const abs = getAttachmentAbsolutePath(ref);
    if (!abs) return;
    // Both copies: the migration copies rather than moves, so a rejected or
    // deleted submission can have bytes on disk AND in the bucket.
    if (hasR2()) await deleteObject(`events/${ref}`).catch(() => undefined);
    await unlink(abs).catch(() => undefined);
  } catch {
    // swallow — best effort
  }
}
