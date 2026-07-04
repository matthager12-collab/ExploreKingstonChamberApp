// WSDOT Ferries API adapter (Edmonds–Kingston route).
//
// Live mode uses the free WSDOT access code in the WSDOT_API_KEY env var:
// sign up at https://wsdot.wa.gov/traffic/api/ — instant, no cost. The key
// rides in the URL query string, so these calls must stay server-side.
// Without a key, every function falls back to the bundled seasonal schedule
// in ./data/ferry-fallback so the app still works, marked live:false.
//
// API facts verified 2026-07-02 (see docs/DATA_SOURCES.md):
// Edmonds TerminalID = 8, Kingston TerminalID = 12, Ed-King RouteID = 6.
// Dates are WCF "/Date(ms-0700)/" strings. No published rate limits —
// self-throttle via fetch revalidation and be a good citizen.

import type { Sailing, TerminalStatus } from "./types";
import { fallbackSailings } from "./data/ferry-fallback";

const API_KEY = process.env.WSDOT_API_KEY;

export const TERMINAL_IDS = { edmonds: 8, kingston: 12 } as const;
export const ED_KING_ROUTE_ID = 6;

const SCHEDULE_BASE = "https://www.wsdot.wa.gov/ferries/api/schedule/rest";
const TERMINALS_BASE = "https://www.wsdot.wa.gov/ferries/api/terminals/rest";
const VESSELS_BASE = "https://www.wsdot.wa.gov/ferries/api/vessels/rest";

/** Terminal coordinates for the live vessel map (verified against WSF GTFS). */
export const TERMINAL_COORDS = {
  edmonds: { lat: 47.8125, lng: -122.3829, name: "Edmonds" },
  kingston: { lat: 47.7963, lng: -122.4965, name: "Kingston" },
} as const;

/** Unwrap WCF "/Date(1719936000000-0700)/" strings to ISO 8601. */
function parseWsdotDate(raw: string): string {
  const match = /\/Date\((\d+)(?:[-+]\d{4})?\)\//.exec(raw);
  if (!match) return raw;
  return new Date(Number(match[1])).toISOString();
}

async function wsfFetch<T>(url: string, revalidateSeconds: number): Promise<T | null> {
  if (!API_KEY) return null;
  try {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}apiaccesscode=${API_KEY}`, {
      next: { revalidate: revalidateSeconds },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface WsfScheduleTime {
  DepartingTime: string;
  ArrivingTime: string | null;
  VesselName: string;
}

interface WsfScheduleResponse {
  TerminalCombos: {
    DepartingTerminalID: number;
    Times: WsfScheduleTime[];
  }[];
}

/**
 * Today's Edmonds–Kingston sailings in both directions via /scheduletoday
 * (no date math, WSDOT handles the seasonal schedule). Falls back to the
 * bundled schedule when the API is unreachable or no key is set.
 */
export async function getTodaysSailings(): Promise<{ sailings: Sailing[]; live: boolean }> {
  const [toKingston, toEdmonds] = await Promise.all([
    wsfFetch<WsfScheduleResponse>(
      `${SCHEDULE_BASE}/scheduletoday/${TERMINAL_IDS.edmonds}/${TERMINAL_IDS.kingston}/false`,
      900,
    ),
    wsfFetch<WsfScheduleResponse>(
      `${SCHEDULE_BASE}/scheduletoday/${TERMINAL_IDS.kingston}/${TERMINAL_IDS.edmonds}/false`,
      900,
    ),
  ]);

  if (toKingston && toEdmonds) {
    const toSailings = (r: WsfScheduleResponse, direction: Sailing["direction"]): Sailing[] =>
      r.TerminalCombos.flatMap((combo) =>
        combo.Times.map((t) => ({
          route: "edmonds-kingston" as const,
          direction,
          departs: parseWsdotDate(t.DepartingTime),
          arrives: t.ArrivingTime ? parseWsdotDate(t.ArrivingTime) : undefined,
          vessel: t.VesselName,
        })),
      );
    return {
      sailings: [
        ...toSailings(toKingston, "to-kingston"),
        ...toSailings(toEdmonds, "from-kingston"),
      ],
      live: true,
    };
  }
  return { sailings: fallbackSailings(), live: false };
}

interface WsfSpaceResponse {
  DepartingSpaces: {
    Departure: string;
    SpaceForArrivalTerminals: { DriveUpSpaceCount: number | null }[];
  }[];
}

interface WsfWaitTimeResponse {
  WaitTimes: { RouteID: number | null; WaitTimeNotes: string | null }[];
}

/**
 * Live drive-up space for the next departure plus staff-entered wait notes.
 * Ed-King has no vehicle reservations, so drive-up space is the number that
 * matters. DriveUpSpaceCount can be -1/null when unavailable.
 */
export async function getTerminalStatus(
  terminal: keyof typeof TERMINAL_IDS,
): Promise<TerminalStatus> {
  const base: TerminalStatus = {
    terminal,
    alerts: [],
    live: false,
    asOf: new Date().toISOString(),
  };

  const [space, waits] = await Promise.all([
    wsfFetch<WsfSpaceResponse>(`${TERMINALS_BASE}/terminalsailingspace/${TERMINAL_IDS[terminal]}`, 60),
    wsfFetch<WsfWaitTimeResponse>(`${TERMINALS_BASE}/terminalwaittimes/${TERMINAL_IDS[terminal]}`, 300),
  ]);
  if (!space) return base;

  const count = space.DepartingSpaces?.[0]?.SpaceForArrivalTerminals?.[0]?.DriveUpSpaceCount;
  const waitNote =
    waits?.WaitTimes?.find((w) => w.RouteID === ED_KING_ROUTE_ID && w.WaitTimeNotes)
      ?.WaitTimeNotes ?? undefined;
  return {
    ...base,
    live: true,
    driveUpSpaces: typeof count === "number" && count >= 0 ? count : undefined,
    waitEstimate: waitNote ?? undefined,
  };
}

interface WsfAlert {
  AlertFullTitle: string;
  AllRoutesFlag: boolean;
  AffectedRouteIDs: number[] | null;
}

interface WsfVessel {
  VesselName: string;
  Latitude: number | null;
  Longitude: number | null;
  Speed: number | null;
  Heading: number | null;
  InService: boolean;
  AtDock: boolean;
  DepartingTerminalID: number | null;
  ArrivingTerminalID: number | null;
  ArrivingTerminalName: string | null;
  Eta: string | null;
  /** WCF date the boat was scheduled to leave its departing terminal. */
  ScheduledDeparture: string | null;
  /** WCF date the boat actually left the dock (null while still docked). */
  LeftDock: string | null;
}

interface WsfSailingSpaceFull {
  DepartingSpaces: {
    Departure: string;
    VesselName: string;
    MaxSpaceCount: number | null;
    SpaceForArrivalTerminals: {
      TerminalID: number;
      DriveUpSpaceCount: number | null;
    }[];
  }[];
}

/** Open drive-up car space on one upcoming Edmonds–Kingston departure. */
export interface SailingSpace {
  /** ISO 8601 departure time */
  departs: string;
  vessel: string;
  /** Drive-up spaces still open (null when WSF isn't reporting a count). */
  driveUpSpaces: number | null;
  maxSpaces: number | null;
}

/**
 * Per-departure open car space leaving a terminal, for the upcoming sailings.
 * This is what powers the "N car spots open" line per sailing — richer than
 * getTerminalStatus, which only reports the very next boat.
 */
export async function getSailingSpace(
  from: keyof typeof TERMINAL_IDS,
): Promise<SailingSpace[]> {
  const data = await wsfFetch<WsfSailingSpaceFull>(
    `${TERMINALS_BASE}/terminalsailingspace/${TERMINAL_IDS[from]}`,
    60,
  );
  if (!data?.DepartingSpaces) return [];
  const arrivalId = from === "kingston" ? TERMINAL_IDS.edmonds : TERMINAL_IDS.kingston;
  return data.DepartingSpaces.map((d) => {
    const space =
      d.SpaceForArrivalTerminals.find((s) => s.TerminalID === arrivalId) ??
      d.SpaceForArrivalTerminals[0];
    const count = space?.DriveUpSpaceCount;
    return {
      departs: parseWsdotDate(d.Departure),
      vessel: d.VesselName,
      driveUpSpaces: typeof count === "number" && count >= 0 ? count : null,
      maxSpaces: d.MaxSpaceCount ?? null,
    };
  });
}

export interface RouteDelays {
  /** Minutes the next Edmonds→Kingston boat is running late (0 = on time). */
  toKingston: number | null;
  /** Minutes the next Kingston→Edmonds boat is running late. */
  fromKingston: number | null;
}

/**
 * Live delay per direction, computed from the vessels feed: how late the boat
 * currently working that direction actually left the dock (LeftDock −
 * ScheduledDeparture), or — if it's still docked past its scheduled time — how
 * late it is right now. null when on time or no live data.
 */
export async function getRouteDelays(): Promise<RouteDelays> {
  const data = await wsfFetch<WsfVessel[]>(`${VESSELS_BASE}/vessellocations`, 30);
  const result: RouteDelays = { toKingston: null, fromKingston: null };
  if (!data) return result;
  const now = Date.now();
  const routeTerminals: number[] = [TERMINAL_IDS.edmonds, TERMINAL_IDS.kingston];

  for (const v of data) {
    if (!v.InService || !v.ScheduledDeparture) continue;
    const onRoute =
      routeTerminals.includes(v.DepartingTerminalID ?? -1) &&
      routeTerminals.includes(v.ArrivingTerminalID ?? -1);
    if (!onRoute) continue;

    const scheduled = Date.parse(parseWsdotDate(v.ScheduledDeparture));
    let lateMs: number;
    if (v.LeftDock) {
      lateMs = Date.parse(parseWsdotDate(v.LeftDock)) - scheduled;
    } else if (v.AtDock && now > scheduled) {
      lateMs = now - scheduled; // still sitting at the dock past its time
    } else {
      continue;
    }
    const lateMin = Math.round(lateMs / 60_000);
    // Direction: departing Edmonds (8) → arriving Kingston (12) is "to Kingston".
    const dir = v.DepartingTerminalID === TERMINAL_IDS.edmonds ? "toKingston" : "fromKingston";
    // Keep the largest delay seen for that direction (the boat about to sail).
    if (result[dir] === null || lateMin > (result[dir] as number)) {
      result[dir] = Math.max(0, lateMin);
    }
  }
  return result;
}

const PACIFIC = "America/Los_Angeles";

export interface BoardingPassStatus {
  /** Whether the SR-104 vehicle boarding-pass system should be treated as on now. */
  active: boolean;
  reason: string;
  /**
   * Where this verdict came from: "estimate" = the hours/season heuristic below;
   * "override" = a Chamber-staff toggle set for today (see boarding-pass-store).
   */
  source: "estimate" | "override";
}

/**
 * Estimate whether Kingston's SR-104 vehicle boarding-pass system is in effect
 * right now: peak hours 8 a.m.–8 p.m. Pacific, on any weekend year-round or any
 * day during the summer season (≈ mid-May to mid-October) or the big holiday
 * weeks. This is an ESTIMATE for routing/UX — the flashing advisory sign at
 * Barber Cutoff Rd is always the authority (and the admin-editable "machine
 * down" note covers current exceptions). A same-day admin override
 * (getEffectiveBoardingPass) can replace this verdict when staff know better.
 */
export function getBoardingPassStatus(now: Date = new Date()): BoardingPassStatus {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC,
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  const month = Number(get("month"));
  const day = Number(get("day"));
  const hour = Number(get("hour"));

  const peakHours = hour >= 8 && hour < 20;
  if (!peakHours) {
    return {
      active: false,
      reason: "Outside peak hours (8 a.m.–8 p.m.) — no boarding pass needed.",
      source: "estimate",
    };
  }

  const isWeekend = weekday === "Sat" || weekday === "Sun";
  // Season ≈ 2nd Sun of May → Indigenous Peoples' Day (mid-Oct). Approximate by
  // May 10–Oct 13 so a driver is warned across the whole busy stretch.
  const inSeason =
    (month === 5 && day >= 10) || (month > 5 && month < 10) || (month === 10 && day <= 13);
  // Holiday weeks: late Nov (Thanksgiving) and late Dec–early Jan.
  const holidayWeek =
    (month === 11 && day >= 22 && day <= 30) ||
    (month === 12 && day >= 22) ||
    (month === 1 && day <= 2);

  if (isWeekend)
    return { active: true, reason: "Weekend peak hours — boarding pass likely in effect.", source: "estimate" };
  if (inSeason)
    return { active: true, reason: "Summer season, peak hours — boarding pass likely in effect.", source: "estimate" };
  if (holidayWeek)
    return { active: true, reason: "Holiday week, peak hours — boarding pass likely in effect.", source: "estimate" };
  return { active: false, reason: "Off-season weekday — boarding pass usually not needed.", source: "estimate" };
}

/**
 * The Pacific calendar day as "YYYY-MM-DD". A boarding-pass override is scoped to
 * one of these strings; once the Pacific day rolls over, the stored day no longer
 * matches and the override quietly expires back to the estimate — no timers, no
 * DST math. Assembled from typed parts so it's independent of locale formatting.
 */
export function pacificDayString(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PACIFIC,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export interface VesselPosition {
  name: string;
  lat: number;
  lng: number;
  /** knots */
  speed: number;
  /** compass degrees */
  heading: number;
  atDock: boolean;
  inService: boolean;
  headedTo?: string;
  /** ISO 8601 arrival estimate */
  eta?: string;
}

/**
 * Live positions of the Edmonds–Kingston vessels (WSDOT VesselWatch data).
 * Filters the fleet to boats whose current run touches terminal 8 or 12.
 * Empty + live:false when no API key is set or the service is unreachable —
 * the map then points visitors to WSDOT's own VesselWatch.
 */
export async function getVesselLocations(): Promise<{ vessels: VesselPosition[]; live: boolean }> {
  const data = await wsfFetch<WsfVessel[]>(`${VESSELS_BASE}/vessellocations`, 10);
  if (!data) return { vessels: [], live: false };

  const routeTerminals: number[] = [TERMINAL_IDS.edmonds, TERMINAL_IDS.kingston];
  const onRoute = data.filter(
    (v) =>
      v.Latitude != null &&
      v.Longitude != null &&
      (routeTerminals.includes(v.DepartingTerminalID ?? -1) ||
        routeTerminals.includes(v.ArrivingTerminalID ?? -1)),
  );

  return {
    vessels: onRoute.map((v) => ({
      name: v.VesselName,
      lat: v.Latitude as number,
      lng: v.Longitude as number,
      speed: v.Speed ?? 0,
      heading: v.Heading ?? 0,
      atDock: Boolean(v.AtDock),
      inService: v.InService !== false,
      headedTo: v.ArrivingTerminalName ?? undefined,
      eta: v.Eta ? parseWsdotDate(v.Eta) : undefined,
    })),
    live: true,
  };
}

/** Current WSF service alerts affecting the Edmonds–Kingston route. */
export async function getRouteAlerts(): Promise<string[]> {
  const alerts = await wsfFetch<WsfAlert[]>(`${SCHEDULE_BASE}/alerts`, 300);
  if (!alerts) return [];
  return alerts
    .filter((a) => a.AllRoutesFlag || a.AffectedRouteIDs?.includes(ED_KING_ROUTE_ID))
    .map((a) => a.AlertFullTitle);
}
