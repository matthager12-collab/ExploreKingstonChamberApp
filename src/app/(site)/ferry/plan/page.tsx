// Ferry trip planner — anticipate how busy the Edmonds–Kingston boat will be
// on a chosen date and time, with a recommended "arrive by" and a day-long
// busyness trendline. Gated behind the Ferry page's visibility so hiding
// /ferry hides this too. The busyness model itself is a client-side estimate
// (src/lib/ferry-forecast); this server component just seeds today's real
// sailings + live space and the valid-schedule window.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Section } from "@/components/ui";
import { getSailingSpace, getSailingsForDate, getValidDateRange } from "@/lib/wsf";
import { getEmpiricalBusyness } from "@/lib/stores/ferry-observations";
import { getFerryPredictionAccess } from "@/lib/stores/ferry-prediction-store";
import { todayPacific } from "@/lib/time";
import { assertPageVisible, HiddenPageBanner } from "@/lib/page-visibility";
import { FerryPredictionPreviewBanner } from "@/components/ferry-prediction-banner";
import { FerryPlanner, type PlannerSchedule } from "./ferry-planner";

export const metadata: Metadata = {
  title: "Plan your ferry trip",
  description:
    "Pick a date and time to see how busy the Edmonds–Kingston ferry is likely to be, when to arrive, and a busyness trendline for the whole day.",
};

// Keep today's seeded sailing space fresh without marking the page fully static.
export const revalidate = 60;

const PLANNING_HORIZON_DAYS = 120;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** today + N days as a Pacific "YYYY-MM-DD" string (timezone-safe). */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Current Pacific wall time as "HH:mm", nudged to service hours for the default. */
function defaultPacificTime(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const h = Number(get("hour"));
  const mins = h * 60 + Number(get("minute"));
  if (mins < 300 || mins > 1290) return "09:00"; // outside ~5am–9:30pm → a neutral planning time
  return `${get("hour")}:${get("minute")}`;
}

export default async function FerryPlanPage() {
  const hiddenPreview = await assertPageVisible("/ferry");

  // The prediction feature ships OFF for visitors while it's being validated.
  // Admins still get a preview; everyone else gets a clean 404.
  const prediction = await getFerryPredictionAccess();
  if (!prediction.enabled && !prediction.adminPreview) notFound();

  const today = todayPacific();

  const [carFerry, kingston, edmonds, range, empirical] = await Promise.all([
    getSailingsForDate(today),
    getSailingSpace("kingston"),
    getSailingSpace("edmonds"),
    getValidDateRange(),
    getEmpiricalBusyness(),
  ]);

  const initial: PlannerSchedule = {
    date: today,
    isToday: true,
    sailings: carFerry.sailings,
    live: carFerry.live,
    sailingSpace: { kingston, edmonds },
  };

  return (
    <>
      {hiddenPreview && <HiddenPageBanner />}
      {prediction.adminPreview && (
        <div className="mx-auto max-w-5xl px-4 pt-4">
          <FerryPredictionPreviewBanner />
        </div>
      )}
      <PageHeader
        eyebrow="Ferry planner"
        title="Will the ferry be busy?"
        intro="Pick a day and time for the Edmonds–Kingston car ferry and get a busyness estimate, when to arrive, and how the crowds rise and fall across the day. Great for planning a summer weekend or a Fourth of July escape."
      />

      <Section>
        <FerryPlanner
          today={today}
          maxDate={addDays(today, PLANNING_HORIZON_DAYS)}
          defaultTime={defaultPacificTime()}
          scheduleThru={range?.thru ?? null}
          initial={initial}
          empirical={empirical.table}
          observed={{ sampleCount: empirical.sampleCount, days: empirical.days }}
        />
        <p className="mt-6 text-sm text-ink-soft">
          Looking for live departures, fares, and the boarding-pass line map?{" "}
          <Link href="/ferry" className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2">
            See the full Ferry page →
          </Link>
        </p>
      </Section>
    </>
  );
}
