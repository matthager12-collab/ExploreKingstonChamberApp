// One check of a member's saved events page: fetch -> text -> extract ->
// insert drafts -> pull in each new draft's artwork. Shared by the member's "Check now" and the daily cron.

import { hasBlob } from "@/lib/blob-store";
import {
  getEventPage,
  insertDrafts,
  recordCheck,
  setDraftArtwork,
} from "@/lib/stores/member-event-page-store";
import {
  attachmentStorageBytes,
  deleteAttachment,
  MAX_ATTACHMENT_STORAGE_BYTES,
  saveAttachment,
} from "./attachment-store";
import { extractPageEvents } from "./extract-page-events";
import {
  extractImages,
  extractLinks,
  fetchMemberImage,
  fetchMemberPage,
  htmlToText,
} from "./member-page-fetch";

export type CheckResult =
  | { ok: true; found: number; added: number }
  | { ok: false; error: string };

/** Fixed, member-safe messages — never raw error text. */
const NOT_CONFIGURED = "Automatic event reading isn't switched on yet";
const EXTRACT_FAILED = "We couldn't read events from that page. We'll try again tomorrow";

const PAUSE_MS = 300;
// ponytail: at most this many image downloads per check keeps a run inside the
// cron's time budget; later drafts simply get no artwork. Raise if pages carry more.
const MAX_ARTWORK_PER_CHECK = 12;
// No new download starts after this, so artwork adds ~a minute at worst (one in-flight
// download can still take its 15 s) to a check that already budgets ~75 s per page.
const ARTWORK_BUDGET_MS = 45_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Best effort, one image per new draft, one at a time. A failure for one
 *  image (fetch, type, size, sanitizer, storage) leaves that draft without
 *  artwork and never fails the check. */
async function fetchArtwork(ownerId: string, drafts: { id: string; imageUrl?: string }[]) {
  const withImage = drafts.filter((d) => d.imageUrl).slice(0, MAX_ARTWORK_PER_CHECK);
  if (withImage.length === 0) return;
  // Same shared-disk ceiling the public suggest route enforces.
  if (!hasBlob() && (await attachmentStorageBytes()) > MAX_ATTACHMENT_STORAGE_BYTES) return;

  const fetched = new Map<string, Awaited<ReturnType<typeof fetchMemberImage>>>();
  let downloads = 0;
  const stopAt = Date.now() + ARTWORK_BUDGET_MS;
  for (const d of withImage) {
    if (Date.now() > stopAt) break;
    try {
      let img = fetched.get(d.imageUrl!);
      if (!img) {
        if (downloads++ > 0) await sleep(PAUSE_MS);
        img = await fetchMemberImage(d.imageUrl!);
        fetched.set(d.imageUrl!, img);
      }
      if (!img.ok) continue;
      // The id is derived from the draft id, which this server generated (hex).
      const ref = await saveAttachment(`draft-${d.id}`, img.bytes, img.ext);
      try {
        await setDraftArtwork(ownerId, d.id, ref);
      } catch {
        await deleteAttachment(ref); // never leave unreferenced bytes behind
      }
    } catch {
      // Unlogged on purpose: errors can echo page content. The draft keeps no artwork.
    }
  }
}

/** Never throws for an expected failure; the outcome is also saved on the page row. */
export async function checkMemberEventPage(ownerId: string): Promise<CheckResult> {
  const page = await getEventPage(ownerId);
  if (!page) return { ok: false, error: "No events page is saved" };

  const fetched = await fetchMemberPage(page.url);
  if (!fetched.ok) {
    await recordCheck(ownerId, fetched.message);
    return { ok: false, error: fetched.message };
  }

  const extracted = await extractPageEvents(htmlToText(fetched.html, fetched.finalUrl), {
    links: extractLinks(fetched.html, fetched.finalUrl),
    images: extractImages(fetched.html, fetched.finalUrl),
  });
  if (!extracted.ok) {
    const error = extracted.reason === "not-configured" ? NOT_CONFIGURED : EXTRACT_FAILED;
    await recordCheck(ownerId, error);
    return { ok: false, error };
  }

  const added = await insertDrafts(ownerId, extracted.events);
  await fetchArtwork(ownerId, added);
  await recordCheck(ownerId, null);
  return { ok: true, found: extracted.events.length, added: added.length };
}
