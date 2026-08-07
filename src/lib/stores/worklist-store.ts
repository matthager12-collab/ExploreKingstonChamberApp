// E08 worklist store — the domain API every consumer imports.
//
// Thin wrapper over src/lib/db/worklist.ts, exactly as the content stores
// wrap records.ts: route handlers and admin pages import from here, never
// from src/lib/db directly. Pure per-store configuration (the staleness
// defaults) also lives here so the sweep and the docs read one source.

export {
  auditableWorklistItem,
  claimItem,
  createWorklistItem,
  dismissItem,
  escalateItem,
  getWorklistCounts,
  getWorklistItem,
  listWorklistItems,
  resolveItem,
  setDue,
  type CreateWorklistInput,
  type CreateWorklistResult,
  type WorklistAuditAction,
  type WorklistFilters,
  type WorklistItemRow,
  type WorklistWriteMeta,
} from "@/lib/db/worklist";

/** Default verify-by interval (days) per content store, used by the staleness
 *  sweep when a record carries no verify_interval_days of its own. Stores
 *  absent from this map are exempt from staleness checks entirely.
 *
 *  Chosen conservatively for a one-part-time-human operation:
 *  - restaurants 90: hours/menus/phone drift fastest, and stale hours are the
 *    #1 complaint a tourism site gets;
 *  - lodging 180 / webcams 180 / charities 180: contact details and links
 *    drift slowly; twice a year keeps the sweep queue small;
 *  - itineraries 365: editorial content, reviewed annually before the season;
 *  - events 90: REPEATING series only — see the note below;
 *  - volunteer-needs are date-bound (they expire on their own) and hunt
 *    submissions are reviewed once — neither belongs here.
 *
 *  WHY EVENTS ARE HERE NOW. They were excluded on the reasoning that an event
 *  is date-bound and expires on its own. That is true of a single occurrence
 *  and false of a series: a weekly market never expires, it just quietly stops
 *  being right — the hours move, the season ends, the organizer changes. So
 *  the sweep takes events at a quarter, and skips any event with no `rrule`,
 *  which leaves one-off events exactly as exempt as they were. */
export const STALENESS_DEFAULTS: Record<string, number> = {
  restaurants: 90,
  lodging: 180,
  webcams: 180,
  charities: 180,
  itineraries: 365,
  events: 90,
  // E17 directory listings: import-seeded contact details, reviewed yearly.
  // Only live rows enter the sweep, so the imported draft pile costs nothing.
  directory: 365,
};
