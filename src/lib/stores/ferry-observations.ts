// Ferry observation log — the data that lets the trip planner learn over time.
//
// WSF exposes live "drive-up spaces remaining" per upcoming sailing and a live
// per-direction delay, but never ARCHIVES either. So we snapshot them (throttled)
// from the same feed the ferry pages already fetch, append them here, and
// aggregate them into an empirical busyness table the forecast blends in
// (src/lib/ferry-forecast). Append-only Postgres log (ferry_observation) via
// the data layer's append helpers (src/lib/db/append.ts); retention pruning
// keeps the row count bounded.
//
// Scope: Edmonds–Kingston only (terminals 8/12), matching the planner.

import {
  appendFerryObservation,
  latestFerryObservationTs,
  pruneFerryObservationsBefore,
  readFerryObservations,
} from "../db/append";
import type { Direction } from "../types";
import type { SailingSpace, RouteDelays } from "../wsf";
import {
  empiricalBucketKey,
  scoreAt,
  scoreToLevel,
  type BusyLevel,
  type EmpiricalTable,
} from "../ferry-forecast";
import { readMerged, writeOverlayRecord, type WriteMeta } from "./json-store";

const TZ = "America/Los_Angeles";

// Snapshot at most this often (any process): the pages poll every 60s and many
// tabs can be open, but ~10 min captures the fill trajectory without flooding.
const THROTTLE_MS = 10 * 60 * 1000;
// Record the next couple of upcoming sailings per direction (near-term space is
// the meaningful signal; further-out sailings barely move).
const SAILINGS_PER_DIR = 2;
const RETENTION_DAYS = 90;
const PRUNE_EVERY = 48; // prune roughly every ~8h of snapshots
const CACHE_TTL_MS = 10 * 60 * 1000; // aggregate cache

/** One logged snapshot of a single Edmonds–Kingston sailing. */
export interface FerryObservation {
  /** When this snapshot was taken (ISO). */
  ts: string;
  dir: Direction;
  /** The sailing's scheduled departure (ISO) — its identity across snapshots. */
  departs: string;
  /** Drive-up car spaces still open at ts (null when WSF isn't reporting). */
  driveUp: number | null;
  /** Total drive-up capacity for the sailing (null when unknown). */
  max: number | null;
  /** That direction's live delay in minutes at ts (only on the soonest sailing). */
  delayMin: number | null;
}

export interface EmpiricalResult {
  table: EmpiricalTable;
  /** Total sailing snapshots with usable fullness behind the table. */
  sampleCount: number;
  /** Distinct Pacific days we've collected on. */
  days: number;
  updatedAt: string;
}

let lastRecordAt = 0;
let writesSincePrune = 0;
let aggCache: { at: number; value: EmpiricalResult } | null = null;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** ISO instant → Kingston-local date "YYYY-MM-DD" + minutes-since-midnight. */
function pacificParts(iso: string): { date: string; minutes: number } {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  const t = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (x: string) => Number(t.find((p) => p.type === x)?.value ?? 0);
  return { date, minutes: get("hour") * 60 + get("minute") };
}

/**
 * Snapshot current Edmonds–Kingston sailing fullness + delay, throttled to at
 * most one write per THROTTLE_MS. Best-effort and fire-and-forget from the
 * status pipeline — callers should not await it on a user's critical path.
 * Returns true when it actually wrote.
 */
export async function recordSailingSpaceSnapshot(
  space: { kingston: SailingSpace[]; edmonds: SailingSpace[] },
  delays: RouteDelays,
): Promise<boolean> {
  const now = Date.now();
  if (now - lastRecordAt < THROTTLE_MS) return false;
  lastRecordAt = now; // claim the slot synchronously so concurrent polls don't double-write

  const ts = new Date(now).toISOString();
  const build = (list: SailingSpace[], dir: Direction, delay: number | null): FerryObservation[] =>
    list.slice(0, SAILINGS_PER_DIR).map((s, i) => ({
      ts,
      dir,
      departs: s.departs,
      driveUp: s.driveUpSpaces,
      max: s.maxSpaces,
      delayMin: i === 0 ? delay : null,
    }));

  const observations: FerryObservation[] = [
    // Leaving Kingston = eastbound = "from-kingston".
    ...build(space.kingston, "from-kingston", delays.fromKingston),
    // Leaving Edmonds = westbound = "to-kingston".
    ...build(space.edmonds, "to-kingston", delays.toKingston),
  ];
  if (observations.length === 0) return false;

  for (const obs of observations) {
    await appendFerryObservation(obs);
  }

  aggCache = null; // fresh data — let the next read recompute
  if (++writesSincePrune >= PRUNE_EVERY) {
    writesSincePrune = 0;
    void prune(now).catch(() => {});
  }
  return true;
}

async function readObservations(): Promise<FerryObservation[]> {
  return readFerryObservations<FerryObservation>();
}

/**
 * Aggregate logged observations into the empirical busyness table the forecast
 * blends in: per direction × season × weekday × hour, the mean observed
 * fullness (0–100) nudged up a little by mean delay. Cached briefly so repeated
 * forecasts don't rescan the log.
 */
export async function getEmpiricalBusyness(): Promise<EmpiricalResult> {
  if (aggCache && Date.now() - aggCache.at < CACHE_TTL_MS) return aggCache.value;

  const observations = await readObservations();
  const acc = new Map<string, { sumFull: number; nFull: number; sumDelay: number; nDelay: number }>();
  const days = new Set<string>();
  let sampleCount = 0;

  for (const o of observations) {
    const at = pacificParts(o.departs);
    const key = empiricalBucketKey(o.dir, at.date, at.minutes);
    const entry = acc.get(key) ?? { sumFull: 0, nFull: 0, sumDelay: 0, nDelay: 0 };

    if (typeof o.max === "number" && o.max > 0 && typeof o.driveUp === "number" && o.driveUp >= 0) {
      entry.sumFull += clamp01(1 - o.driveUp / o.max) * 100;
      entry.nFull += 1;
      sampleCount += 1;
    }
    if (typeof o.delayMin === "number" && o.delayMin > 0) {
      entry.sumDelay += o.delayMin;
      entry.nDelay += 1;
    }
    acc.set(key, entry);
    days.add(pacificParts(o.ts).date);
  }

  const table: EmpiricalTable = {};
  for (const [key, e] of acc) {
    if (e.nFull === 0) continue; // need at least one fullness reading for a score
    const meanFull = e.sumFull / e.nFull;
    // A modest delay bump: a chronically late direction is a busier one, but
    // fullness is the primary signal — cap the boost at +12 for a 30-min mean.
    const delayBoost = e.nDelay > 0 ? (Math.min(e.sumDelay / e.nDelay, 30) / 30) * 12 : 0;
    table[key] = { s: Math.max(0, Math.min(100, Math.round(meanFull + delayBoost))), n: e.nFull };
  }

  const value: EmpiricalResult = {
    table,
    sampleCount,
    days: days.size,
    updatedAt: new Date().toISOString(),
  };
  aggCache = { at: Date.now(), value };
  return value;
}

/** Drop observations older than the retention window. Best-effort. */
async function prune(nowMs: number): Promise<void> {
  const cutoff = nowMs - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  await pruneFerryObservationsBefore(new Date(cutoff).toISOString());
}

// ---- Accuracy backtest -----------------------------------------------------
//
// How good is the forecast? For each logged sailing we compare the model's
// HEURISTIC prediction (no empirical blend — that would be grading on data it
// learned from) against what actually happened (observed fullness), and roll it
// up into error + level-agreement metrics. The daily accuracy cron records a
// snapshot so the Chamber can watch the number before trusting the feature.

const LEVEL_ORDER: BusyLevel[] = ["light", "moderate", "busy", "very-busy", "extreme"];
const ACCURACY_STORE = "ferry-accuracy";
const ACCURACY_ID = "latest";

export interface AccuracyMetrics {
  /** Sailings evaluated (observations with a usable fullness reading). */
  n: number;
  /** Mean absolute error, 0–100 busyness points. Lower is better. */
  mae: number;
  /** Root-mean-square error, 0–100. Punishes big misses. */
  rmse: number;
  /** Mean(predicted − observed): + = the model runs high, − = it runs low. */
  bias: number;
  /** Fraction (0–1) where the predicted busyness LEVEL matched the observed one. */
  levelMatchRate: number;
  /** Fraction (0–1) within one level of the observed one. */
  within1Rate: number;
  /** Distinct Pacific days behind the sample. */
  spanDays: number;
  computedAt: string;
}

interface AccuracyRecord {
  id: typeof ACCURACY_ID;
  latest: AccuracyMetrics | null;
  history: AccuracyMetrics[];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Score each logged sailing's heuristic prediction against what was observed. */
export async function computeAccuracy(): Promise<AccuracyMetrics> {
  const observations = await readObservations();
  const days = new Set<string>();
  let n = 0;
  let sumAbs = 0;
  let sumSq = 0;
  let sumBias = 0;
  let exact = 0;
  let within1 = 0;

  for (const o of observations) {
    if (!(typeof o.max === "number" && o.max > 0 && typeof o.driveUp === "number" && o.driveUp >= 0)) {
      continue;
    }
    const at = pacificParts(o.departs);
    const observed = Math.round(clamp01(1 - o.driveUp / o.max) * 100);
    const predicted = scoreAt(at.date, at.minutes, o.dir); // heuristic only — honest out-of-sample test
    const err = predicted - observed;

    n += 1;
    sumAbs += Math.abs(err);
    sumSq += err * err;
    sumBias += err;
    const pi = LEVEL_ORDER.indexOf(scoreToLevel(predicted));
    const oi = LEVEL_ORDER.indexOf(scoreToLevel(observed));
    if (pi === oi) exact += 1;
    if (Math.abs(pi - oi) <= 1) within1 += 1;
    days.add(pacificParts(o.ts).date);
  }

  return {
    n,
    mae: n ? round1(sumAbs / n) : 0,
    rmse: n ? round1(Math.sqrt(sumSq / n)) : 0,
    bias: n ? round1(sumBias / n) : 0,
    levelMatchRate: n ? Math.round((exact / n) * 100) / 100 : 0,
    within1Rate: n ? Math.round((within1 / n) * 100) / 100 : 0,
    spanDays: days.size,
    computedAt: new Date().toISOString(),
  };
}

/** Compute accuracy now and append it to the rolling history (kept ~60 runs). */
export async function recordAccuracySnapshot(meta?: WriteMeta): Promise<AccuracyMetrics> {
  const metrics = await computeAccuracy();
  const rows = await readMerged<AccuracyRecord>(ACCURACY_STORE, []);
  const existing = rows.find((r) => r.id === ACCURACY_ID);
  const history = [...(existing?.history ?? []), metrics].slice(-60);
  await writeOverlayRecord<AccuracyRecord>(
    ACCURACY_STORE,
    {
      id: ACCURACY_ID,
      latest: metrics,
      history,
    },
    meta,
  );
  return metrics;
}

/** The latest accuracy snapshot + recent history, for the admin panel. */
export async function getAccuracy(): Promise<{ latest: AccuracyMetrics | null; history: AccuracyMetrics[] }> {
  const rows = await readMerged<AccuracyRecord>(ACCURACY_STORE, []);
  const rec = rows.find((r) => r.id === ACCURACY_ID);
  return { latest: rec?.latest ?? null, history: rec?.history ?? [] };
}

/** ISO timestamp of the most recent logged observation, or null when the
 *  observe cron has never produced a row — the ops dashboard's freshness read.
 *  A thin wrapper so callers outside the data layer never import the DB client
 *  directly (the eslint/dependency-cruiser boundary). */
export async function latestObservationAt(): Promise<string | null> {
  return latestFerryObservationTs();
}
