// Plain-English readout of the ferry forecast backtest, for /admin/ferry-info.
//
// The accuracy panel exists to answer ONE operational question: is the busyness
// prediction good enough to show visitors? The raw metrics don't answer that on
// their own — a Chamber reader can't be expected to know whether "MAE 32.8,
// bias +20, level match 0.23" is fine or terrible. This module turns the
// numbers into a verdict, with the thresholds written down and unit-tested
// rather than improvised in JSX.
//
// Deliberately structural inputs (no import from stores/) so this stays a pure
// lib module the tests can call with literals.

/** The subset of AccuracyMetrics the verdict reads. */
export interface VerdictInput {
  n: number;
  mae: number;
  bias: number;
  levelMatchRate: number;
  within1Rate: number;
  spanDays: number;
}

/** The subset of DailyAccuracyPoint the plateau check reads. */
export interface VerdictSeriesPoint {
  cumulative: { mae: number };
}

export type VerdictTone = "unknown" | "not-ready" | "borderline" | "ready";

export interface AccuracyVerdict {
  tone: VerdictTone;
  /** Short label for the badge. */
  headline: string;
  /** One or two sentences of plain English, already populated with numbers. */
  detail: string;
}

// --- Thresholds -------------------------------------------------------------
// Rationale, so a future tweak is an argued change rather than a guess:
//
//  * SAMPLE/SPAN floors — ferry demand is strongly weekly (a Saturday behaves
//    nothing like a Tuesday), so a verdict before a full week of coverage is
//    not a verdict. 200 readings is roughly a day of the 10-minute snapshots.
//  * LEVEL MATCH — the visitor-facing claim is a 5-level busyness label, so
//    naming the right level is the metric that actually maps to the promise.
//    Below 45% the label is wrong more often than not.
//  * BIAS — a systematic skew is worse than equivalent random error: it's
//    wrong the SAME way every time, so visitors learn to distrust it.
//  * WITHIN-ONE — bounds the damage when the exact level misses. A prediction
//    that's usually adjacent is still directionally useful.
const MIN_SAMPLE = 200;
const MIN_SPAN_DAYS = 7;
const GOOD_LEVEL_MATCH = 0.6;
const OK_LEVEL_MATCH = 0.45;
const GOOD_BIAS = 8;
const OK_BIAS = 15;
const GOOD_WITHIN1 = 0.85;
/** Cumulative MAE has to sit inside ±this of its final value to count as settled. */
const PLATEAU_TOLERANCE = 1;

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/**
 * How many trailing days the cumulative MAE has stayed within PLATEAU_TOLERANCE
 * of its latest value. A long run means the backtest has converged and more
 * days of the same data will not move it — the model itself has to change.
 */
export function plateauDays(
  series: VerdictSeriesPoint[],
  tolerance: number = PLATEAU_TOLERANCE,
): number {
  if (series.length === 0) return 0;
  const final = series[series.length - 1].cumulative.mae;
  let days = 0;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (Math.abs(series[i].cumulative.mae - final) > tolerance) break;
    days += 1;
  }
  return days;
}

/** Turn the backtest into a go / no-go readout for the Chamber. */
export function accuracyVerdict(
  metrics: VerdictInput | null,
  series: VerdictSeriesPoint[] = [],
): AccuracyVerdict {
  if (!metrics || metrics.n === 0) {
    return {
      tone: "unknown",
      headline: "No data yet",
      detail:
        "The backtest needs logged sailings to grade itself against. The nightly cron fills this in as observations accumulate.",
    };
  }

  const { n, bias, levelMatchRate, within1Rate, spanDays } = metrics;

  if (n < MIN_SAMPLE || spanDays < MIN_SPAN_DAYS) {
    return {
      tone: "unknown",
      headline: "Too early to judge",
      detail: `Only ${n.toLocaleString()} reading${n === 1 ? "" : "s"} across ${spanDays} day${
        spanDays === 1 ? "" : "s"
      }. Ferry demand swings by day of week, so give it a full week before reading anything into these numbers.`,
    };
  }

  const absBias = Math.abs(bias);
  const skew =
    absBias <= GOOD_BIAS
      ? "and it's well-centered"
      : `and it runs ${absBias} points ${bias > 0 ? "high" : "low"} — ${
          bias > 0 ? "over" : "under"
        }-predicting the same way almost every time`;

  // Only worth saying "more data won't help" once it's actually settled AND the
  // plateau covers a meaningful stretch of the sample.
  const settled = plateauDays(series);
  const settledNote =
    settled >= MIN_SPAN_DAYS
      ? ` That number has barely moved in ${settled} days, so more data alone won't change it — the model would need retuning.`
      : "";

  const base = `Over ${spanDays} days and ${n.toLocaleString()} logged readings it names the right busyness level ${pct(
    levelMatchRate,
  )} of the time (${pct(within1Rate)} within one level) ${skew}.`;

  if (levelMatchRate >= GOOD_LEVEL_MATCH && absBias <= GOOD_BIAS && within1Rate >= GOOD_WITHIN1) {
    return {
      tone: "ready",
      headline: "Looks ready",
      detail: `${base} That's accurate enough to be useful to visitors.`,
    };
  }

  if (levelMatchRate >= OK_LEVEL_MATCH && absBias <= OK_BIAS) {
    return {
      tone: "borderline",
      headline: "Borderline",
      detail: `${base} Usable as a rough hint, but expect visitors to notice the misses.${settledNote}`,
    };
  }

  return {
    tone: "not-ready",
    headline: "Not ready to turn on",
    detail: `${base} Shown as-is it would mislead more often than it helps.${settledNote}`,
  };
}
