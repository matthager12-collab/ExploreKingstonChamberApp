"use client";

// Shared busyness trendline for the ferry pages: a hand-rolled, dependency-free
// SVG area/line chart that colors the curve by busyness level across the day,
// with a marker at a selected time. Used by both the full trip planner
// (/ferry/plan) and the "how busy today" panel on /ferry.
//
// Font sizes are in viewBox user units; the SVG scales to ~0.4× on a phone, so
// they're sized up (≈22) to stay legible on the smallest targeted screens.

import { useId } from "react";
import {
  DAY_END_MIN,
  DAY_START_MIN,
  LEVELS,
  minutesToLabel,
  type BusyLevel,
  type ForecastPoint,
} from "@/lib/ferry-forecast";

/** "around 3:00 PM" for a single time, or "10:00 AM–2:30 PM" when it's a plateau. */
export function extremeLabel(w: { startMin: number; endMin: number }): string {
  return w.startMin === w.endMin
    ? `around ${minutesToLabel(w.startMin)}`
    : `${minutesToLabel(w.startMin)}–${minutesToLabel(w.endMin)}`;
}

export function LevelLegend() {
  return (
    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
      {(Object.keys(LEVELS) as BusyLevel[]).map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
          {/* Decorative swatch — the label beside it carries the level. */}
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: LEVELS[k].hex }}
          />
          {LEVELS[k].label}
        </span>
      ))}
    </div>
  );
}

const W = 720;
const H = 252;
const PAD = { l: 14, r: 14, t: 36, b: 34 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;
const AXIS_FONT = 22;

const xFor = (min: number) =>
  PAD.l + ((min - DAY_START_MIN) / (DAY_END_MIN - DAY_START_MIN)) * PLOT_W;
const yFor = (score: number) => PAD.t + (1 - score / 100) * PLOT_H;

const X_TICKS: { min: number; label: string }[] = [
  { min: 6 * 60, label: "6a" },
  { min: 9 * 60, label: "9a" },
  { min: 12 * 60, label: "12p" },
  { min: 15 * 60, label: "3p" },
  { min: 18 * 60, label: "6p" },
  { min: 21 * 60, label: "9p" },
  { min: 24 * 60, label: "12a" },
];

export function Trendline({
  points,
  selectedMinutes,
  selectedLevel,
}: {
  points: ForecastPoint[];
  selectedMinutes: number;
  selectedLevel: BusyLevel;
}) {
  // Unique gradient ids so two trendlines can render on the same page without
  // one's <defs> hijacking the other's colors.
  const uid = useId().replace(/:/g, "");
  const strokeId = `tl-stroke-${uid}`;
  const fillId = `tl-fill-${uid}`;

  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xFor(p.minutes).toFixed(1)} ${yFor(p.score).toFixed(1)}`)
    .join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  const area = `${line} L${xFor(last.minutes).toFixed(1)} ${yFor(0).toFixed(1)} L${xFor(
    first.minutes,
  ).toFixed(1)} ${yFor(0).toFixed(1)} Z`;

  // Color the line + fill by time-of-day using each point's level color.
  const stops = points.map((p, i) => (
    <stop key={i} offset={((xFor(p.minutes) - PAD.l) / PLOT_W).toFixed(3)} stopColor={LEVELS[p.level].hex} />
  ));

  // Keep the marker on the plotted line: clamp into the window, then take the
  // nearest sampled point's score for the dot's height (so it never floats off).
  const clampedMin = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN, selectedMinutes));
  const nearest = points.reduce(
    (a, b) => (Math.abs(b.minutes - clampedMin) < Math.abs(a.minutes - clampedMin) ? b : a),
    points[0],
  );
  const mx = xFor(clampedMin);
  const my = yFor(nearest.score);
  const chipW = 132;
  const chipX = Math.max(PAD.l, Math.min(W - PAD.r - chipW, mx - chipW / 2));
  const meta = LEVELS[selectedLevel];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Busyness trendline. Selected time ${minutesToLabel(selectedMinutes)}: ${meta.label}.`}
    >
      <defs>
        <linearGradient id={strokeId} gradientUnits="userSpaceOnUse" x1={PAD.l} y1="0" x2={W - PAD.r} y2="0">
          {stops}
        </linearGradient>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1E96C0" stopOpacity="0.20" />
          <stop offset="1" stopColor="#1E96C0" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* horizontal guide lines */}
      {[25, 50, 75].map((s) => (
        <line key={s} x1={PAD.l} y1={yFor(s)} x2={W - PAD.r} y2={yFor(s)} stroke="#E7ECEF" strokeWidth="1" />
      ))}

      <path d={area} fill={`url(#${fillId})`} />
      <path
        d={line}
        fill="none"
        stroke={`url(#${strokeId})`}
        strokeWidth="3.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* x-axis ticks */}
      {X_TICKS.map((t) => (
        <text key={t.min} x={xFor(t.min)} y={H - 8} textAnchor="middle" fontSize={AXIS_FONT} fill="#8A97A0">
          {t.label}
        </text>
      ))}

      {/* selected-time marker */}
      <line x1={mx} y1={PAD.t} x2={mx} y2={H - PAD.b} stroke={meta.hex} strokeWidth="2" strokeDasharray="5 4" />
      <circle cx={mx} cy={my} r="7" fill={meta.hex} stroke="#fff" strokeWidth="2.5" />
      <g>
        <rect x={chipX} y={2} width={chipW} height={28} rx={14} fill={meta.hex} />
        <text x={chipX + chipW / 2} y={21} textAnchor="middle" fontSize={AXIS_FONT} fontWeight="600" fill="#fff">
          {meta.label}
        </text>
      </g>
    </svg>
  );
}
