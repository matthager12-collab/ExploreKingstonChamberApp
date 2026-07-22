import type { FerryStatusSnapshot } from "@/lib/ferry-status";
import { formatPacificTime } from "@/lib/time";

// The next-sailings strip on the kiosk home screen.
//
// This is the single most important thing on the whole device: most people
// standing in front of it are trying to catch a boat, and the panel is a few
// steps from the terminal. So it renders BEFORE the category buttons, is
// readable from further away than anything else, and never hides behind a tap.
//
// Deliberately NOT the site's <NextFerries/> widget. That one is a client
// component that polls every 60s, ticks a countdown every 20s, and carries
// reminder/ICS affordances that make no sense without a phone. On the kiosk the
// server render plus the shell's freshness reload is enough, and every timer
// removed is one less thing to leak on a panel that runs for weeks.

/** Departures from Kingston — the direction someone at this dock is leaving in. */
function departingSoon(snapshot: FerryStatusSnapshot, limit: number) {
  const now = Date.now();
  return snapshot.carFerry.sailings
    .filter((s) => s.direction === "from-kingston" && Date.parse(s.departs) >= now)
    .slice(0, limit);
}

export function KioskFerryStrip({ snapshot }: { snapshot: FerryStatusSnapshot }) {
  const next = departingSoon(snapshot, 3);
  // Drive-up space, keyed by departure time, so a car driver sees whether the
  // boat they are reading about still has room.
  const spaceByDeparture = new Map(
    snapshot.sailingSpace.kingston.map((s) => [s.departs, s.driveUpSpaces]),
  );

  return (
    <section className="shrink-0 bg-tide-deep px-16 py-10" aria-labelledby="kiosk-ferry-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 id="kiosk-ferry-heading" className="text-4xl font-semibold text-white">
          Next ferries to Edmonds
        </h2>
        {/* The honesty flag the whole ferry stack carries: when WSDOT is not
            answering we say the times are the published schedule, rather than
            letting someone miss a boat trusting a number we did not verify. */}
        {!snapshot.carFerry.live && (
          <p className="text-2xl text-white/80">Published schedule — live times unavailable</p>
        )}
      </div>

      {next.length === 0 ? (
        <p className="mt-6 text-3xl text-white/90">
          No more sailings listed today — check the terminal board.
        </p>
      ) : (
        <ul className="mt-6 flex gap-8">
          {next.map((sailing) => {
            const spaces = spaceByDeparture.get(sailing.departs);
            return (
              <li key={sailing.departs} className="flex-1 rounded-2xl bg-white/15 px-8 py-6">
                <p className="text-6xl font-semibold text-white tabular-nums">
                  {formatPacificTime(sailing.departs)}
                </p>
                {sailing.vessel && <p className="mt-2 text-2xl text-white/80">{sailing.vessel}</p>}
                {typeof spaces === "number" && (
                  <p className="mt-2 text-2xl text-white/80">
                    {spaces > 0 ? `${spaces} car spaces left` : "Car deck full"}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {snapshot.alerts.length > 0 && (
        <p className="mt-6 rounded-2xl bg-coral-deep px-8 py-5 text-3xl font-semibold text-white">
          {snapshot.alerts[0]}
        </p>
      )}
    </section>
  );
}
