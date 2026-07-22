import { KioskQr, displayHost } from "@/components/kiosk-qr";
import { KioskScreen } from "@/components/kiosk-ui";
import { KINGSTON_BUS_ROUTES, KINGSTON_RIDE, KITSAP_TRANSIT } from "@/lib/kitsap-bus";

// Buses from the ferry dock, kiosk-scaled.
//
// The audience is a walk-on passenger who has just got off the boat with no car
// and wants to know how to get further than walking distance — the one question
// the rest of the kiosk cannot answer.
//
// NO DEPARTURE TIMES ON THIS SCREEN, on purpose. See src/lib/kitsap-bus.ts: the
// GTFS feed the fast-ferry times came from expires 2026-09-12, and a stale
// timetable on a wall nobody can correct is worse than no timetable. This screen
// carries the facts that do not rot and puts the live schedule on the visitor's
// phone, where it is always current.

export const revalidate = 60;

export default async function KioskBusPage() {
  return (
    <KioskScreen title="Buses" subtitle="Getting further than walking distance, without a car">
      {/* Where to stand comes first — it is the only thing a visitor has to act
          on in the next sixty seconds. */}
      <section className="mb-10 rounded-3xl bg-tide-deep p-10">
        <h2 className="text-4xl font-semibold text-white">Where to catch them</h2>
        <p className="mt-4 text-3xl leading-relaxed text-white">{KITSAP_TRANSIT.stop}</p>
      </section>

      <h2 className="mb-6 text-4xl font-semibold text-white/80">Routes from the dock</h2>
      {KINGSTON_BUS_ROUTES.map((route) => (
        <article key={route.number} className="mb-8 flex items-start gap-10 rounded-3xl bg-white/10 p-10">
          <span className="shrink-0 rounded-2xl bg-white px-8 py-4 text-5xl font-semibold text-sound-deep tabular-nums">
            {route.number}
          </span>
          <div className="min-w-0">
            <h3 className="text-4xl font-semibold text-white">{route.name}</h3>
            <p className="mt-3 text-2xl leading-relaxed text-white/85">{route.goes}</p>
          </div>
        </article>
      ))}

      <article className="mb-10 rounded-3xl bg-white/10 p-10">
        <h3 className="text-4xl font-semibold text-white">{KINGSTON_RIDE.name}</h3>
        <p className="mt-3 text-2xl leading-relaxed text-white/85">{KINGSTON_RIDE.what}</p>
      </article>

      {/* The live schedule, on the device that can keep it current. Phone number
          in words too: a visitor with no phone data, or one who would simply
          rather ask a person, still gets an answer. */}
      <div className="flex items-center gap-10 rounded-3xl bg-white/10 p-10">
        <KioskQr
          value={KITSAP_TRANSIT.url}
          caption="Times and fares on your phone"
          hint={displayHost(KITSAP_TRANSIT.url)}
          size="sm"
        />
        <div className="min-w-0">
          <p className="text-3xl leading-relaxed text-white/85">
            Kitsap Transit publishes the live timetable and fares. Scan for today&apos;s times.
          </p>
          <p className="mt-4 text-3xl leading-relaxed text-white">
            Or call Kitsap Transit on{" "}
            <span className="font-semibold tabular-nums">{KITSAP_TRANSIT.phone}</span>
            {" — toll free "}
            <span className="font-semibold">{KITSAP_TRANSIT.tollFreePhone}</span>.
          </p>
        </div>
      </div>
    </KioskScreen>
  );
}
