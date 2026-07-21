"use client";

// "How busy is the ferry today?" — an at-a-glance busyness panel for the main
// Ferry page. Same forecast model + trendline as the full planner (/ferry/plan),
// but fixed to TODAY with a live "right now" marker and a direction toggle. It
// links out to the planner for other days.

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Direction } from "@/lib/types";
import { dayCurve, forecastAt, type EmpiricalTable } from "@/lib/ferry-forecast";
import { chipClass } from "@/lib/ferry-chip";
import { LevelLegend, Trendline, extremeLabel } from "./ferry-trendline";

const TZ = "America/Los_Angeles";

/** Minutes since Pacific midnight for a moment in time. */
function pacificMinutes(nowMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

const DIR: Record<Direction, { short: string; arrow: string }> = {
  "to-kingston": { short: "To Kingston", arrow: "Edmonds → Kingston" },
  "from-kingston": { short: "To Edmonds", arrow: "Kingston → Edmonds" },
};

export function FerryBusyToday({
  today,
  serverNow,
  defaultDirection,
  empirical,
  observed,
}: {
  today: string;
  /** ISO timestamp from the server render so SSR and hydration agree. */
  serverNow: string;
  defaultDirection: Direction;
  empirical?: EmpiricalTable;
  observed?: { sampleCount: number; days: number };
}) {
  const [direction, setDirection] = useState<Direction>(defaultDirection);
  const [nowMs, setNowMs] = useState(() => Date.parse(serverNow));

  // Tick the "now" marker once mounted. The initial sync is deferred (setTimeout)
  // rather than called synchronously in the effect body, so it corrects any
  // SSR/clock skew right after paint without a cascading render.
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const initial = setTimeout(tick, 0);
    const id = setInterval(tick, 60_000);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, []);

  const minutes = pacificMinutes(nowMs);
  const forecast = forecastAt(today, minutes, direction, "drive", empirical);
  const curve = dayCurve(today, direction, empirical);
  const meta = forecast.levelMeta;
  const dir = DIR[direction];

  return (
    <div className="rounded-2xl border border-sand bg-white p-5 shadow-[0_1px_3px_rgba(22,64,94,0.08)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-sound-deep">How busy is the ferry today?</h3>
        <div
          role="group"
          aria-label="Direction"
          className="grid grid-cols-2 gap-1 rounded-xl bg-sand/60 p-1 text-sm"
        >
          {(["to-kingston", "from-kingston"] as Direction[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDirection(d)}
              aria-pressed={d === direction}
              className={`rounded-lg px-3 py-1.5 font-semibold transition-colors ${
                d === direction ? "bg-sound text-white shadow-sm" : "text-ink hover:bg-white/70"
              }`}
            >
              {DIR[d].short}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3 text-sm text-ink">
        Right now, <span className="font-semibold">{dir.arrow}</span> is{" "}
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${chipClass(meta)}`}>{meta.label}</span>.{" "}
        <span className="text-ink-soft">{meta.blurb}</span>
      </p>

      <div className="mt-3">
        <Trendline points={curve.points} selectedMinutes={minutes} selectedLevel={forecast.level} />
      </div>

      <p className="mt-2 text-sm text-ink-soft">
        Quietest <span className="font-semibold text-ink">{extremeLabel(curve.quietest)}</span> · Busiest{" "}
        <span className="font-semibold text-ink">{extremeLabel(curve.busiest)}</span>.
      </p>
      <LevelLegend />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-sand pt-3">
        <p className="text-xs text-ink-soft">
          An estimate from typical WSF traffic patterns
          {observed && observed.sampleCount > 0
            ? `, tuned by ${observed.sampleCount.toLocaleString()} logged sailings`
            : ""}{" "}
          — not a live forecast.
        </p>
        <Link
          href="/ferry/plan"
          className="text-sm font-semibold text-tide-deep underline decoration-seaglass underline-offset-2"
        >
          Planning another day? →
        </Link>
      </div>
    </div>
  );
}
