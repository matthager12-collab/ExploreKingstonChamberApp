// computeDailyAccuracy() decomposes the accuracy backtest by day so the admin
// trend chart has something that can actually move (the stored `history` is a
// running average over the whole retention window, so it flattens out).
//
// The decomposition has to be FAITHFUL: fold the daily buckets back up and you
// must land exactly on computeAccuracy()'s numbers. These suites pin that, plus
// the two things easy to get subtly wrong — bucketing by departure day rather
// than snapshot day, and a running average that's weighted by each day's sample
// count instead of being a mean-of-means.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../setup/pglite-db";
import { appendFerryObservation } from "@/lib/db/append";
import {
  computeAccuracy,
  computeDailyAccuracy,
  type FerryObservation,
} from "@/lib/stores/ferry-observations";

/**
 * Three Pacific days with deliberately UNEQUAL sample counts and different
 * error profiles. Unequal counts are the point: a mean-of-daily-means and a
 * properly weighted running mean give different answers, so the cumulative
 * assertions below can actually tell them apart.
 */
const DAYS: { date: string; count: number; driveUp: number }[] = [
  { date: "2026-07-10", count: 20, driveUp: 10 }, // nearly full
  { date: "2026-07-11", count: 5, driveUp: 110 }, // nearly empty
  { date: "2026-07-12", count: 40, driveUp: 60 }, // middling
];
const MAX_SPACES = 120;

function buildObservations(): FerryObservation[] {
  const out: FerryObservation[] = [];
  for (const day of DAYS) {
    for (let i = 0; i < day.count; i += 1) {
      // Departures spread across the service day (16:00–23:00 UTC ≈ 9a–4p PDT),
      // so the heuristic prediction genuinely varies within each day.
      const hour = 16 + (i % 7);
      const departs = `${day.date}T${String(hour).padStart(2, "0")}:${i % 2 ? "30" : "00"}:00.000Z`;
      out.push({
        ts: departs,
        dir: i % 2 === 0 ? "from-kingston" : "to-kingston",
        departs,
        driveUp: day.driveUp,
        max: MAX_SPACES,
        delayMin: null,
      });
    }
  }
  return out;
}

/** A row whose snapshot instant and departure instant fall on DIFFERENT Pacific
 *  days: ts is 2026-07-14 23:50 PDT, departs is 2026-07-15 00:20 PDT. */
const STRADDLER: FerryObservation = {
  ts: "2026-07-15T06:50:00.000Z",
  dir: "from-kingston",
  departs: "2026-07-15T07:20:00.000Z",
  driveUp: 40,
  max: MAX_SPACES,
  delayMin: null,
};

/** Unusable rows: no fullness reading, so the backtest must skip them entirely. */
const UNUSABLE: FerryObservation[] = [
  {
    ts: "2026-07-11T18:00:00.000Z",
    dir: "from-kingston",
    departs: "2026-07-11T18:30:00.000Z",
    driveUp: null,
    max: MAX_SPACES,
    delayMin: 4,
  },
  {
    ts: "2026-07-11T19:00:00.000Z",
    dir: "to-kingston",
    departs: "2026-07-11T19:30:00.000Z",
    driveUp: 20,
    max: null,
    delayMin: null,
  },
];

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
  for (const obs of [...buildObservations(), STRADDLER, ...UNUSABLE]) {
    await appendFerryObservation(obs);
  }
});
afterAll(() => tdb.close());

describe("computeDailyAccuracy", () => {
  it("returns one point per departure day, oldest first", async () => {
    const series = await computeDailyAccuracy({ force: true });
    expect(series.map((p) => p.date)).toEqual([
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
      "2026-07-15",
    ]);
  });

  it("buckets by DEPARTURE day, not the snapshot day", async () => {
    // STRADDLER was snapshotted on Jul 14 Pacific but departs Jul 15. It's the
    // only row for either date, so a ts-based bucketing would produce a
    // "2026-07-14" key instead.
    const series = await computeDailyAccuracy({ force: true });
    const dates = series.map((p) => p.date);
    expect(dates).toContain("2026-07-15");
    expect(dates).not.toContain("2026-07-14");
    expect(series.find((p) => p.date === "2026-07-15")?.n).toBe(1);
  });

  it("counts only rows with a usable fullness reading", async () => {
    const series = await computeDailyAccuracy({ force: true });
    const jul11 = series.find((p) => p.date === "2026-07-11")!;
    // The two UNUSABLE rows also depart on Jul 11 and must not inflate it.
    expect(jul11.n).toBe(5);
    expect(series.reduce((sum, p) => sum + p.n, 0)).toBe(20 + 5 + 40 + 1);
  });

  it("folds back up to exactly the overall backtest", async () => {
    // The load-bearing invariant: the daily split is a partition of the same
    // scan, so the final running total must equal computeAccuracy() outright —
    // same values, same rounding, no drift.
    const [series, overall] = await Promise.all([
      computeDailyAccuracy({ force: true }),
      computeAccuracy(),
    ]);
    const final = series[series.length - 1].cumulative;
    expect(final.n).toBe(overall.n);
    expect(final.mae).toBe(overall.mae);
    expect(final.bias).toBe(overall.bias);
    expect(final.levelMatchRate).toBe(overall.levelMatchRate);
  });

  it("weights the running average by sample count, not by day", async () => {
    const series = await computeDailyAccuracy({ force: true });
    const [d0, d1] = series;
    // Through day 2 the running mean must sit at the count-weighted blend of
    // the two daily means (20 readings vs 5), NOT their midpoint.
    //
    // Reconstructing `weighted` from p.mae is inherently approximate — those are
    // already rounded to 1dp, while the implementation accumulates raw sums and
    // rounds once. So assert the shape of the answer (far nearer weighted than
    // mean-of-means) rather than an exact equality the rounding can't support.
    const weighted = (d0.mae * d0.n + d1.mae * d1.n) / (d0.n + d1.n);
    const meanOfMeans = (d0.mae + d1.mae) / 2;
    const distanceTo = (x: number) => Math.abs(d1.cumulative.mae - x);
    expect(distanceTo(weighted)).toBeLessThan(0.2);
    expect(distanceTo(meanOfMeans)).toBeGreaterThan(1);
    expect(d1.cumulative.n).toBe(d0.n + d1.n);
  });

  it("gives the first day's running total as that day's own numbers", async () => {
    const [d0] = await computeDailyAccuracy({ force: true });
    expect(d0.cumulative.n).toBe(d0.n);
    expect(d0.cumulative.mae).toBe(d0.mae);
    expect(d0.cumulative.bias).toBe(d0.bias);
  });

  it("keeps per-day rates inside their valid ranges", async () => {
    const series = await computeDailyAccuracy({ force: true });
    for (const p of series) {
      expect(p.mae).toBeGreaterThanOrEqual(0);
      expect(p.mae).toBeLessThanOrEqual(100);
      expect(p.levelMatchRate).toBeGreaterThanOrEqual(0);
      expect(p.levelMatchRate).toBeLessThanOrEqual(1);
      expect(p.within1Rate).toBeGreaterThanOrEqual(p.levelMatchRate);
      expect(p.bias).toBeGreaterThanOrEqual(-100);
      expect(p.bias).toBeLessThanOrEqual(100);
    }
  });

  it("separates a busy day from an empty one", async () => {
    const series = await computeDailyAccuracy({ force: true });
    const jul10 = series.find((p) => p.date === "2026-07-10")!; // 10/120 free → ~92% full
    const jul11 = series.find((p) => p.date === "2026-07-11")!; // 110/120 free → ~8% full
    // The heuristic can't be centered on both, so the day-level bias must swing
    // — which is the entire reason the chart is per-day.
    expect(jul10.bias).toBeLessThan(jul11.bias);
  });

  it("serves a cached series until forced", async () => {
    const first = await computeDailyAccuracy();
    // A new day's row lands, but the cached read must not see it yet.
    await appendFerryObservation({
      ts: "2026-07-20T18:00:00.000Z",
      dir: "from-kingston",
      departs: "2026-07-20T18:30:00.000Z",
      driveUp: 50,
      max: MAX_SPACES,
      delayMin: null,
    });
    expect(await computeDailyAccuracy()).toEqual(first);
    const forced = await computeDailyAccuracy({ force: true });
    expect(forced.map((p) => p.date)).toContain("2026-07-20");
  });
});
