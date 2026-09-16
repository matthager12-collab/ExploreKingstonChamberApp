// The Scarecrow Crawl — the Chamber's Halloween trail of business-built
// scarecrows, with a public vote for the favourite (2026).
//
// WHERE THE LIST LIVES: not here. Each scarecrow is a marker on the
// "scarecrow-crawl" map view (src/lib/data/map-views.ts), so the Chamber adds,
// moves, renames and removes entries itself — in /admin/maps or on the crawl
// console — and the public page, the map and the ballot all follow with no
// deploy. Businesses sign up late and drop out the day before; a list only a
// developer could edit would be wrong by the time it mattered.
//
// WHAT STAYS IN CODE: the dates. They are printed on the Chamber's flyer, and
// a mistyped date field would silently open or close the vote on the wrong
// day. Changing them is a deliberate, reviewed edit.

import type { MapFeature } from "@/lib/map/types";

/** The map view whose markers are the crawl. */
export const CRAWL_VIEW_ID = "scarecrow-crawl";

// Pacific time, written with the offset so the window does not drift when the
// server runs in UTC. Oct 17–31 2026 are both Saturdays; DST ends Nov 1, so
// -07:00 holds for the whole crawl.
export const CRAWL_START = "2026-10-17T00:00:00-07:00";
export const CRAWL_END = "2026-10-31T17:00:00-07:00";

/** Where a new pin lands when the Chamber adds one without coordinates: the
 *  middle of downtown, to be dragged into place in the map builder. */
export const CRAWL_MAP_CENTER: [number, number] = [47.798, -122.4971];

/** One participating business's scarecrow, as the page and the ballot see it. */
export interface Scarecrow {
  /** The map feature's id — the vote key. Stable across edits to the name. */
  id: string;
  /** What the scarecrow is called. */
  title: string;
  /** Who built or hosts it — the business, the school, the family. Shown as
   *  its own line: a scarecrow is often made by one and hosted by another, and
   *  the crawl is partly about crediting them. */
  creator?: string;
  /** The free-text line under it — where to stand, what to look for. */
  notes?: string;
  lat: number;
  lng: number;
}

/** Markers on the crawl view, as scarecrows. Anything without a point (a line
 *  or area someone drew on the view) is not a scarecrow and is skipped rather
 *  than rendered as a votable entry with no location. */
export function scarecrowsFromFeatures(features: MapFeature[]): Scarecrow[] {
  return features
    .filter((f) => f.kind === "marker" && Array.isArray(f.point))
    .map((f) => ({
      id: f.id,
      title: f.title,
      ...(f.creator ? { creator: f.creator } : {}),
      ...(f.notes ? { notes: f.notes } : {}),
      lat: f.point![0],
      lng: f.point![1],
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export type CrawlPhase = "before" | "open" | "closed";

/**
 * The Chamber's switch, sitting on top of the dates.
 *
 * "auto" is the dates deciding, and is what runs the real crawl. The other two
 * exist so the Chamber can try the whole thing — vote, photo, permission box —
 * before 17 October, and stop it early if they need to. The page is hidden
 * while they do that, so "open" before the crawl reaches nobody else.
 */
export type VotingOverride = "auto" | "open" | "closed";

export const VOTING_OVERRIDES: readonly VotingOverride[] = ["auto", "open", "closed"];

export function isVotingOverride(value: unknown): value is VotingOverride {
  return typeof value === "string" && (VOTING_OVERRIDES as readonly string[]).includes(value);
}

/**
 * What the page and the vote route both ask. THE SWITCH WINS: a forced phase
 * ignores the clock entirely, which is the point of having it.
 */
export function effectiveCrawlPhase(
  override: VotingOverride,
  now: Date = new Date(),
): CrawlPhase {
  if (override === "open") return "open";
  if (override === "closed") return "closed";
  return crawlPhase(now);
}

/**
 * Where the crawl is right now. THE server decides this — the vote route calls
 * it with its own clock, so a device with a wrong date (or a hand-edited
 * request) cannot vote early or late.
 */
export function crawlPhase(now: Date = new Date()): CrawlPhase {
  const t = now.getTime();
  if (t < Date.parse(CRAWL_START)) return "before";
  if (t > Date.parse(CRAWL_END)) return "closed";
  return "open";
}
