// Compact "getting in the ferry line" callout — Kingston's SR 104 boarding-pass
// (ATMS) system in three steps, with a Navigate button to the terminal.
// Used up top on /ferry and on the home screen. Server component; the Navigate
// button is a plain Google Maps directions deep link (no API key).

import Link from "next/link";
import { mapDirectionsUrl } from "@/components/ui";

const TERMINAL = "Kingston Ferry Terminal, Kingston, WA 98346";

export function FerryLineInfo({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-coral/40 bg-coral/5 p-5 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-lg font-semibold text-sound-deep">
            <span aria-hidden>🚗</span> Driving onto the ferry?
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            When the overhead signs at <span className="font-medium text-ink">SR 104 &amp; Barber
            Cutoff Rd</span> are flashing, Kingston&apos;s boarding-pass system is on. Follow the
            signal into the ferry lane, <span className="font-medium text-ink">take a pass at the
            dispenser near Lindvog Rd</span>, then wait for a green light to pull up to the
            tollbooths — leave the line and your pass is void.
          </p>
          <p className="mt-1.5 text-sm text-ink-soft">
            Active daily <span className="font-medium text-ink">8 a.m.–8 p.m.</span> in season, plus
            weekends and holidays. Walk-ons, cyclists, and motorcycles skip it.
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-1.5">
          <a
            href={mapDirectionsUrl(TERMINAL, "driving")}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-coral px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-coral-deep"
          >
            Navigate to the ferry →
          </a>
          <Link
            href="/ferry#ferry-line-map"
            className="text-center text-xs font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
          >
            see the line map
          </Link>
        </div>
      </div>
    </div>
  );
}
