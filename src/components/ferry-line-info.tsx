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
import { getEffectiveBoardingPass } from "@/lib/stores/boarding-pass-store";
import { getTerminalStatus } from "@/lib/wsf";
import { ferryLineNavUrl, lineBacksPastBarberCutoff } from "@/lib/ferry-line";
import type { WaterSide } from "@/lib/side";

const TERMINAL = "Kingston Ferry Terminal, Kingston, WA 98346";
const EDMONDS_TERMINAL = "Edmonds Ferry Terminal, Edmonds, WA";

export async function FerryLineInfo({
  className = "",
  side = "kingston",
}: {
  className?: string;
  side?: WaterSide;
}) {
  const copy = await getCopyOverrides();

  // Across the water you board at EDMONDS — Kingston's SR-104 boarding-pass line
  // only matters for the trip back. Show directions to the Edmonds dock instead.
  if (side === "edmonds") {
    return (
      <div className={`rounded-2xl border border-coral/40 bg-coral/5 p-5 ${className}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-lg font-semibold text-sound-deep">
              <span aria-hidden>🚗</span>{" "}
              {copyText(copy, "ferryLine.edmonds.title")}
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              <RichText
                text={copyText(copy, "ferryLine.edmonds.body1")}
              />
            </p>
            <p className="mt-1.5 text-sm text-ink-soft">
              <RichText
                text={copyText(copy, "ferryLine.edmonds.body2")}
              />
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-stretch gap-1.5">
            <a
              href={mapDirectionsUrl(EDMONDS_TERMINAL, "driving")}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-full bg-coral px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-coral-deep"
            >
              {copyText(copy, "ferryLine.edmonds.navButton")}
            </a>
          </div>
        </div>
      </div>
    );
  }

  const pass = await getEffectiveBoardingPass();
  const kingston = await getTerminalStatus("kingston");
  // Over a 2-hour driver wait means the line is past Barber Cutoff — route the
  // turnaround out to Miller Bay Rd instead.
  const longWait = lineBacksPastBarberCutoff(kingston.waitEstimate);
  // Pass ON → the SR-104 line staging point, forced in via the right turnaround
  // road so nobody U-turns into the line early. Pass OFF → straight to the dock.
  const navHref = pass.active ? ferryLineNavUrl(longWait) : mapDirectionsUrl(TERMINAL, "driving");
  return (
    <div
      className={`rounded-2xl border border-coral/40 bg-coral/5 p-5 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-lg font-semibold text-sound-deep">
            <span aria-hidden>🚗</span>{" "}
            {copyText(copy, "ferryLine.title")}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            <RichText
              text={copyText(copy, "ferryLine.body1")}
            />
          </p>
          <p className="mt-1.5 text-sm text-ink-soft">
            <RichText
              text={copyText(copy, "ferryLine.body2")}
            />
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-1.5">
          <a
            href={navHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-coral px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-coral-deep"
          >
            {pass.active
              ? copyText(copy, "ferryLine.navButtonPass")
              : copyText(copy, "ferryLine.navButton")}
          </a>
          {pass.active && (
            <p className="max-w-[12rem] text-center text-xs text-coral-deep">
              {longWait
                ? "Wait's over 2 hours — the line is past Barber Cutoff. Routing you out via Miller Bay Rd to join the back; don't U-turn early."
                : "Boarding pass on — routing you to the back of the SR-104 line via Barber Cutoff (not the dock). Don't U-turn early."}
            </p>
          )}
          <Link
            href="/ferry#ferry-line-map"
            className="text-center text-xs font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
          >
            {copyText(copy, "ferryLine.mapLink")}
          </Link>
        </div>
      </div>
    </div>
  );
}
