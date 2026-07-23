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
import { todayPacific } from "@/lib/time";

const COPY_STORE = "site-copy";
const PAGES_STORE = "site-pages";

export interface CopyOverride {
  id: string; // copy key, e.g. "eat.header.intro"
  text: string;
  /** Optional auto-restore date, "YYYY-MM-DD" (Pacific). On/after this date the
   *  override is ignored and the block falls back to the code wording — a lazy,
   *  scheduler-free expiry checked at read time (see activeRows). Used for
   *  temporary/seasonal copy that should clean itself up. */
  expiresAt?: string;
}

export interface PageSetting {
  id: string; // path, e.g. "/hunt"
  hidden: boolean;
}

/** Drop overrides whose auto-restore date has arrived (expiresAt on/before
 *  today, Pacific). Lazy by design: no cron — a read after the date returns the
 *  fallback, which lands on public pages within their revalidate window. */
function activeRows(rows: CopyOverride[]): CopyOverride[] {
  const today = todayPacific();
  return rows.filter((r) => !r.expiresAt || r.expiresAt > today);
}

/** All admin copy overrides as a key → text map (one store read per render).
 *  Expired overrides are excluded, so copyText falls back to the code wording. */
export async function getCopyOverrides(): Promise<Record<string, string>> {
  const rows = activeRows(await readMerged<CopyOverride>(COPY_STORE, []));
  return Object.fromEntries(rows.map((r) => [r.id, r.text]));
}

export interface CopyOverrideDetail {
  text: string;
  /** Scheduled auto-restore date, if one is set and still in the future. */
  expiresAt?: string;
}

/** Admin view: the same effective overrides, plus any scheduled revert date, so
 *  the editor can show "reverts on …". An already-expired block reads as default
 *  here too (same activeRows filter). */
export async function getCopyOverridesDetailed(): Promise<Record<string, CopyOverrideDetail>> {
  const rows = activeRows(await readMerged<CopyOverride>(COPY_STORE, []));
  return Object.fromEntries(
    rows.map((r) => [
      r.id,
      r.expiresAt ? { text: r.text, expiresAt: r.expiresAt } : { text: r.text },
    ]),
  );
}

/** Resolve one block: admin override if present (non-empty), else the
 *  registry fallback (E07: single-sourced — call sites pass keys only). */
export function copyText(overrides: Record<string, string>, key: CopyKey): string {
  const t = overrides[key];
  return t && t.trim().length > 0 ? t : copyFallback(key);
}

export async function saveCopyOverride(
  key: string,
  text: string,
  opts?: { expiresAt?: string | null },
  meta?: WriteMeta,
): Promise<void> {
  // writeOverlayRecord overwrites the whole row, so omitting expiresAt when it's
  // null/absent is exactly how the auto-restore date gets cleared.
  const record: CopyOverride = { id: key, text };
  if (opts?.expiresAt) record.expiresAt = opts.expiresAt;
  await writeOverlayRecord<CopyOverride>(COPY_STORE, record, meta);
}

export async function getPageSettings(): Promise<PageSetting[]> {
  return readMerged<PageSetting>(PAGES_STORE, []);
}

/** The RAW store view: paths with an explicit `hidden: true` record.
 *
 *  E14: surfaces that render links or gate a page must call
 *  `getEffectiveHiddenPaths()` in src/lib/page-visibility.tsx instead. This
 *  function cannot distinguish "no record" from "record says visible", so it
 *  reports a DEFAULT_HIDDEN_PAGES path (`/es`) as visible while it is still
 *  dark. Kept as part of the store's public API (E05) for callers that really
 *  do want the stored rows only. */
export async function getHiddenPaths(): Promise<string[]> {
  return (await getPageSettings()).filter((p) => p.hidden).map((p) => p.id);
}

export async function setPageHidden(path: string, hidden: boolean, meta?: WriteMeta): Promise<void> {
  await writeOverlayRecord<PageSetting>(PAGES_STORE, { id: path, hidden }, meta);
}
