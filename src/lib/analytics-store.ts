// Privacy-first visitor analytics for the Chamber's LTAC/JLARC reporting.
//
// Append-only Postgres log (analytics_event), same pattern as survey-store.ts,
// via the data layer's append helpers (src/lib/db/append.ts). summarize()
// reads the whole log on every call — fine at Kingston scale (thousands of
// rows); revisit with incremental aggregation if volume ever grows.
//
// What we store, and only this: a timestamp, a pageview/outbound-click/
// geo-ping type, the in-app path, a random client-generated session id
// (sessionStorage, no cookies), coarse geography derived server-side from
// connection headers, for outbound clicks the destination href + label, and
// for opt-in geo-pings (the "what's open near me" feature) coordinates
// rounded to 3 decimals (~100 m / about a block) plus a named-area bucket.
// No PII, no IP addresses, no user agents, no cookies, no third parties.
// Geo-pings only ever exist because the visitor tapped a location feature
// and accepted the browser's permission prompt; nothing finer than the
// rounded coordinates is ever stored, and reporting is by area counts.
//
// IMPORTANT: precise home zip codes canNOT be derived reliably from an IP —
// IP geolocation is city/region-grained at best and often wrong at zip level.
// The anonymous visitor survey (survey-store.ts) remains the only zip source;
// this store answers "roughly where from" and "where did they go".

import { appendAnalyticsEvent, readAnalyticsEvents } from "./db/append";

// "geolite2" (E10): coarse geography from the self-hosted MaxMind GeoLite2 file
// — the source on Render, where no platform geo headers exist. The IP is looked
// up in memory and never stored; only the coarse strings below persist.
export type GeoSource = "vercel-headers" | "dev-local" | "geolite2" | "unknown";

/** Coarse, connection-derived geography. Never an address or coordinates. */
export interface AnalyticsGeo {
  country?: string;
  region?: string;
  city?: string;
  source: GeoSource;
}

export interface AnalyticsEvent {
  /** ISO 8601 timestamp, set server-side. */
  ts: string;
  type: "pageview" | "outbound" | "geo-ping";
  /** In-app pathname, e.g. "/eat". */
  path: string;
  /** Random client-generated id (sessionStorage), rotates per browser session. */
  sessionId: string;
  geo: AnalyticsGeo;
  /** Outbound only: destination URL (menu, ordering, map, booking link). */
  href?: string;
  /** Outbound only: human label, e.g. the link text or business name. */
  label?: string;
  /** Geo-ping only: latitude rounded to 3 decimals (~100 m). Never finer. */
  lat?: number;
  /** Geo-ping only: longitude rounded to 3 decimals (~100 m). Never finer. */
  lng?: number;
  /** Geo-ping only: named Kingston area, classified server-side (see AREAS). */
  area?: string;
}

// ---------------------------------------------------------------------------
// Named-area classifier for opt-in geo-pings.
//
// Approximate bounding boxes around downtown Kingston, WA (ferry dock at
// roughly 47.796, -122.496). These are reporting buckets, not survey-grade
// parcels: pings are already rounded to ~100 m, so block-perfect edges would
// be false precision. FIRST MATCH WINS — list specific waterfront spots
// before the broader neighborhoods that surround them.
// ---------------------------------------------------------------------------

export interface AreaBox {
  /** Stable id stored in events and shown on the admin dashboard. */
  id: string;
  /** Reader-friendly label for reports. */
  label: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Fallback bucket for pings inside Kitsap but outside the boxes below. */
export const OUTSIDE_AREA = "outside-uga";
export const OUTSIDE_AREA_LABEL = "Outside the Kingston UGA";

export const AREAS: AreaBox[] = [
  {
    // Ferry dock, tollbooths, and the SR-104 holding lanes.
    id: "ferry-terminal",
    label: "Ferry terminal & holding lanes",
    minLat: 47.793,
    maxLat: 47.798,
    minLng: -122.497,
    maxLng: -122.489,
  },
  {
    // Port of Kingston marina, Mike Wallace Park, Appletree Cove shoreline.
    id: "marina-waterfront",
    label: "Marina & waterfront",
    minLat: 47.796,
    maxLat: 47.803,
    minLng: -122.5,
    maxLng: -122.489,
  },
  {
    // Village Green Community Center, library, and the farmers-market lawn.
    id: "village-green",
    label: "Village Green",
    minLat: 47.798,
    maxLat: 47.806,
    minLng: -122.514,
    maxLng: -122.5,
  },
  {
    // The walkable NE State Hwy 104 business strip west of the tollbooths.
    id: "downtown-104-strip",
    label: "Downtown 104 strip",
    minLat: 47.791,
    maxLat: 47.8,
    minLng: -122.507,
    maxLng: -122.494,
  },
  {
    // Residential Kingston north of the cove — Arness Park, President's Point.
    id: "north-neighborhoods",
    label: "North neighborhoods",
    minLat: 47.8,
    maxLat: 47.83,
    minLng: -122.53,
    maxLng: -122.489,
  },
  {
    // Up the hill west along 104 toward the SR-307 junction and White Horse.
    id: "west-kingston",
    label: "West Kingston",
    minLat: 47.77,
    maxLat: 47.81,
    minLng: -122.57,
    maxLng: -122.507,
  },
];

/** Round a coordinate to 3 decimals (~100 m — about a block). */
export function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Classify a (rounded) coordinate into a named area. First match wins. */
export function classifyArea(lat: number, lng: number): string {
  for (const a of AREAS) {
    if (lat >= a.minLat && lat <= a.maxLat && lng >= a.minLng && lng <= a.maxLng) {
      return a.id;
    }
  }
  return OUTSIDE_AREA;
}

/** Reader-friendly label for an area id (admin dashboard). */
export function areaLabel(area: string): string {
  if (area === OUTSIDE_AREA) return OUTSIDE_AREA_LABEL;
  return AREAS.find((a) => a.id === area)?.label ?? area;
}

export interface AnalyticsSummary {
  totalEvents: number;
  pageviews: number;
  outboundClicks: number;
  /** Opt-in "near me" location pings — a sample, never a census. */
  geoPings: number;
  uniqueSessions: number;
  /** Sorted by count, descending. */
  pageviewsByPath: { path: string; count: number }[];
  /** Outbound clicks grouped by href+label, sorted by count, descending. */
  outboundLinks: { href: string; label: string; count: number }[];
  /** Geo-pings per named Kingston area (see AREAS), sorted by count, descending. */
  geoPingsByArea: { area: string; count: number }[];
  /** Unique sessions per coarse geo bucket, sorted by sessions, descending. */
  sessionsByGeo: {
    country: string;
    region: string;
    city: string;
    source: GeoSource;
    sessions: number;
  }[];
  /** Pacific-time days, ascending. */
  byDay: { day: string; pageviews: number; outboundClicks: number; sessions: number }[];
}

export async function saveEvent(event: AnalyticsEvent): Promise<void> {
  await appendAnalyticsEvent(event);
}

/** Event timestamp -> Kingston-local "YYYY-MM-DD" (mirrors src/lib/time.ts). */
function pacificDay(ts: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(
      new Date(ts),
    );
  } catch {
    return "unknown";
  }
}

export async function summarize(): Promise<AnalyticsSummary> {
  const events = await readAnalyticsEvents<AnalyticsEvent>();

  const sessions = new Set<string>();
  const byPath = new Map<string, number>();
  const byLink = new Map<string, { href: string; label: string; count: number }>();
  const byArea = new Map<string, number>();
  const byGeo = new Map<
    string,
    { country: string; region: string; city: string; source: GeoSource; sessions: Set<string> }
  >();
  const byDay = new Map<
    string,
    { pageviews: number; outboundClicks: number; sessions: Set<string> }
  >();

  let pageviews = 0;
  let outboundClicks = 0;
  let geoPings = 0;

  for (const e of events) {
    sessions.add(e.sessionId);

    if (e.type === "pageview") {
      pageviews++;
      byPath.set(e.path, (byPath.get(e.path) ?? 0) + 1);
    } else if (e.type === "outbound") {
      outboundClicks++;
      const href = e.href ?? "(unknown)";
      const label = e.label ?? "(unlabeled)";
      const key = `${href} ${label}`;
      const entry = byLink.get(key) ?? { href, label, count: 0 };
      entry.count++;
      byLink.set(key, entry);
    } else if (e.type === "geo-ping") {
      geoPings++;
      const area = e.area ?? OUTSIDE_AREA;
      byArea.set(area, (byArea.get(area) ?? 0) + 1);
    }

    const geo = e.geo ?? { source: "unknown" as const };
    const country = geo.country ?? "";
    const region = geo.region ?? "";
    const city = geo.city ?? "";
    const source: GeoSource = geo.source ?? "unknown";
    const geoKey = `${country} ${region} ${city} ${source}`;
    const geoEntry =
      byGeo.get(geoKey) ?? { country, region, city, source, sessions: new Set<string>() };
    geoEntry.sessions.add(e.sessionId);
    byGeo.set(geoKey, geoEntry);

    const day = pacificDay(e.ts);
    const dayEntry = byDay.get(day) ?? {
      pageviews: 0,
      outboundClicks: 0,
      sessions: new Set<string>(),
    };
    if (e.type === "pageview") dayEntry.pageviews++;
    if (e.type === "outbound") dayEntry.outboundClicks++;
    dayEntry.sessions.add(e.sessionId);
    byDay.set(day, dayEntry);
  }

  return {
    totalEvents: events.length,
    pageviews,
    outboundClicks,
    geoPings,
    uniqueSessions: sessions.size,
    pageviewsByPath: [...byPath.entries()]
      .map(([p, count]) => ({ path: p, count }))
      .sort((a, b) => b.count - a.count),
    outboundLinks: [...byLink.values()].sort((a, b) => b.count - a.count),
    geoPingsByArea: [...byArea.entries()]
      .map(([area, count]) => ({ area, count }))
      .sort((a, b) => b.count - a.count),
    sessionsByGeo: [...byGeo.values()]
      .map(({ sessions: s, ...rest }) => ({ ...rest, sessions: s.size }))
      .sort((a, b) => b.sessions - a.sessions),
    byDay: [...byDay.entries()]
      .map(([day, d]) => ({
        day,
        pageviews: d.pageviews,
        outboundClicks: d.outboundClicks,
        sessions: d.sessions.size,
      }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
}
