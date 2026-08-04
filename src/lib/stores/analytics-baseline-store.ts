// The analytics BASELINE — "count visitors from this moment forward".
//
// WHY THIS EXISTS, AND WHY IT IS NOT A DELETE. Before a launch the event log
// is full of our own building: months of local dev, staging rehearsals, admin
// clicks, Lighthouse runs, and every screenshot pass. Those rows make the
// first real week unreadable. The obvious fix is to truncate analytics_event,
// and it is the wrong one:
//
//   - it is irreversible, and the person reaching for it is doing so the night
//     before a launch, which is exactly when a mistake is least recoverable;
//   - it destroys the web-vitals distribution that E15 tuned the LCP budget
//     against, and the retention/rollup machinery's own history with it;
//   - the Chamber reports these numbers to LTAC, and "we deleted the earlier
//     data" is a worse sentence to have to write than "our counts start on the
//     day we opened to the public".
//
// So the baseline is a WATERMARK, not a purge. summarize() ignores events
// before it; nothing is destroyed; setting it back to null restores the full
// history. Re-baselining is cheap, which is the point — set it at the start of
// the soft launch, set it again on public launch day if you want a clean
// public-launch number, and the raw log survives all of it.
//
// A real purge is still available for the day the junk rows stop being worth
// their storage: scripts/purge-analytics.mjs. That one is destructive, gated,
// and deliberately not reachable from the admin UI.
//
// Storage: the same overlay seam as ferry-prediction-store — one record, id
// "settings", in store "analytics-baseline". No seed (absence = count
// everything, which is the behavior every deployment had before this existed).

import { readMerged, writeOverlayRecord, type WriteMeta } from "./json-store";

const STORE = "analytics-baseline";
const RECORD_ID = "settings";

export interface AnalyticsBaselineRecord {
  id: typeof RECORD_ID;
  /**
   * ISO 8601 instant. Events at or after this are counted; earlier ones are
   * left in the log and ignored. null means "count everything" — the same
   * state as never having set a baseline, reachable again by clearing it.
   */
  since: string | null;
  /** When the baseline was last changed, for the admin display. */
  setAt: string;
  /** Who changed it (name or email), for the admin display. */
  setBy: string;
  /**
   * Free-text note shown next to the number on the dashboard — "soft launch",
   * "public launch". The Chamber will be asked why a report starts where it
   * does, possibly a year from now; this is where that answer lives.
   */
  note?: string;
}

/** The stored baseline, or null when never set (treated as "count everything"). */
export async function getAnalyticsBaseline(): Promise<AnalyticsBaselineRecord | null> {
  const rows = await readMerged<AnalyticsBaselineRecord>(STORE, []);
  return rows.find((r) => r.id === RECORD_ID) ?? null;
}

/**
 * The cutoff to pass to summarize(), or undefined for "count everything".
 *
 * Undefined rather than null because that is what the data layer's optional
 * `sinceIso` parameter wants, and collapsing the two absent-ish values here
 * keeps every caller from having to know the difference.
 */
export async function getAnalyticsSince(): Promise<string | undefined> {
  return (await getAnalyticsBaseline())?.since ?? undefined;
}

/**
 * Move the baseline. `since` is an ISO instant, or null to clear it and count
 * the whole log again.
 *
 * Validated here rather than trusted: an unparseable string would silently
 * become a WHERE clause that matches nothing, and a dashboard reading zero
 * because of a typo looks exactly like a dashboard reading zero because
 * nobody came.
 */
export async function setAnalyticsBaseline(
  since: string | null,
  setBy: string,
  note?: string,
  meta?: WriteMeta,
): Promise<AnalyticsBaselineRecord> {
  let normalized: string | null = null;
  if (since !== null) {
    const at = new Date(since);
    if (Number.isNaN(at.getTime())) {
      throw new Error(`Invalid baseline timestamp: ${since}`);
    }
    normalized = at.toISOString();
  }

  const record: AnalyticsBaselineRecord = {
    id: RECORD_ID,
    since: normalized,
    setAt: new Date().toISOString(),
    setBy,
    ...(note ? { note } : {}),
  };
  await writeOverlayRecord<AnalyticsBaselineRecord>(STORE, record, meta);
  return record;
}
