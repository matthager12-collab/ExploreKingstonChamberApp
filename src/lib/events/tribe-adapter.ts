// Tribe (The Events Calendar) REST adapter (E12): thin I/O wrapper — fetch,
// truth-triple, paginate, and hand raw JSON to the pure normalizer. Serves
// both Tribe sources: explorekingstonwa.com (healthy but empty — the adapter
// tolerates total: 0 forever) and portofkingston.org (live, default-OFF
// pending Chamber sign-off).

import { createPoliteGet, truthTriple, type PoliteFetchDeps } from "./ingest-http";
import { tribeToNormalized, type TribeEvent } from "./normalize";
import type { EventSource, IngestReport, NormalizedEvent } from "./types";

/** Page cap (epic constraint): 5 pages x 50 events is far beyond either
 *  town calendar; a runaway pagination loop may not hammer the host. */
export const MAX_TRIBE_PAGES = 5;

export interface TribeAdapterConfig {
  /** e.g. "https://portofkingston.org" — host must be in SOURCE_ALLOWLIST. */
  baseUrl: string;
  source: EventSource;
}

export interface AdapterResult {
  events: NormalizedEvent[];
  report: IngestReport;
}

interface TribePage {
  events?: TribeEvent[];
  total?: number;
  total_pages?: number;
}

export async function fetchTribeEvents(
  config: TribeAdapterConfig,
  deps?: PoliteFetchDeps,
): Promise<AdapterResult> {
  const get = createPoliteGet(deps);
  const report: IngestReport = { fetched: 0, parsed: 0, skipped: 0, errors: [] };
  const events: NormalizedEvent[] = [];

  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, MAX_TRIBE_PAGES); page++) {
    const url = `${config.baseUrl}/wp-json/tribe/events/v1/events?per_page=50&page=${page}`;
    const res = await get(url);
    report.fetched++;

    const failure = truthTriple(res, "json", "{");
    if (failure) {
      report.errors.push(`${config.source} page ${page}: ${failure}`);
      break; // fail soft — a mid-pagination failure keeps what we have
    }

    let parsed: TribePage;
    try {
      parsed = JSON.parse(res.body.replace(/^﻿/, "")) as TribePage;
    } catch (err) {
      report.errors.push(
        `${config.source} page ${page}: invalid JSON (${String((err as Error)?.message ?? err)})`,
      );
      break;
    }
    if (typeof parsed.total !== "number" || !Array.isArray(parsed.events)) {
      report.errors.push(`${config.source} page ${page}: not a Tribe events response`);
      break;
    }

    totalPages = typeof parsed.total_pages === "number" ? parsed.total_pages : 1;
    if (page === 1 && totalPages > MAX_TRIBE_PAGES) {
      report.errors.push(
        `${config.source}: ${totalPages} pages reported, capped at ${MAX_TRIBE_PAGES} (silent-cap rule: recorded, not hidden)`,
      );
    }

    for (const raw of parsed.events) {
      const normalized = tribeToNormalized(raw, config.source);
      if (normalized) {
        events.push(normalized);
        report.parsed++;
      } else {
        report.skipped++; // unpublished / hidden / unusable — by design
      }
    }
  }

  return { events, report };
}
