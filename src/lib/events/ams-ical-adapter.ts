// GrowthZone (legacy ChamberMaster naming) iCal adapter (E12): the
// TRANSITIONAL Chamber-calendar ingest — ends at the R3 freeze / GrowthZone
// cancellation ~April 2027 (ADR-0005; disable via the calendar-sources admin
// toggle, no deploy). Fail-soft is load-bearing: when the subdomain dies
// before the source is disabled, every failure lands in the per-run report,
// never a crash.
//
// Two modes (RE-CHARTER delta 2):
//  - whole-calendar feed URL configured (staff-generated, docs/OPERATIONS.md
//    §9 item 6b): ONE polite request instead of up to 60;
//  - fallback: scrape /events for Details slugs, derive the per-event .ics
//    URLs from the slugs. NEVER grep the index for "ical" — event titles
//    containing "classical" false-positive (verified trap, unit-tested).

import { parseICalendar } from "./ical-parse";
import { createPoliteGet, truthTriple, type PoliteFetchDeps } from "./ingest-http";
import { veventToNormalized } from "./normalize";
import type { IngestReport, NormalizedEvent } from "./types";

/** Hard per-run cap on per-event iCal fetches (epic constraint). */
export const MAX_ICS_FETCHES_PER_RUN = 60;

export interface AmsAdapterConfig {
  /** e.g. "https://business.kingstonchamber.com" — host must be allowlisted. */
  baseUrl: string;
  /** Staff-generated whole-calendar feed URL, when it arrives. Configuration
   *  (calendar-sources record / env), never hardcoded. */
  feedUrl?: string;
}

export interface AmsAdapterResult {
  events: NormalizedEvent[];
  report: IngestReport;
}

const DETAILS_SLUG_RE = /events\/Details\/([A-Za-z0-9-]+-\d+)/g;

export async function fetchAmsIcalEvents(
  config: AmsAdapterConfig,
  deps?: PoliteFetchDeps,
): Promise<AmsAdapterResult> {
  const get = createPoliteGet(deps);
  const report: IngestReport = { fetched: 0, parsed: 0, skipped: 0, errors: [] };
  const events: NormalizedEvent[] = [];

  const collectCalendar = (body: string, label: string) => {
    const { events: parsed, warnings } = parseICalendar(body);
    for (const w of warnings) report.errors.push(`${label}: ${w}`);
    for (const ev of parsed) {
      const normalized = veventToNormalized(ev, "ams-ical");
      if (normalized) {
        events.push(normalized);
        report.parsed++;
      } else {
        report.skipped++;
      }
    }
  };

  // Preferred mode: the staff-generated whole-calendar feed — one request.
  if (config.feedUrl) {
    const res = await get(config.feedUrl);
    report.fetched++;
    const failure = truthTriple(res, "text/calendar", "BEGIN:VCALENDAR");
    if (failure) {
      report.errors.push(`whole-calendar feed: ${failure} — falling back to per-event iCal`);
    } else {
      collectCalendar(res.body, "whole-calendar feed");
      return { events, report };
    }
  }

  // Fallback mode: index scrape → derived per-event .ics URLs.
  const indexUrl = `${config.baseUrl}/events`;
  const indexRes = await get(indexUrl);
  report.fetched++;
  const indexFailure = truthTriple(indexRes, "text/html", "<");
  if (indexFailure) {
    report.errors.push(`events index: ${indexFailure}`);
    return { events, report };
  }

  const slugs: string[] = [];
  const seen = new Set<string>();
  for (const m of indexRes.body.matchAll(DETAILS_SLUG_RE)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      slugs.push(m[1]);
    }
  }
  if (slugs.length > MAX_ICS_FETCHES_PER_RUN) {
    report.errors.push(
      `events index lists ${slugs.length} events; capped at ${MAX_ICS_FETCHES_PER_RUN} this run (silent-cap rule: recorded, not hidden)`,
    );
  }

  for (const slug of slugs.slice(0, MAX_ICS_FETCHES_PER_RUN)) {
    const url = `${config.baseUrl}/events/ICal/${slug}.ics`;
    const res = await get(url);
    report.fetched++;
    const failure = truthTriple(res, "text/calendar", "BEGIN:VCALENDAR");
    if (failure) {
      // The verified soft-404 shape lands here: 200 + text/html + HTML body.
      report.skipped++;
      report.errors.push(`${slug}: ${failure}`);
      continue;
    }
    collectCalendar(res.body, slug);
  }

  return { events, report };
}
