import type { TidePrediction } from "@/lib/tides";

// Today's high and low water at Appletree Cove, kiosk-scaled.
//
// Worth a strip on a ferry-dock panel because Kingston's shoreline is the thing
// most visitors walk to, and the beach at Point No Point and the cove itself are
// completely different places at a -2ft low than at a +11ft high. It is also the
// question the Chamber office gets asked that no other screen here answers.
//
// Same NOAA source the website uses (station 9445639, keyless, 6-hour
// revalidate) — no new data dependency, and it degrades to nothing rather than
// to a guess: an empty list renders an honest line, never an invented tide.

/** NOAA hands back station-local "YYYY-MM-DD HH:MM"; the clock half is what we show. */
function clockOf(noaaTime: string): string {
  return noaaTime.slice(11);
}

export function KioskTides({ tides }: { tides: TidePrediction[] }) {
  if (tides.length === 0) {
    // Deliberately says WHERE the real answer is rather than just failing. A
    // visitor who needs the tide can act on this; "unavailable" alone cannot.
    return (
      <p className="text-2xl text-white/70">
        Tide times are unavailable right now — the NOAA board at the marina has today&apos;s
        predictions.
      </p>
    );
  }

  return (
    <ul className="flex flex-wrap gap-6">
      {tides.map((t) => (
        <li
          key={t.time}
          className="flex min-w-[13rem] flex-1 items-baseline gap-4 rounded-2xl bg-white/10 px-8 py-5"
        >
          {/* The word carries the meaning, not the colour — the same
              non-colour-alone rule the rest of the app follows. */}
          <span className="text-3xl font-semibold text-white">
            {t.type === "high" ? "High" : "Low"}
          </span>
          <span className="text-4xl font-semibold text-white tabular-nums">{clockOf(t.time)}</span>
          <span className="text-2xl text-white/70 tabular-nums">{t.heightFeet.toFixed(1)} ft</span>
        </li>
      ))}
    </ul>
  );
}
