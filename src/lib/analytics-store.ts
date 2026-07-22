// Privacy-first visitor analytics for the Chamber's LTAC/JLARC reporting.
//
// Append-only Postgres log (analytics_event), same pattern as survey-store.ts,
// via the data layer's append helpers (src/lib/db/append.ts). summarize()
// reads the whole log on every call — fine at Kingston scale (thousands of
// rows); revisit with incremental aggregation if volume ever grows.
//
// What we store, and only this: a timestamp, a pageview/outbound-click/
// geo-ping/consent type, the in-app path, a random client-generated session
// id (sessionStorage, no cookies), coarse geography derived server-side from
// connection headers, for outbound clicks the destination href + label, for
// opt-in geo-pings (the "what's open near me" feature) a NAMED-AREA BUCKET
// ONLY, and for consent grants the notice version consented to.
// No PII, no IP addresses, no user agents, no cookies, no third parties —
// and NO COORDINATES, ever (E11): the route inspects the visitor's rounded
// position transiently to classify the area, then discards it. Geo-pings
// only ever exist because the visitor tapped a location feature, granted the
// in-app consent card, and accepted the browser's permission prompt.
// Outbound taps to food/health-assistance destinations are never stored at
// all (src/lib/privacy/policy.ts SENSITIVE_DESTINATIONS — dropped at the
// ingest trust boundary, no count-only fallback).
//
// IMPORTANT: precise home zip codes canNOT be derived reliably from an IP —
// IP geolocation is city/region-grained at best and often wrong at zip level.
// The anonymous visitor survey (survey-store.ts) remains the only zip source;
// this store answers "roughly where from" and "where did they go".

import { appendAnalyticsEvent, readAnalyticsEvents } from "./db/append";
import { applyKFloor } from "./privacy/k-floor";
import { BELOW_K_BUCKET, BELOW_K_BUCKET_LABEL, K_FLOOR } from "./privacy/policy";

// "dbip" (E10; renamed from "geolite2" on 2026-07-22 with the DB-IP swap):
// coarse geography from the self-hosted DB-IP City Lite file — the source on
// Render, where no platform geo headers exist. The IP is looked up in memory
// and never stored; only the coarse strings below persist.
export type GeoSource = "vercel-headers" | "dev-local" | "dbip" | "unknown";

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
  type: "pageview" | "outbound" | "geo-ping" | "consent" | "webvital";
  /** In-app pathname, e.g. "/eat". */
  path: string;
  /** Random client-generated id (sessionStorage), rotates per browser session. */
  sessionId: string;
  geo: AnalyticsGeo;
  /** Outbound only: destination URL (menu, ordering, map, booking link). */
  href?: string;
  /** Outbound only: human label, e.g. the link text or business name. */
  label?: string;
  /**
   * Geo-ping only: named Kingston area, classified server-side (see AREAS).
   * The ONLY location field — coordinates are inspected transiently at the
   * route and never stored (E11 privacy floor; the ingest test suite is the
   * permanent regression net).
   */
  area?: string;
  /**
   * Consent only: the PRIVACY_NOTICE_VERSION the visitor granted. Proves in
   * aggregate that the consent surface was live and used — never a location.
   */
  noticeVersion?: string;
  /**
   * Consent only: WHICH purpose was granted ("analytics" | "hunt"). Consent is
   * per-purpose (src/lib/privacy/consent.ts), so the aggregate record has to
   * say which one — an analytics grant is not a hunt grant.
   */
  consentPurpose?: string;
  /**
   * Webvital only: which Core Web Vital this row carries (see WEB_VITAL_SPECS).
   *
   * WHY THIS IS NOT A NEW PRIVACY SURFACE: a web vital is a timing produced by
   * the browser about the PAGE, not about the person — no coordinate, no
   * identifier, no device fingerprint, nothing read from the device. It rides
   * the existing anonymous-by-construction store (same ts/path/sessionId/geo
   * envelope every other event already carries) and adds no field that could
   * single anyone out. Geo consent (src/lib/privacy/consent.ts) gates LOCATION
   * — `vk-consent-geo`, purposes "analytics" | "hunt" — so it does not gate
   * this, and deliberately: asking for consent to collect a number that is not
   * about the visitor would misrepresent what the consent card is for.
   */
  metric?: WebVitalMetric;
  /**
   * Webvital only: the measured value — MILLISECONDS for LCP/INP, and a
   * unitless layout-shift score for CLS. Clamped and rounded at the ingest
   * boundary (see the route), never trusted raw from the client.
   */
  value?: number;
  /**
   * Which CLIENT produced this event (E22). Absent means the website, which is
   * every event written before the kiosk existed — so absence has to keep
   * meaning "visitor" forever.
   *
   * "kiosk" is the physical panel at the ferry dock. It is deliberately kept
   * OUT of every visitor rollup below: one shared device that never leaves
   * Kingston is not a visitor, its geo bucket is a constant, and folding it in
   * would quietly inflate exactly the numbers the Chamber reports to LTAC. It
   * gets its own series instead, which is the honest way to answer "is the
   * kiosk earning its place at the dock?".
   */
  source?: "kiosk";
}

/**
 * The Core Web Vitals we record, with the thresholds Google publishes for
 * each. `good`/`poor` are the standard boundaries: at or below `good` is
 * passing, above `poor` is failing, between them is "needs improvement".
 *
 * LCP's 2500ms boundary is the same number as NFR-1 / M-18-02 — which is the
 * whole point of collecting this. The Lighthouse gate measures a SIMULATED lab
 * page load; these rows measure the ferry-queue phone that actually loaded it.
 */
export const WEB_VITAL_SPECS = {
  LCP: { label: "Largest Contentful Paint", unit: "ms", good: 2500, poor: 4000 },
  CLS: { label: "Cumulative Layout Shift", unit: "", good: 0.1, poor: 0.25 },
  INP: { label: "Interaction to Next Paint", unit: "ms", good: 200, poor: 500 },
} as const;

export type WebVitalMetric = keyof typeof WEB_VITAL_SPECS;

export const WEB_VITAL_METRICS = Object.keys(WEB_VITAL_SPECS) as WebVitalMetric[];

/**
 * Below this many samples a percentile is noise, so the dashboard shows the
 * sample count instead of a number that looks authoritative and is not.
 *
 * This is a STATISTICAL floor, not the E11 privacy k-floor (K_FLOOR, which
 * keys on distinct sessions to stop a small geo bucket identifying someone).
 * Kept separate on purpose: timings are not identifying, so borrowing the
 * privacy constant here would blur why each threshold exists.
 */
export const WEB_VITAL_MIN_SAMPLES = 10;

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
  if (area === BELOW_K_BUCKET) return BELOW_K_BUCKET_LABEL;
  return AREAS.find((a) => a.id === area)?.label ?? area;
}

export interface AnalyticsSummary {
  totalEvents: number;
  pageviews: number;
  outboundClicks: number;
  /** Opt-in "near me" location pings — a sample, never a census. */
  geoPings: number;
  /** Geo-consent grants recorded (E11) — the consent surface's audit story. */
  consents: number;
  uniqueSessions: number;
  /** Sorted by count, descending. */
  pageviewsByPath: { path: string; count: number }[];
  /** Outbound clicks grouped by href+label, sorted by count, descending. */
  outboundLinks: { href: string; label: string; count: number }[];
  /**
   * Geo-pings per named Kingston area (see AREAS), sorted by count,
   * descending — k-floored (E11): areas with fewer than K_FLOOR distinct
   * sessions are collapsed into one BELOW_K_BUCKET row, sorted last.
   */
  geoPingsByArea: { area: string; count: number }[];
  /**
   * Unique sessions per coarse geo bucket, sorted by sessions, descending —
   * k-floored (E11): buckets under the floor collapse into one row flagged
   * `collapsed` (render it with the below-threshold label, never a place name).
   */
  sessionsByGeo: {
    country: string;
    region: string;
    city: string;
    source: GeoSource;
    sessions: number;
    collapsed?: boolean;
  }[];
  /** Pacific-time days, ascending. */
  byDay: { day: string; pageviews: number; outboundClicks: number; sessions: number }[];
  /**
   * Core Web Vitals from REAL visitors, one row per metric, in WEB_VITAL_SPECS
   * order. p75 is the Core Web Vitals reporting standard (not the mean — one
   * catastrophic load should not be averaged away, and the median hides the
   * bad quartile the standard is designed to expose).
   */
  webVitals: {
    metric: WebVitalMetric;
    p75: number;
    samples: number;
    /** False until `samples` >= WEB_VITAL_MIN_SAMPLES — render the count, not p75. */
    reportable: boolean;
    rating: "good" | "needs-improvement" | "poor";
  }[];
  /**
   * p75 LCP per page, worst first — answers "which page is slow for real
   * people", which the lab gate cannot (it measures four hand-picked URLs).
   * Only paths clearing WEB_VITAL_MIN_SAMPLES appear.
   */
  lcpByPath: { path: string; p75: number; samples: number }[];
  /**
   * The ferry-dock kiosk, as its OWN series (E22) — never mixed into any field
   * above. `sessions` counts walk-ups, not devices: KioskShell rotates its
   * session id on every idle reset, so one id is roughly one person's visit to
   * the panel. This is the number that answers whether the kiosk is worth its
   * spot, and it is reportable to LTAC without contaminating web visitor counts.
   */
  kiosk: {
    pageviews: number;
    sessions: number;
    /** Which kiosk screens people actually open, most-used first. */
    byPath: { path: string; count: number }[];
  };
}

/**
 * Nearest-rank p75: the smallest value with at least 75% of samples at or
 * below it. Nearest-rank (not interpolated) because it always returns a value
 * a real visitor actually experienced — which is what you want when the next
 * question is always "so how slow was it for them?".
 */
export function percentile75(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(0.75 * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

function rateVital(metric: WebVitalMetric, p75: number): "good" | "needs-improvement" | "poor" {
  const spec = WEB_VITAL_SPECS[metric];
  if (p75 <= spec.good) return "good";
  if (p75 > spec.poor) return "poor";
  return "needs-improvement";
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
  // Per-area DISTINCT SESSIONS ride along with the count — the k-floor keys
  // on sessions, not pings (one person pinging 10 times is still one person).
  const byArea = new Map<string, { count: number; sessions: Set<string> }>();
  const byGeo = new Map<
    string,
    { country: string; region: string; city: string; source: GeoSource; sessions: Set<string> }
  >();
  const byDay = new Map<
    string,
    { pageviews: number; outboundClicks: number; sessions: Set<string> }
  >();

  // Raw web-vital samples, kept as arrays because a percentile needs the whole
  // distribution — you cannot accumulate a p75 the way you accumulate a count.
  const vitalSamples = new Map<WebVitalMetric, number[]>();
  const lcpByPathSamples = new Map<string, number[]>();

  let pageviews = 0;
  let outboundClicks = 0;
  let geoPings = 0;
  let consents = 0;

  // The kiosk's own accumulators. Separate maps, not a flag on the shared ones,
  // so there is no way to accidentally add a kiosk row to a visitor total.
  const kioskSessions = new Set<string>();
  const kioskByPath = new Map<string, number>();
  let kioskPageviews = 0;

  for (const e of events) {
    // THE SPLIT, and it is first for a reason: everything below this line is a
    // visitor rollup, and the kiosk is one shared device standing in one spot.
    // Counting it as a visitor would inflate session counts, pin a geo bucket
    // to the Chamber's own connection, and skew the web-vitals p75 with a
    // machine that reloads itself every fifteen minutes. `continue` guarantees
    // that by construction rather than by remembering to filter in six places.
    if (e.source === "kiosk") {
      kioskSessions.add(e.sessionId);
      if (e.type === "pageview") {
        kioskPageviews++;
        kioskByPath.set(e.path, (kioskByPath.get(e.path) ?? 0) + 1);
      }
      continue;
    }

    sessions.add(e.sessionId);

    if (e.type === "pageview") {
      pageviews++;
      byPath.set(e.path, (byPath.get(e.path) ?? 0) + 1);
    } else if (e.type === "outbound") {
      outboundClicks++;
      const href = e.href ?? "(unknown)";
      const label = e.label ?? "(unlabeled)";
      const key = `${href}\u0000${label}`;
      const entry = byLink.get(key) ?? { href, label, count: 0 };
      entry.count++;
      byLink.set(key, entry);
    } else if (e.type === "geo-ping") {
      geoPings++;
      const area = e.area ?? OUTSIDE_AREA;
      const areaEntry = byArea.get(area) ?? { count: 0, sessions: new Set<string>() };
      areaEntry.count++;
      areaEntry.sessions.add(e.sessionId);
      byArea.set(area, areaEntry);
    } else if (e.type === "consent") {
      consents++;
    } else if (e.type === "webvital") {
      // Defensive: rows written before this event type existed, or by a future
      // client, may lack either field. A summary must never throw on old data.
      const metric = e.metric;
      const value = e.value;
      if (metric && WEB_VITAL_SPECS[metric] && typeof value === "number" && Number.isFinite(value)) {
        const bucket = vitalSamples.get(metric) ?? [];
        bucket.push(value);
        vitalSamples.set(metric, bucket);
        if (metric === "LCP") {
          const pathBucket = lcpByPathSamples.get(e.path) ?? [];
          pathBucket.push(value);
          lcpByPathSamples.set(e.path, pathBucket);
        }
      }
    }

    const geo = e.geo ?? { source: "unknown" as const };
    const country = geo.country ?? "";
    const region = geo.region ?? "";
    const city = geo.city ?? "";
    const source: GeoSource = geo.source ?? "unknown";
    const geoKey = `${country}\u0000${region}\u0000${city}\u0000${source}`;
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

  // K-floor (E11): applied HERE, inside summarize, so every consumer — the
  // admin dashboard, exports, E18 reporting — inherits it. Buckets under
  // K_FLOOR distinct sessions collapse into one below-threshold row, totals
  // preserved, collapsed row sorted last.
  const areaRows = [...byArea.entries()]
    .map(([area, v]) => ({ area, count: v.count, sessionCount: v.sessions.size }))
    .sort((a, b) => b.count - a.count);
  const flooredAreas = applyKFloor(
    areaRows,
    K_FLOOR,
    (r) => r.sessionCount,
    (below) => ({
      area: BELOW_K_BUCKET,
      count: below.reduce((s, r) => s + r.count, 0),
      sessionCount: below.reduce((s, r) => s + r.sessionCount, 0),
    }),
  );

  const geoRows: {
    country: string;
    region: string;
    city: string;
    source: GeoSource;
    sessions: Set<string>;
    collapsed?: boolean;
  }[] = [...byGeo.values()].sort((a, b) => b.sessions.size - a.sessions.size);
  const flooredGeo = applyKFloor(
    geoRows,
    K_FLOOR,
    (r) => r.sessions.size,
    (below) => ({
      country: "",
      region: "",
      city: "",
      source: "unknown" as const,
      // Union, not sum: a session that moved between geo buckets counts once.
      sessions: below.reduce((set, r) => {
        r.sessions.forEach((s) => set.add(s));
        return set;
      }, new Set<string>()),
      collapsed: true,
    }),
  );

  return {
    totalEvents: events.length,
    pageviews,
    outboundClicks,
    geoPings,
    consents,
    uniqueSessions: sessions.size,
    pageviewsByPath: [...byPath.entries()]
      .map(([p, count]) => ({ path: p, count }))
      .sort((a, b) => b.count - a.count),
    outboundLinks: [...byLink.values()].sort((a, b) => b.count - a.count),
    geoPingsByArea: flooredAreas.map(({ area, count }) => ({ area, count })),
    sessionsByGeo: flooredGeo.map(({ sessions: s, ...rest }) => ({
      ...rest,
      sessions: s.size,
    })),
    byDay: [...byDay.entries()]
      .map(([day, d]) => ({
        day,
        pageviews: d.pageviews,
        outboundClicks: d.outboundClicks,
        sessions: d.sessions.size,
      }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    // One row per metric ALWAYS, even with zero samples — a missing row reads
    // as "we forgot to measure", whereas samples: 0 reads as "nobody has sent
    // one yet", which is the honest state right after this ships.
    webVitals: WEB_VITAL_METRICS.map((metric) => {
      const samples = vitalSamples.get(metric) ?? [];
      const p75 = percentile75(samples);
      return {
        metric,
        p75,
        samples: samples.length,
        reportable: samples.length >= WEB_VITAL_MIN_SAMPLES,
        rating: rateVital(metric, p75),
      };
    }),
    lcpByPath: [...lcpByPathSamples.entries()]
      .filter(([, values]) => values.length >= WEB_VITAL_MIN_SAMPLES)
      .map(([path, values]) => ({ path, p75: percentile75(values), samples: values.length }))
      .sort((a, b) => b.p75 - a.p75),
    kiosk: {
      pageviews: kioskPageviews,
      sessions: kioskSessions.size,
      byPath: [...kioskByPath.entries()]
        .map(([path, count]) => ({ path, count }))
        .sort((a, b) => b.count - a.count),
    },
  };
}
