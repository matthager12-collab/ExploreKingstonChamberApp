// The Scarecrow Crawl — the Chamber's Halloween trail of business-built
// scarecrows, with a public vote for the favourite (2026).
//
// SEED ONLY, on purpose. There is no admin editor and no overlay store: the
// list is fixed for the fortnight the crawl runs, and a typed file the Chamber
// can read is a smaller thing to maintain for two weeks than a CRUD screen.
// Editing this file and deploying is the update path.
//
// The window is the whole gate. Voting opens at CRAWL_START and closes at
// CRAWL_END; the API refuses votes outside it (a client clock cannot be
// trusted), and the page shows results only once it is closed.

/** One participating business's scarecrow. */
export interface Scarecrow {
  /** Stable id — the vote key. Never reuse one across years. */
  id: string;
  /** Business hosting it, as the Chamber would print it. */
  business: string;
  /** The scarecrow's own name, when it has one. */
  title: string;
  /** Where to stand to see it. */
  address: string;
  lat: number;
  lng: number;
  /** One line for the map popup and the list. */
  blurb?: string;
}

// Pacific time, written with the offset so the window does not drift when the
// server runs in UTC. Oct 17–31 2026 are both Saturdays; DST ends Nov 1, so
// -07:00 holds for the whole crawl.
export const CRAWL_START = "2026-10-17T00:00:00-07:00";
export const CRAWL_END = "2026-10-31T17:00:00-07:00";

/**
 * PLACEHOLDER ENTRIES — not real participants.
 *
 * The Chamber's list of participating businesses had not arrived when this
 * shipped. These four exist so the page, the map and the vote work end to
 * end; the coordinates are points around downtown Kingston, not surveyed
 * locations. REPLACE THE WHOLE ARRAY with the real list before the crawl
 * opens — ids included, since a placeholder id that collects a vote would
 * carry that vote onto whichever business inherits the slot.
 */
export const SCARECROWS: Scarecrow[] = [
  {
    id: "placeholder-1",
    business: "Placeholder — business one",
    title: "Scarecrow one",
    address: "Main Street, Kingston",
    lat: 47.7981,
    lng: -122.496,
    blurb: "Replace with the Chamber's real entry.",
  },
  {
    id: "placeholder-2",
    business: "Placeholder — business two",
    title: "Scarecrow two",
    address: "Main Street, Kingston",
    lat: 47.7975,
    lng: -122.4972,
    blurb: "Replace with the Chamber's real entry.",
  },
  {
    id: "placeholder-3",
    business: "Placeholder — business three",
    title: "Scarecrow three",
    address: "NE West Kingston Road, Kingston",
    lat: 47.7992,
    lng: -122.4988,
    blurb: "Replace with the Chamber's real entry.",
  },
  {
    id: "placeholder-4",
    business: "Placeholder — business four",
    title: "Scarecrow four",
    address: "Near the ferry dock, Kingston",
    lat: 47.7967,
    lng: -122.4969,
    blurb: "Replace with the Chamber's real entry.",
  },
];

/** The map's opening frame: downtown Kingston, tight enough to walk. */
export const CRAWL_MAP_CENTER: [number, number] = [47.798, -122.4971];
export const CRAWL_MAP_ZOOM = 15.5;

export type CrawlPhase = "before" | "open" | "closed";

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

/** The scarecrow with this id, or undefined. The vote route's allowlist: an
 *  id that is not in this file is not a thing anyone can vote for. */
export function scarecrowById(id: string): Scarecrow | undefined {
  return SCARECROWS.find((s) => s.id === id);
}
