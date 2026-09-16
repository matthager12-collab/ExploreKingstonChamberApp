"use client";

// Forecast-accuracy trend chart for /admin/ferry-info.
//
// Two series on ONE axis, both the same measure at different aggregations:
//   * per-day  — that day's own backtest. The real signal; noisy by nature.
//   * cumulative — the running average through that day. This is the shape the
//     stored `history` snapshots trace, kept as a context line because it's what
//     the headline metrics above the chart report.
// Never two different measures on two y-scales — switching metric re-scales the
// single axis instead (see the METRICS table).
//
// Hand-rolled dependency-free SVG, matching components/ferry-trendline.tsx:
// viewBox user units, oversized axis text (the SVG scales down on a phone), and
// fixed light-mode hexes since the app has no dark scheme.

import { useId, useState } from "react";
import type { DailyAccuracyPoint } from "@/lib/stores/ferry-observations";

// Series colors. Validated as a 2-slot categorical palette against the white
// card surface: worst adjacent CVD separation ΔE 21.9 (deutan) / 27.8 (tritan),
// normal-vision ΔE 26.1, both ≥ 3:1 on the surface. Hue is NOT load-bearing on
// its own — the cumulative line is also dashed and both are direct-labeled.
const DAILY_HEX = "#1e96c0"; // --color-tide
const CUM_HEX = "#8a4c22"; // --color-coral-deep
const GRID_HEX = "#e7ecef";
const AXIS_HEX = "#8a97a0";
const ZERO_HEX = "#6b7683"; // --color-ink-soft, for the bias zero line

const W = 720;
const H = 260;
// l is sized for the WIDEST y label any metric produces ("100%" at AXIS_FONT is
// ~50 units); at 48 it rendered clipped to "00%" on the Right-level chart.
const PAD = { l: 62, r: 16, t: 16, b: 36 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;
const AXIS_FONT = 20;
/** Above this many days the per-point dots collide, so the lines carry it alone. */
const MAX_DOTS = 45;
const DAY_MS = 86_400_000;
/**
 * Readings below which a day is treated as partial rather than a real result.
 * A healthy day logs ~500 (the observe cron, every ~15 min, ~4 rows a time), so
 * under 100 is less than a quarter of the service day covered — usually an
 * outage or the first/last day of the window, not a day the model aced.
 */
const MIN_CONFIDENT_N = 100;
/** Minimum centre-to-centre spacing for x labels, in viewBox units. A "Jul 29"
 *  at AXIS_FONT is roughly 65 units wide, so 100 leaves clear air between them. */
const MIN_LABEL_GAP = 100;

type MetricKey = "mae" | "levelMatchRate" | "bias";

interface MetricSpec {
  label: string;
  /** Axis + tooltip formatting for a raw value. */
  format: (v: number) => string;
  daily: (p: DailyAccuracyPoint) => number;
  cumulative: (p: DailyAccuracyPoint) => number;
  /** True when 0 is a meaningful midpoint (draw a zero rule, symmetric domain). */
  signed: boolean;
  /** Domain to use verbatim instead of one derived from the data — for rates,
   *  where 0–100% is the honest frame and auto-scaling would exaggerate noise. */
  fixedDomain?: { min: number; max: number };
  /** What "good" looks like, for the axis hint under the chart. */
  better: string;
}

const METRICS: Record<MetricKey, MetricSpec> = {
  mae: {
    label: "Avg error",
    format: (v) => `${Math.round(v * 10) / 10}`,
    daily: (p) => p.mae,
    cumulative: (p) => p.cumulative.mae,
    signed: false,
    better: "busyness points off, out of 100 — lower is better",
  },
  levelMatchRate: {
    label: "Right level",
    format: (v) => `${Math.round(v * 100)}%`,
    daily: (p) => p.levelMatchRate,
    cumulative: (p) => p.cumulative.levelMatchRate,
    signed: false,
    fixedDomain: { min: 0, max: 1 },
    better: "of sailings given the right busyness level — higher is better",
  },
  bias: {
    label: "Bias",
    format: (v) => `${v > 0 ? "+" : ""}${Math.round(v * 10) / 10}`,
    daily: (p) => p.bias,
    cumulative: (p) => p.cumulative.bias,
    signed: true,
    better: "above 0 = over-predicting, below = under — nearer 0 is better",
  },
};

/** "2026-07-04" → "Jul 4". The key is a plain calendar date, so it must be
 *  formatted in UTC — parsing it yields UTC midnight, and rendering that in
 *  Pacific would shift every label back a day. */
function fmtDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** A rounded domain that contains every plotted value. */
function domainFor(values: number[], spec: MetricSpec): { min: number; max: number } {
  if (spec.fixedDomain) return spec.fixedDomain;
  const peak = Math.max(...values.map(Math.abs), 1);
  const step = peak <= 10 ? 5 : 10;
  const top = Math.ceil(peak / step) * step;
  return spec.signed ? { min: -top, max: top } : { min: 0, max: top };
}

export function AccuracyTrend({ series }: { series: DailyAccuracyPoint[] }) {
  const [metric, setMetric] = useState<MetricKey>("mae");
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, "");
  const spec = METRICS[metric];

  if (series.length < 2) {
    return (
      <p className="mt-3 text-sm text-ink-soft">
        {series.length === 0
          ? "No daily results yet — the trend appears once sailings have been logged and graded."
          : "Only one day of results so far. The trend line needs a second day to draw."}
      </p>
    );
  }

  const dailyVals = series.map(spec.daily);
  const cumVals = series.map(spec.cumulative);
  const { min, max } = domainFor([...dailyVals, ...cumVals], spec);

  // X is positioned by CALENDAR DATE, not array index. A day the observe cron
  // missed is simply absent from the series, and an index-based axis would
  // quietly close that gap — drawing a 3-day outage as one ordinary step, which
  // is the same lie the unevenly-spaced stored history tells.
  const dayOffsets = series.map(
    (p) => (Date.parse(`${p.date}T00:00:00Z`) - Date.parse(`${series[0].date}T00:00:00Z`)) / DAY_MS,
  );
  const spanDays = Math.max(1, dayOffsets[dayOffsets.length - 1]);
  const xFor = (i: number) => PAD.l + (dayOffsets[i] / spanDays) * PLOT_W;
  const yFor = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * PLOT_H;

  // A day with only a handful of readings is noise, not news: a 13-reading day
  // can post a near-perfect score purely because it caught one quiet stretch.
  // Those points stay VISIBLE (hollow, and labelled below) but are cut out of
  // the per-day line, so the eye doesn't read a data outage as a good day.
  const confident = series.map((p) => p.n >= MIN_CONFIDENT_N);
  const lowNCount = confident.filter((c) => !c).length;

  /** One path per unbroken run of confident points; gaps stay gaps. */
  const dailyPath = (): string => {
    const parts: string[] = [];
    let open = false;
    series.forEach((_, i) => {
      if (!confident[i]) {
        open = false;
        return;
      }
      parts.push(`${open ? "L" : "M"}${xFor(i).toFixed(1)} ${yFor(dailyVals[i]).toFixed(1)}`);
      open = true;
    });
    return parts.join(" ");
  };

  // The cumulative is a running total over everything logged so far, so it IS
  // defined on a day with no observations — drawn unbroken on purpose.
  const cumPath = cumVals
    .map((v, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)}`)
    .join(" ");

  // Y ticks: the two ends plus the midpoint (or zero, when zero is meaningful).
  const yTicks = spec.signed ? [min, 0, max] : [min, (min + max) / 2, max];

  // X labels: ~5 days, always including the first and last. Picking every Nth
  // ARRAY index isn't enough once x is date-based — a gap in the series makes
  // the spacing uneven, and the final label can land on top of its neighbour
  // ("Jul 29Aug 1"). So enforce a minimum centre-to-centre distance, and let
  // the last day win the collision since it's the one that dates the chart.
  const lastIndex = series.length - 1;
  const labelIndexes: number[] = [];
  const labelEvery = Math.max(1, Math.ceil(series.length / 5));
  for (let i = 0; i < lastIndex; i += labelEvery) {
    if (labelIndexes.length === 0 || xFor(i) - xFor(labelIndexes[labelIndexes.length - 1]) >= MIN_LABEL_GAP) {
      labelIndexes.push(i);
    }
  }
  while (labelIndexes.length > 0 && xFor(lastIndex) - xFor(labelIndexes[labelIndexes.length - 1]) < MIN_LABEL_GAP) {
    labelIndexes.pop();
  }
  labelIndexes.push(lastIndex);
  const xLabels = labelIndexes.map((i) => ({ p: series[i], i }));

  const showDots = series.length <= MAX_DOTS;
  const first = series[0];
  const last = series[series.length - 1];

  return (
    <div className="mt-4">
      {/* Metric switcher — one row above the chart. Re-scales the single axis;
          it never adds a second one. */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Chart metric" className="flex flex-wrap gap-1.5">
          {(Object.keys(METRICS) as MetricKey[]).map((k) => {
            const active = k === metric;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setMetric(k)}
                aria-pressed={active}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  active
                    ? "bg-sound text-white"
                    : "border border-sand bg-white text-ink-soft hover:border-tide hover:text-tide-deep"
                }`}
              >
                {METRICS[k].label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend — always present for two series, and both are direct-labeled at
          the right edge below, so identity never rests on color alone. */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
          <svg aria-hidden width="18" height="8" viewBox="0 0 18 8">
            <line x1="0" y1="4" x2="18" y2="4" stroke={DAILY_HEX} strokeWidth="2.5" />
            <circle cx="9" cy="4" r="3" fill={DAILY_HEX} />
          </svg>
          Each day on its own
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
          <svg aria-hidden width="18" height="8" viewBox="0 0 18 8">
            <line x1="0" y1="4" x2="18" y2="4" stroke={CUM_HEX} strokeWidth="2.5" strokeDasharray="5 3" />
          </svg>
          Running average (all days so far)
        </span>
      </div>

      <div className="relative mt-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full overflow-visible"
          role="img"
          aria-label={`${spec.label} by day, ${fmtDay(first.date)} to ${fmtDay(last.date)}. Latest day ${spec.format(
            spec.daily(last),
          )}; running average ${spec.format(spec.cumulative(last))}. Full figures in the table below.`}
          onPointerLeave={() => setHover(null)}
        >
          {/* grid + y labels */}
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.l}
                y1={yFor(t)}
                x2={W - PAD.r}
                y2={yFor(t)}
                stroke={spec.signed && t === 0 ? ZERO_HEX : GRID_HEX}
                strokeWidth={spec.signed && t === 0 ? 1.5 : 1}
              />
              <text
                x={PAD.l - 8}
                y={yFor(t) + AXIS_FONT / 3}
                textAnchor="end"
                fontSize={AXIS_FONT}
                fill={AXIS_HEX}
              >
                {spec.format(t)}
              </text>
            </g>
          ))}

          {/* cumulative first, so the per-day signal draws on top of it */}
          <path
            d={cumPath}
            fill="none"
            stroke={CUM_HEX}
            strokeWidth="3"
            strokeDasharray="7 5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d={dailyPath()}
            fill="none"
            stroke={DAILY_HEX}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {showDots &&
            dailyVals.map((v, i) =>
              confident[i] ? (
                <circle key={i} cx={xFor(i)} cy={yFor(v)} r="4" fill={DAILY_HEX} stroke="#fff" strokeWidth="1.5" />
              ) : (
                // Hollow: present and hoverable, but visibly not part of the trend.
                <circle key={i} cx={xFor(i)} cy={yFor(v)} r="4" fill="#fff" stroke={DAILY_HEX} strokeWidth="2" />
              ),
            )}

          {/* x labels */}
          {xLabels.map(({ p, i }) => (
            <text
              key={p.date}
              x={xFor(i)}
              y={H - 10}
              textAnchor={i === 0 ? "start" : i === series.length - 1 ? "end" : "middle"}
              fontSize={AXIS_FONT}
              fill={AXIS_HEX}
            >
              {fmtDay(p.date)}
            </text>
          ))}

          {/* crosshair on the hovered day */}
          {hover !== null && (
            <g pointerEvents="none">
              <line
                x1={xFor(hover)}
                y1={PAD.t}
                x2={xFor(hover)}
                y2={PAD.t + PLOT_H}
                stroke={AXIS_HEX}
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
              <circle cx={xFor(hover)} cy={yFor(cumVals[hover])} r="6" fill={CUM_HEX} stroke="#fff" strokeWidth="2" />
              <circle cx={xFor(hover)} cy={yFor(dailyVals[hover])} r="6" fill={DAILY_HEX} stroke="#fff" strokeWidth="2" />
            </g>
          )}

          {/* Hit targets — full-height bands reaching to the midpoint of each
              neighbour, so uneven date spacing still gives every day a target
              and no two bands overlap. */}
          {series.map((p, i) => {
            const x = xFor(i);
            const leftEdge = i === 0 ? PAD.l : (xFor(i - 1) + x) / 2;
            const rightEdge = i === series.length - 1 ? W - PAD.r : (x + xFor(i + 1)) / 2;
            return (
              <rect
                key={`${uid}-hit-${p.date}`}
                x={leftEdge}
                y={PAD.t}
                width={Math.max(1, rightEdge - leftEdge)}
                height={PLOT_H}
                fill="transparent"
                onPointerEnter={() => setHover(i)}
              />
            );
          })}
        </svg>

        {hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-max max-w-[15rem] rounded-lg border border-sand bg-white px-3 py-2 text-xs shadow-md"
            style={{
              left: `${(xFor(hover) / W) * 100}%`,
              // Flip the tooltip to the other side of the crosshair once past
              // the midpoint, so it never runs off the right edge of the card.
              transform:
                hover > series.length / 2
                  ? "translateX(calc(-100% - 10px))"
                  : "translateX(10px)",
            }}
          >
            <p className="font-semibold text-sound-deep">{fmtDay(series[hover].date)}</p>
            <p className="mt-1 flex items-center gap-1.5 text-ink">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: DAILY_HEX }} />
              That day: <span className="font-semibold tabular-nums">{spec.format(dailyVals[hover])}</span>
            </p>
            <p className="flex items-center gap-1.5 text-ink">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: CUM_HEX }} />
              Running: <span className="font-semibold tabular-nums">{spec.format(cumVals[hover])}</span>
            </p>
            <p className="mt-1 text-ink-soft">
              {series[hover].n.toLocaleString()} reading{series[hover].n === 1 ? "" : "s"}
              {confident[hover] ? "" : " — partial day"}
            </p>
          </div>
        )}
      </div>

      <p className="mt-1 text-xs text-ink-soft">
        {spec.better}.
        {lowNCount > 0 && (
          <>
            {" "}
            {lowNCount} day{lowNCount === 1 ? "" : "s"} with under {MIN_CONFIDENT_N} readings{" "}
            {lowNCount === 1 ? "is" : "are"} drawn hollow and left out of the line — too little data
            to read as a result. Days the log missed entirely leave a gap.
          </>
        )}
      </p>

      {/* Table view — the non-visual path to the same numbers. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-semibold text-tide-deep">
          Show these numbers as a table
        </summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left text-xs tabular-nums">
            <caption className="sr-only">
              Ferry forecast accuracy by day: that day&rsquo;s own result and the running average.
            </caption>
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-sand text-ink-soft">
                <th scope="col" className="py-1 pr-3 font-semibold">Day</th>
                <th scope="col" className="py-1 pr-3 font-semibold">Readings</th>
                <th scope="col" className="py-1 pr-3 font-semibold">{spec.label} that day</th>
                <th scope="col" className="py-1 font-semibold">Running</th>
              </tr>
            </thead>
            <tbody>
              {[...series].reverse().map((p) => (
                <tr key={p.date} className="border-b border-sand/60">
                  <th scope="row" className="py-1 pr-3 font-normal text-ink">{fmtDay(p.date)}</th>
                  <td className="py-1 pr-3 text-ink-soft">{p.n.toLocaleString()}</td>
                  <td className="py-1 pr-3 text-ink">{spec.format(spec.daily(p))}</td>
                  <td className="py-1 text-ink-soft">{spec.format(spec.cumulative(p))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
