// Site-wide admin-editable settings, on the standard overlay-store pattern:
//
//  - "site-copy":  { id: <copy key>, text }  — admin-edited text blocks that
//    override the hardcoded fallbacks baked into each page. The list of
//    editable keys (with labels + fallbacks for the admin UI) lives in
//    src/lib/site-copy-registry.ts; this store only holds overrides, so an
//    untouched block costs nothing and always tracks the code's fallback.
//
//  - "site-pages": { id: <path>, hidden } — per-page visibility. Hidden pages
//    drop out of the nav/footer/home grid and 404 for visitors; admins still
//    see them (with a banner) so they can prep content before launch.
//    Enforcement helper: src/lib/page-visibility.ts.

import { readMerged, writeOverlayRecord, type WriteMeta } from "./json-store";
import { copyFallback, type CopyKey } from "@/lib/site-copy-registry";

const COPY_STORE = "site-copy";
const PAGES_STORE = "site-pages";

export interface CopyOverride {
  id: string; // copy key, e.g. "eat.header.intro"
  text: string;
}

export interface PageSetting {
  id: string; // path, e.g. "/hunt"
  hidden: boolean;
}

/** All admin copy overrides as a key → text map (one store read per render). */
export async function getCopyOverrides(): Promise<Record<string, string>> {
  const rows = await readMerged<CopyOverride>(COPY_STORE, []);
  return Object.fromEntries(rows.map((r) => [r.id, r.text]));
}

/** Resolve one block: admin override if present (non-empty), else the
 *  registry fallback (E07: single-sourced — call sites pass keys only). */
export function copyText(overrides: Record<string, string>, key: CopyKey): string {
  const t = overrides[key];
  return t && t.trim().length > 0 ? t : copyFallback(key);
}

export async function saveCopyOverride(key: string, text: string, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord<CopyOverride>(COPY_STORE, { id: key, text }, meta);
}

export async function getPageSettings(): Promise<PageSetting[]> {
  return readMerged<PageSetting>(PAGES_STORE, []);
}

export async function getHiddenPaths(): Promise<string[]> {
  return (await getPageSettings()).filter((p) => p.hidden).map((p) => p.id);
}

export async function setPageHidden(path: string, hidden: boolean, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord<PageSetting>(PAGES_STORE, { id: path, hidden }, meta);
}
