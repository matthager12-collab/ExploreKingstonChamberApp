// Heuristic busyness forecast for the Edmonds–Kingston car ferry.
//
// WSF publishes LIVE data (drive-up space, wait notes) only for the next few
// sailings *today* — there is no API that says how busy a future Saturday will
// be. So this module is an ESTIMATE, not a measurement: a deterministic model
// of the route's well-documented traffic rhythms — directional commute peaks,
// weekend leisure surges, the summer season, and the worst holidays — that lets
// a visitor plan a trip days or weeks out. Every surface that renders it must
// label it an estimate and defer to the live board / WSDOT for the real thing.
//
// It is intentionally PURE and client-safe (no fetch, no env, no server-only
// imports) so the planner can recompute instantly in the browser as the visitor
// drags the time or flips direction, and so SSR and hydration agree.
//
// Calibrated (July 2026) against WSF's own "Best Times to Travel" per-sailing
// vehicle-traffic grid for Summer 2026 — the authoritative day-of-week ×
// departure-time busyness source — cross-checked by adversarial web research.
// Its four tiers map to the score bands here: Unlikely to Fill ≈ Light,
// Sometimes Full ≈ Moderate, Often Full ≈ Busy, Likely Full ≈ Very busy;
// season/holiday multipliers push the worst days into Extreme.
//
// Capacity context: the route normally runs two ~188-vehicle Jumbo-class boats
// (~376 cars/sailing); the car deck — not the passenger cabin — is always the
// binding constraint, which is why walk-ons effectively always board. One case
// this model CAN'T see is a small substitute vessel (e.g. a 64-car boat), which
// causes severe waits on any day; the live board is the authority for that.
// The constants below are the tunable knobs — feed in sailing-space history if
// it's ever collected.

import type { Direction } from "./types";
import { isBoardingPassSeason } from "./boarding-pass-season";

// "from-kingston" = departing Kingston toward Edmonds (eastbound, Seattle side).
// "to-kingston"   = departing Edmonds toward Kingston (westbound, peninsula).
export type TravelMode = "drive" | "walk";
export type BusyLevel = "light" | "moderate" | "busy" | "very-busy" | "extreme";

// Empirical refinement: observed busyness (0–100) per bucket, with a sample
// count. Buckets are direction × season × weekday × hour (see empiricalBucketKey).
// The forecast blends this into its heuristic, weighted by how much data a
// bucket has, so estimates stay heuristic early and grow data-driven over time.
// Built server-side from logged sailing observations (stores/ferry-observations).
export interface EmpiricalBucket {
  /** Observed busyness score 0–100 for this bucket. */
  s: number;
  /** Number of sailing observations behind it (confidence). */
  n: number;
}
export type EmpiricalTable = Record<string, EmpiricalBucket>;

// Blend tuning. Below MIN_SAMPLES a bucket is ignored (too noisy). Weight ramps
// with sample count up to MAX_WEIGHT — capped below 1 so the researched
// heuristic prior always keeps a voice even for well-observed buckets.
export const EMP_MIN_SAMPLES = 3;
const EMP_FULL_CONFIDENCE_N = 40;
const EMP_MAX_WEIGHT = 0.75;

export interface LevelMeta {
  level: BusyLevel;
  label: string;
  /** One-line gist for the summary line. */
  blurb: string;
  /** Tailwind classes for a chip in the app palette. */
  chip: string;
  /** Solid color for the SVG trendline / axis (hex — SVG can't use CSS vars here reliably). */
  hex: string;
}

// Buckets. Normal busy-season peaks top out around "very busy"; "extreme" is
// reserved for holidays and the very worst combinations (holiday × peak hour).
export const LEVELS: Record<BusyLevel, LevelMeta> = {
  light: {
    level: "light",
    label: "Light",
    blurb: "Roll-on odds are excellent — little or no line.",
    chip: "bg-fern/10 text-fern",
    hex: "#2E8B6F",
  },
  moderate: {
    level: "moderate",
    label: "Moderate",
    blurb: "Normal traffic. A short wait is possible at the peak.",
    chip: "bg-tide/10 text-tide-deep",
    hex: "#1E96C0",
  },
  busy: {
    level: "busy",
    label: "Busy",
    blurb: "The car line is building — a wait of about one sailing is likely.",
    chip: "bg-amber-100 text-amber-800",
    hex: "#E0A106",
  },
  "very-busy": {
    level: "very-busy",
    label: "Very busy",
    blurb: "Heavy vehicle demand — a one-to-two boat wait is likely.",
    chip: "bg-orange-100 text-orange-800",
    hex: "#E4682B",
  },
  extreme: {
    level: "extreme",
    label: "Extreme",
    blurb: "Among the worst days of the year — expect multi-hour car waits.",
    chip: "bg-coral/15 text-coral-deep",
    hex: "#D64545",
  },
};

// Operating window drawn on the trendline (minutes since Pacific midnight).
// The car ferry runs ~4:45 AM to ~12:30 AM; 5 AM–midnight captures the shape.
export const DAY_START_MIN = 5 * 60;
export const DAY_END_MIN = 24 * 60;

type DayCategory = "weekday" | "friday" | "saturday" | "sunday";

/**
 * Hourly demand curves (index = hour 0–23), on a 0–100 scale where a natural
 * peak sits near 80 = "very busy". Season and holiday multipliers scale these,
 * and the result is clamped to 100, so only holiday × peak reaches "extreme".
 *
 * The shapes encode the route's directional asymmetry:
 *  - Eastbound (from-kingston) peaks on the weekday MORNING commute to Seattle
 *    jobs, and on the SUNDAY-EVENING return of weekenders to the mainland.
 *  - Westbound (to-kingston) peaks on the weekday EVENING commute home, and
 *    hardest on the FRIDAY-afternoon getaway toward the peninsula.
 */
const CURVES: Record<DayCategory, Record<Direction, number[]>> = {
  weekday: {
    // Eastbound: the loaded direction on the AM commute off the peninsula
    // (6:25/7:55/8:40/9:35 all "Often Full"), plus the 2:30 boat that fills
    // every single day of the week.
    "from-kingston": [0, 0, 0, 0, 40, 55, 62, 60, 62, 60, 45, 42, 44, 48, 78, 72, 52, 46, 38, 30, 22, 16, 10, 6],
    // Westbound: light early AM, an "Often Full" plateau from ~8:50 AM to
    // ~4:45 PM, then evenings are the LIGHTEST period of the day.
    "to-kingston": [2, 0, 0, 0, 6, 20, 20, 32, 44, 58, 58, 58, 58, 60, 60, 64, 60, 44, 28, 20, 16, 12, 8, 5],
  },
  friday: {
    // Eastbound Friday ≈ weekday (AM commute + the 2:30 crunch).
    "from-kingston": [0, 0, 0, 0, 40, 55, 62, 60, 60, 56, 48, 46, 48, 52, 78, 72, 56, 52, 44, 36, 28, 20, 12, 8],
    // Westbound Friday afternoon is the single worst window on the route:
    // near-solid "Likely Full" from ~10 AM to 5:25 PM, then it eases.
    "to-kingston": [2, 0, 0, 0, 6, 22, 24, 38, 50, 62, 76, 78, 62, 74, 80, 82, 80, 74, 48, 32, 24, 18, 12, 8],
  },
  saturday: {
    // Eastbound leisure return builds through midday/afternoon; 2:30 fills.
    "from-kingston": [2, 0, 0, 0, 10, 18, 26, 34, 44, 52, 58, 62, 64, 66, 78, 74, 70, 64, 56, 48, 38, 28, 18, 10],
    // Westbound leisure outbound to the peninsula: late-morning-to-afternoon.
    "to-kingston": [3, 1, 0, 0, 6, 18, 24, 34, 46, 58, 68, 74, 76, 74, 70, 66, 60, 52, 44, 36, 28, 20, 14, 8],
  },
  sunday: {
    // Eastbound is the worst day back to the Seattle side — a long "Likely
    // Full" block from late morning through early evening.
    "from-kingston": [2, 0, 0, 0, 8, 16, 24, 34, 48, 66, 76, 78, 74, 76, 80, 78, 72, 74, 64, 54, 42, 30, 20, 12],
    // Westbound Sunday is lighter (most traffic is heading home east).
    "to-kingston": [2, 0, 0, 0, 5, 14, 20, 28, 38, 46, 52, 54, 54, 52, 50, 48, 46, 44, 40, 34, 28, 22, 14, 8],
  },
};

// Arrive-early buffer (minutes before departure to be in line / at the dock).
// Drivers: scales with the expected vehicle wait. Walk-ons ALWAYS board on this
// route, so their buffer only covers parking and the walk down, plus a margin.
// Drive buffers follow WSF's own arrival guidance: ~20–30 min on ordinary
// weekdays, ~45–60 min on summer weekends, and arrive very early (or walk on)
// for the worst holiday sailings, where the queue can exceed a full boat.
const ARRIVE_EARLY_DRIVE: Record<BusyLevel, number> = {
  light: 20,
  moderate: 35,
  busy: 60,
  "very-busy": 90,
  extreme: 150,
};
// Walk-ons always board on this route, so the buffer only covers parking, the
// walk down, buying a ticket and clearing the turnstile — plus a little margin.
const ARRIVE_EARLY_WALK: Record<BusyLevel, number> = {
  light: 10,
  moderate: 12,
  busy: 15,
  "very-busy": 20,
  extreme: 30,
};

// Driver wait, framed as sailings-bumped (WSF's real-time metric is "drive-up
// spaces left," not a wait time — so the minute ranges are indicative).
const BOAT_WAIT: Record<BusyLevel, string> = {
  light: "You should drive right on — no wait expected.",
  moderate: "Little or no wait — maybe a short hold at the busiest moment.",
  busy: "Expect to wait roughly one sailing (about 30–60 min).",
  "very-busy": "A one-to-two boat wait is likely (roughly 1–2 hours). Arrive early.",
  extreme: "Plan for a multi-sailing, multi-hour wait. Walking on skips the car line entirely.",
};

/** Parsed Pacific calendar parts, timezone-safe from a "YYYY-MM-DD" string. */
interface DateParts {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
  dow: number; // 0=Sun … 6=Sat
}

function parseParts(dateStr: string): DateParts {
  const [year, month, day] = dateStr.split("-").map(Number);
  // Build at UTC midnight so getUTCDay() returns the calendar weekday
  // regardless of the server's own timezone.
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, dow };
}

function dayCategory(dow: number): DayCategory {
  if (dow === 0) return "sunday";
  if (dow === 5) return "friday";
  if (dow === 6) return "saturday";
  return "weekday";
}

/** Weekday (0=Sun) of a specific Gregorian date, timezone-safe. */
function dowOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Last given weekday (0=Sun) in a month — e.g. last Monday of May. */
function lastWeekdayOfMonth(y: number, month: number, weekday: number): number {
  const last = new Date(Date.UTC(y, month, 0)).getUTCDate(); // day 0 of next month
  for (let d = last; d > last - 7; d--) {
    if (dowOf(y, month, d) === weekday) return d;
  }
  return last;
}

/** Nth given weekday (0=Sun) in a month — e.g. 1st Monday of September. */
function nthWeekdayOfMonth(y: number, month: number, weekday: number, n: number): number {
  const firstDow = dowOf(y, month, 1);
  const offset = (weekday - firstDow + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}

/**
 * Seasonal demand multiplier. The route's busy season runs roughly Mother's Day
 * to Indigenous Peoples' Day; deep summer is the true peak. Commute traffic
 * persists year-round, so the off-season floor stays well above zero.
 */
type SeasonTag = "peak" | "shoulder" | "off";

function seasonTag({ month, day }: DateParts): SeasonTag {
  const doy = month * 100 + day; // rough month-day key
  // Peak = WSF's summer schedule window (Jun 14 – Sep 19).
  if (doy >= 614 && doy <= 919) return "peak";
  // Shoulder = the rest of the SR-104 tally season (Mother's Day → mid-Oct).
  if ((doy >= 510 && doy < 614) || (doy > 919 && doy <= 1013)) return "shoulder";
  return "off"; // off-season (weekends still see lines — the day curves carry that)
}

function seasonFactor(parts: DateParts): number {
  const tag = seasonTag(parts);
  return tag === "peak" ? 1.0 : tag === "shoulder" ? 0.82 : 0.58;
}

/**
 * Bucket key for empirical refinement: direction × season × weekday × hour.
 * Both the model (here) and the observation aggregator call this so keys never
 * drift. Season-scoped so summer data can't wrongly inflate a winter estimate.
 */
export function empiricalBucketKey(direction: Direction, dateStr: string, minutes: number): string {
  const parts = parseParts(dateStr);
  const hour = Math.floor(((((minutes % 1440) + 1440) % 1440)) / 60);
  return `${direction}|${seasonTag(parts)}|${parts.dow}|${hour}`;
}

interface Holiday {
  factor: number;
  label: string;
}

/** Holiday surge multiplier (>1) and a human label, or null on an ordinary day. */
function holiday(p: DateParts): Holiday | null {
  const { year: y, month: mo, day: d } = p;

  // Independence Day — the car ferry's worst stretch of the year.
  if (mo === 7 && d === 4) return { factor: 1.5, label: "July 4th — the ferry's worst day of the year" };
  if (mo === 7 && (d === 3 || d === 5)) return { factor: 1.3, label: "Fourth of July holiday traffic" };

  // Memorial Day weekend (Sat–Mon around the last Monday of May).
  const memorial = lastWeekdayOfMonth(y, 5, 1);
  if (mo === 5 && d >= memorial - 2 && d <= memorial) return { factor: 1.3, label: "Memorial Day weekend" };

  // Labor Day weekend (the Friday before through the first Monday of September).
  const labor = nthWeekdayOfMonth(y, 9, 1, 1);
  if (mo === 9 && d >= labor - 3 && d <= labor) return { factor: 1.3, label: "Labor Day weekend" };

  // Thanksgiving — the Wednesday before and Sunday after are the travel crush.
  const thanksgiving = nthWeekdayOfMonth(y, 11, 4, 4); // 4th Thursday
  if (mo === 11 && d >= thanksgiving - 1 && d <= thanksgiving + 3) {
    return { factor: 1.3, label: "Thanksgiving travel" };
  }

  // Christmas / New Year window.
  if ((mo === 12 && d >= 22) || (mo === 1 && d <= 1)) {
    return { factor: 1.2, label: "Holiday-week travel" };
  }
  return null;
}

/**
 * Whether the SR-104 vehicle boarding-pass system is expected to be running at
 * this date/hour. Mirrors getBoardingPassStatus() in wsf.ts (kept in sync by
 * hand so this module stays pure/client-safe): peak hours 8 a.m.–8 p.m., on any
 * weekend, from Mother's Day through Indigenous Peoples' Day, or a major holiday week.
 */
function boardingPassExpected(p: DateParts, hour: number): boolean {
  if (hour < 8 || hour >= 20) return false;
  const isWeekend = p.dow === 0 || p.dow === 6;
  const inSeason = isBoardingPassSeason(p.year, p.month, p.day);
  const holidayWeek =
    (p.month === 11 && p.day >= 22 && p.day <= 30) ||
    (p.month === 12 && p.day >= 22) ||
    (p.month === 1 && p.day <= 2);
  return isWeekend || inSeason || holidayWeek;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Linear-interpolate an hourly curve at a fractional hour. */
function sampleCurve(curve: number[], minutes: number): number {
  const clamped = clamp(minutes, 0, 24 * 60 - 1);
  const h = Math.floor(clamped / 60);
  const frac = (clamped - h * 60) / 60;
  const a = curve[h] ?? 0;
  const b = curve[Math.min(h + 1, 23)] ?? a;
  return a * (1 - frac) + b * frac;
}

export function scoreToLevel(score: number): BusyLevel {
  if (score < 20) return "light";
  if (score < 42) return "moderate";
  if (score < 65) return "busy";
  if (score < 83) return "very-busy";
  return "extreme";
}

/**
 * The 0–100 busyness score for one instant + direction. When an `empirical`
 * table is supplied and the matching bucket has enough observations, the
 * heuristic is blended toward the observed value (weighted by sample count).
 * Holidays skip the blend — their spikes are rare, so bucket averages (mostly
 * ordinary days) would wrongly wash them out; trust the researched heuristic.
 */
export function scoreAt(
  dateStr: string,
  minutes: number,
  direction: Direction,
  empirical?: EmpiricalTable,
): number {
  const parts = parseParts(dateStr);
  const cat = dayCategory(parts.dow);
  const base = sampleCurve(CURVES[cat][direction], minutes);
  const holidayHit = holiday(parts);
  const factor = seasonFactor(parts) * (holidayHit?.factor ?? 1);
  const heuristic = clamp(Math.round(base * factor), 0, 100);

  if (!empirical || holidayHit) return heuristic;
  const bucket = empirical[empiricalBucketKey(direction, dateStr, minutes)];
  if (!bucket || bucket.n < EMP_MIN_SAMPLES) return heuristic;
  const weight = Math.min(bucket.n / EMP_FULL_CONFIDENCE_N, EMP_MAX_WEIGHT);
  return clamp(Math.round(heuristic * (1 - weight) + bucket.s * weight), 0, 100);
}

export interface ForecastPoint {
  /** Minutes since Pacific midnight. */
  minutes: number;
  score: number;
  level: BusyLevel;
}

/**
 * A busiest/quietest window. When the extreme score holds for a stretch — e.g.
 * a holiday plateau clamped at 100 — start and end differ; on an ordinary day
 * they're equal (a single time).
 */
export interface DayExtreme {
  startMin: number;
  endMin: number;
  score: number;
  level: BusyLevel;
}

/**
 * The busyness trendline for one day and direction, sampled every 30 min across
 * the operating window, plus the quietest and busiest WINDOWS (first→last time
 * at the min/max score) so the tips read honestly when the peak is a plateau.
 */
export function dayCurve(
  dateStr: string,
  direction: Direction,
  empirical?: EmpiricalTable,
  stepMin = 30,
): { points: ForecastPoint[]; quietest: DayExtreme; busiest: DayExtreme } {
  const points: ForecastPoint[] = [];
  for (let m = DAY_START_MIN; m <= DAY_END_MIN; m += stepMin) {
    const score = scoreAt(dateStr, m, direction, empirical);
    points.push({ minutes: m, score, level: scoreToLevel(score) });
  }
  let minScore = points[0].score;
  let maxScore = points[0].score;
  for (const p of points) {
    if (p.score < minScore) minScore = p.score;
    if (p.score > maxScore) maxScore = p.score;
  }
  const windowAt = (target: number): DayExtreme => {
    const hits = points.filter((p) => p.score === target);
    return {
      startMin: hits[0].minutes,
      endMin: hits[hits.length - 1].minutes,
      score: target,
      level: scoreToLevel(target),
    };
  };
  return { points, quietest: windowAt(minScore), busiest: windowAt(maxScore) };
}

export interface ForecastAt {
  score: number;
  level: BusyLevel;
  levelMeta: LevelMeta;
  /** Minutes before departure to be in line (drive) or at the dock (walk). */
  arriveEarlyMinutes: number;
  /** Driver-facing wait expectation. */
  boatWait: string;
  boardingPassActive: boolean;
  /** Short human-readable drivers of the estimate, most important first. */
  factors: string[];
  /** True when logged observations meaningfully shaped this score. */
  empiricalApplied: boolean;
  /** Observation count behind the score when empiricalApplied. */
  empiricalSamples: number;
}

/** The full forecast for a specific departure time, direction and travel mode. */
export function forecastAt(
  dateStr: string,
  minutes: number,
  direction: Direction,
  mode: TravelMode,
  empirical?: EmpiricalTable,
): ForecastAt {
  const parts = parseParts(dateStr);
  const hour = Math.floor(minutes / 60);
  const score = scoreAt(dateStr, minutes, direction, empirical);
  const level = scoreToLevel(score);
  const boardingPassActive = boardingPassExpected(parts, hour);

  // Mirror scoreAt's blend gate so the UI can report when the score is data-backed.
  const bucket =
    empirical && !holiday(parts) ? empirical[empiricalBucketKey(direction, dateStr, minutes)] : undefined;
  const empiricalApplied = !!bucket && bucket.n >= EMP_MIN_SAMPLES;

  return {
    score,
    level,
    levelMeta: LEVELS[level],
    arriveEarlyMinutes: (mode === "drive" ? ARRIVE_EARLY_DRIVE : ARRIVE_EARLY_WALK)[level],
    boatWait: BOAT_WAIT[level],
    boardingPassActive,
    factors: explainFactors(parts, hour, direction, boardingPassActive),
    empiricalApplied,
    empiricalSamples: empiricalApplied ? bucket!.n : 0,
  };
}

/** Build the "why" chips for a forecast, most significant first. */
function explainFactors(
  parts: DateParts,
  hour: number,
  direction: Direction,
  boardingPassActive: boolean,
): string[] {
  const out: string[] = [];
  const h = holiday(parts);
  if (h) out.push(h.label);

  const cat = dayCategory(parts.dow);
  const eastbound = direction === "from-kingston";

  if (cat === "weekday") {
    if (eastbound && hour >= 5 && hour <= 9) out.push("Weekday morning commute off the peninsula");
    else if (!eastbound && hour >= 9 && hour <= 16) out.push("Weekday midday–afternoon peak toward the peninsula");
  } else if (cat === "friday") {
    if (!eastbound && hour >= 10 && hour <= 17) out.push("Friday getaway to the peninsula — the route's busiest window");
    else if (eastbound && hour >= 5 && hour <= 9) out.push("Weekday morning commute off the peninsula");
  } else if (cat === "sunday") {
    if (eastbound && hour >= 10 && hour <= 18) out.push("Sunday return to the Seattle side — the worst eastbound day");
    else out.push("Weekend leisure travel");
  } else if (cat === "saturday") {
    out.push("Weekend leisure travel");
  }

  // The 2:30 PM Kingston→Edmonds boat is "Likely Full" every day of the week.
  if (eastbound && hour === 14) out.push("The 2:30 boat fills nearly every day");

  const sf = seasonFactor(parts);
  if (sf >= 1) out.push("Peak summer season");
  else if (sf >= 0.8) out.push("Shoulder-season travel");

  if (boardingPassActive) out.push("SR-104 vehicle boarding pass in effect");

  return out;
}

/** "HH:mm" (24h, Pacific wall time) → minutes since midnight. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes since midnight → "HH:mm" (24h). */
export function minutesToHhmm(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Minutes since midnight → friendly "6:25 AM" label. */
export function minutesToLabel(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  let h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(min).padStart(2, "0")} ${ampm}`;
}
