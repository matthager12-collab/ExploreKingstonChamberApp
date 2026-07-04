// Compact "getting in the ferry line" callout — Kingston's SR 104 boarding-pass
// (ATMS) system in three steps, with a Navigate button to the terminal.
// Used up top on /ferry and on the home screen. Server component; the Navigate
// button is a plain Google Maps directions deep link (no API key).
//
// Every text bit is Chamber-editable (registry group "Ferry line card"). Since
// this is a shared server component with no props threaded from its callers, it
// reads getCopyOverrides() itself — one extra store read per render, which is
// cheap and keeps the callers (home + /ferry) untouched. Bold emphasis lives
// inside the editable strings as **bold** and renders via <RichText/>.

import Link from "next/link";
import { mapDirectionsUrl } from "@/components/ui";
import { RichText } from "@/components/rich-text";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";

const TERMINAL = "Kingston Ferry Terminal, Kingston, WA 98346";

export async function FerryLineInfo({ className = "" }: { className?: string }) {
  const copy = await getCopyOverrides();
  return (
    <div
      className={`rounded-2xl border border-coral/40 bg-coral/5 p-5 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-lg font-semibold text-sound-deep">
            <span aria-hidden>🚗</span>{" "}
            {copyText(copy, "ferryLine.title", "Driving onto the ferry?")}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            <RichText
              text={copyText(
                copy,
                "ferryLine.body1",
                "When the overhead signs at **SR 104 & Barber Cutoff Rd** are flashing, Kingston's boarding-pass system is on. Follow the signal into the ferry lane, **take a pass at the dispenser near Lindvog Rd**, then wait for a green light to pull up to the tollbooths — leave the line and your pass is void.",
              )}
            />
          </p>
          <p className="mt-1.5 text-sm text-ink-soft">
            <RichText
              text={copyText(
                copy,
                "ferryLine.body2",
                "Active daily **8 a.m.–8 p.m.** in season, plus weekends and holidays. Walk-ons, cyclists, and motorcycles skip it.",
              )}
            />
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-1.5">
          <a
            href={mapDirectionsUrl(TERMINAL, "driving")}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-coral px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-coral-deep"
          >
            {copyText(copy, "ferryLine.navButton", "Navigate to the ferry →")}
          </a>
          <Link
            href="/ferry#ferry-line-map"
            className="text-center text-xs font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
          >
            {copyText(copy, "ferryLine.mapLink", "see the line map")}
          </Link>
        </div>
      </div>
    </div>
  );
}
