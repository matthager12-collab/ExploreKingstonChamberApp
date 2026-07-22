"use client";

// Ferry trip planner — pick a date, time, direction and travel mode, and get a
// recommended "arrive by" time plus a busyness trendline for that whole day.
//
// The forecast is computed entirely in the browser (src/lib/ferry-forecast), so
// dragging the time or flipping direction recomputes instantly with no server
// round-trip. Changing the DATE fetches that day's real sailings from
// /api/ferry/plan so the estimate can snap to an actual departure (and show
// live drive-up space when the date is today). If the schedule isn't published
// that far out, it falls back to typical times and the estimate still works.

import Link from "next/link";
import { useRef, useState } from "react";
import type { Direction, Sailing } from "@/lib/types";
import {
  dayCurve,
  forecastAt,
  hhmmToMinutes,
  minutesToLabel,
  type EmpiricalTable,
  type TravelMode,
} from "@/lib/ferry-forecast";
import { chipClass } from "@/lib/ferry-chip";
import { Card, ExternalLink } from "@/components/ui";
import { fallbackSailings } from "@/lib/data/ferry-fallback";
import { LevelLegend, Trendline, extremeLabel } from "@/components/ferry-trendline";

interface SailingSpace {
  departs: string;
  vessel: string;
  driveUpSpaces: number | null;
  maxSpaces: number | null;
}

export interface PlannerSchedule {
  date: string;
  isToday: boolean;
  sailings: Sailing[];
  live: boolean;
  sailingSpace?: { kingston: SailingSpace[]; edmonds: SailingSpace[] };
}

const TZ = "America/Los_Angeles";

/** Minutes since Pacific midnight for an ISO instant. */
function pacificMinutesOf(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

function formatPacificTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(
    new Date(iso),
  );
}

const DIRECTIONS: Record<Direction, { origin: string; dest: string; arrow: string }> = {
  "to-kingston": { origin: "Edmonds", dest: "Kingston", arrow: "Edmonds → Kingston" },
  "from-kingston": { origin: "Kingston", dest: "Edmonds", arrow: "Kingston → Edmonds" },
};

/** Nearest sailing-space record to an ISO departure, within ±3 min. */
function spaceFor(space: SailingSpace[] | undefined, iso: string): SailingSpace | undefined {
  if (!space) return undefined;
  const t = Date.parse(iso);
  let best: SailingSpace | undefined;
  let bestDiff = 3 * 60_000;
  for (const s of space) {
    const diff = Math.abs(Date.parse(s.departs) - t);
    if (diff < bestDiff) {
      best = s;
      bestDiff = diff;
    }
  }
  return best;
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; sub?: string }[];
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="grid grid-cols-2 gap-1 rounded-xl bg-sand/60 p-1"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`rounded-lg px-3 py-2 text-center text-sm font-semibold transition-colors ${
              active ? "bg-sound text-white shadow-sm" : "text-ink hover:bg-white/70"
            }`}
          >
            {o.label}
            {o.sub && (
              <span className={`block text-xs font-normal ${active ? "text-white/80" : "text-ink-soft"}`}>
                {o.sub}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---- Main planner ----------------------------------------------------------

export function FerryPlanner({
  today,
  maxDate,
  defaultTime,
  scheduleThru,
  initial,
  empirical,
  observed,
}: {
  today: string;
  maxDate: string;
  defaultTime: string;
  scheduleThru: string | null;
  initial: PlannerSchedule;
  /** Observed busyness table blended into the forecast (grows over time). */
  empirical?: EmpiricalTable;
  /** Totals behind `empirical`, for the "learning" note. */
  observed?: { sampleCount: number; days: number };
}) {
  const [date, setDate] = useState(today);
  const [direction, setDirection] = useState<Direction>("to-kingston");
  const [mode, setMode] = useState<TravelMode>("drive");
  const [time, setTime] = useState(defaultTime);
  const [schedule, setSchedule] = useState<PlannerSchedule>(initial);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  // Fetching the chosen day's real sailings is a response to a user action
  // (changing the date), so it lives in the handler rather than an effect. The
  // request id guards against out-of-order responses when dates change fast.
  function changeDate(value: string) {
    if (!value || value === date) return;
    setDate(value);
    const id = ++reqId.current;
    setLoading(true);
    fetch(`/api/ferry/plan?date=${value}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad response"))))
      .then((data: PlannerSchedule) => {
        if (id === reqId.current) setSchedule(data);
      })
      .catch(() => {
        // Network failure: fall back to the bundled seasonal schedule (re-dated)
        // rather than an empty one, so the answer still snaps to typical times
        // and never wrongly claims there's no sailing.
        if (id === reqId.current) {
          setSchedule({
            date: value,
            isToday: value === today,
            sailings: fallbackSailings(value),
            live: false,
          });
        }
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
  }

  const dir = DIRECTIONS[direction];
  const targetMinutes = hhmmToMinutes(time);

  // Real departures for this direction on the loaded day, soonest first.
  const departures =
    schedule.date === date
      ? schedule.sailings
          .filter((s) => s.direction === direction)
          .map((s) => ({ iso: s.departs, minutes: pacificMinutesOf(s.departs), vessel: s.vessel }))
          .sort((a, b) => a.minutes - b.minutes)
      : [];

  // The boat you'd catch: first departure at or after your target time.
  const snapped = departures.find((d) => d.minutes >= targetMinutes - 1) ?? null;
  const lastDeparture = departures.length ? departures[departures.length - 1] : null;
  const effectiveMinutes = snapped ? snapped.minutes : targetMinutes;

  const forecast = forecastAt(date, effectiveMinutes, direction, mode, empirical);
  const curve = dayCurve(date, direction, empirical);

  const arriveByMinutes = Math.max(0, effectiveMinutes - forecast.arriveEarlyMinutes);
  const meta = forecast.levelMeta;

  const liveSpace =
    schedule.isToday && snapped
      ? spaceFor(
          direction === "from-kingston" ? schedule.sailingSpace?.kingston : schedule.sailingSpace?.edmonds,
          snapped.iso,
        )
      : undefined;

  // Parse at UTC noon so the instant is fixed (server and client agree) and
  // formatting it in Pacific still lands on the same calendar day.
  const weekdayLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));

  return (
    <div className="space-y-5">
      {/* Controls */}
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold tracking-widest text-ink-soft uppercase">
              Direction
            </label>
            <Segmented
              ariaLabel="Direction of travel"
              value={direction}
              onChange={setDirection}
              options={[
                { value: "to-kingston", label: "To Kingston", sub: "from Edmonds" },
                { value: "from-kingston", label: "To Edmonds", sub: "from Kingston" },
              ]}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold tracking-widest text-ink-soft uppercase">
              How you&rsquo;re travelling
            </label>
            <Segmented
              ariaLabel="Travel mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: "drive", label: "Drive", sub: "bring a car" },
                { value: "walk", label: "Walk on", sub: "on foot" },
              ]}
            />
          </div>
          <div>
            <label htmlFor="plan-date" className="mb-1.5 block text-xs font-semibold tracking-widest text-ink-soft uppercase">
              Date
            </label>
            <input
              id="plan-date"
              type="date"
              value={date}
              min={today}
              max={maxDate}
              onChange={(e) => changeDate(e.target.value)}
              className="w-full rounded-xl border border-sand bg-white px-3 py-2 text-ink focus:border-tide focus:ring-2 focus:ring-tide/30 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="plan-time" className="mb-1.5 block text-xs font-semibold tracking-widest text-ink-soft uppercase">
              Around what time?
            </label>
            <input
              id="plan-time"
              type="time"
              value={time}
              onChange={(e) => e.target.value && setTime(e.target.value)}
              className="w-full rounded-xl border border-sand bg-white px-3 py-2 text-ink focus:border-tide focus:ring-2 focus:ring-tide/30 focus:outline-none"
            />
          </div>
        </div>
      </Card>

      {/* Headline answer */}
      <Card className="border-tide/30 bg-tide/[0.03]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-widest text-ink-soft uppercase">
              {dir.arrow} · {mode === "drive" ? "Driving" : "Walking on"}
            </p>
            {snapped ? (
              <>
                <p className="mt-1 text-3xl font-semibold text-sound-deep sm:text-4xl">
                  {mode === "drive" ? "Be in line by " : "Reach the dock by "}
                  <span className="text-tide-deep">{minutesToLabel(arriveByMinutes)}</span>
                </p>
                <p className="mt-1 text-ink-soft">
                  to catch the{" "}
                  <span className="font-semibold text-ink">{formatPacificTime(snapped.iso)}</span> boat to{" "}
                  {dir.dest} — about {forecast.arriveEarlyMinutes} min early.
                </p>
              </>
            ) : (
              <>
                <p className="mt-1 text-2xl font-semibold text-sound-deep">
                  No {dir.dest} sailing at or after {minutesToLabel(targetMinutes)}
                </p>
                <p className="mt-1 text-ink-soft">
                  {lastDeparture
                    ? `The last boat to ${dir.dest} leaves at ${formatPacificTime(lastDeparture.iso)}. Pick an earlier time — here's the outlook for that time anyway.`
                    : "Pick a time during service hours to see when to arrive."}
                </p>
              </>
            )}
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${chipClass(meta)}`}
            title={`Busyness score ${forecast.score}/100`}
          >
            {meta.label}
          </span>
        </div>

        <p className="mt-3 text-sm text-ink">{meta.blurb}</p>

        {mode === "drive" ? (
          <p className="mt-2 text-sm text-ink-soft">{forecast.boatWait}</p>
        ) : (
          <p className="mt-2 text-sm text-ink-soft">
            Walk-ons always get a spot on this route — even when the car line is hours long, foot
            passengers stroll aboard.
          </p>
        )}

        {mode === "drive" && forecast.boardingPassActive && (
          <div className="mt-3 rounded-lg bg-coral/10 px-3 py-2 text-sm text-coral-deep">
            🚗 <span className="font-semibold">Vehicle boarding pass likely in effect</span> (8 am–8 pm).
            Get in the SR-104 line and take a pass — don&rsquo;t drive straight to the dock.{" "}
            <Link href="/ferry#ferry-line-map" className="font-semibold underline">
              How the line works
            </Link>
          </div>
        )}

        {liveSpace && liveSpace.driveUpSpaces !== null && (
          <p className="mt-3 text-sm">
            <span className="font-semibold text-fern">Live right now:</span>{" "}
            {liveSpace.driveUpSpaces === 0
              ? "that boat is showing as full."
              : `that boat shows ${liveSpace.driveUpSpaces} drive-up car spots open.`}
          </p>
        )}

        {forecast.factors.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {forecast.factors.map((f) => (
              <span key={f} className="rounded-full bg-seaglass/40 px-2.5 py-0.5 text-xs font-medium text-sound-deep">
                {f}
              </span>
            ))}
          </div>
        )}

        {forecast.empiricalApplied && (
          <p className="mt-3 text-xs font-medium text-fern">
            ✓ Tuned by {forecast.empiricalSamples} sailing{forecast.empiricalSamples === 1 ? "" : "s"} we&rsquo;ve
            logged around this time.
          </p>
        )}
      </Card>

      {/* Trendline */}
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg font-semibold text-sound-deep">
            How busy through {weekdayLabel}
          </h3>
          <span className="text-sm text-ink-soft">{dir.arrow}</span>
        </div>
        <div className="mt-3">
          <Trendline
            points={curve.points}
            selectedMinutes={effectiveMinutes}
            selectedLevel={forecast.level}
          />
        </div>
        <p className="mt-2 text-sm text-ink-soft">
          Quietest <span className="font-semibold text-ink">{extremeLabel(curve.quietest)}</span> ·
          Busiest <span className="font-semibold text-ink">{extremeLabel(curve.busiest)}</span>.
        </p>
        <LevelLegend />
      </Card>

      {/* Honesty / sourcing */}
      <div className="rounded-xl border border-sand bg-white px-4 py-3 text-xs text-ink-soft">
        <p>
          This is an <strong className="text-ink">estimate</strong> of typical demand, based on
          Washington State Ferries&rsquo; published{" "}
          <ExternalLink href="https://wsdot.wa.gov/travel/washington-state-ferries/schedules">
            &ldquo;Best Times to Travel&rdquo;
          </ExternalLink>{" "}
          patterns — not a live forecast. Real waits can spike without warning (a holiday, an
          incident, or a smaller substitute boat), so on the day, always check the{" "}
          <Link href="/ferry" className="font-medium text-tide-deep underline">
            live ferry board
          </Link>
          .{" "}
          {loading
            ? "Loading that day's sailing times…"
            : schedule.live
              ? "Sailing times are the real WSF schedule for this date."
              : scheduleThru
                ? `WSF hasn't published the schedule past ${scheduleThru} yet, so times shown are typical seasonal sailings.`
                : "Showing typical seasonal sailing times."}
          {observed && observed.sampleCount > 0
            ? ` It also learns from ${observed.sampleCount.toLocaleString()} live sailing observation${observed.sampleCount === 1 ? "" : "s"} we've logged over ${observed.days} day${observed.days === 1 ? "" : "s"}, and sharpens as more come in.`
            : " The estimate sharpens as we log more live sailing data."}
        </p>
      </div>
    </div>
  );
}
