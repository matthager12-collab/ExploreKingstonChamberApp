import { KioskQr } from "@/components/kiosk-qr";
import { KioskTides } from "@/components/kiosk-tides";
import { KioskEmpty, KioskScreen } from "@/components/kiosk-ui";
import { getFerryStatusSnapshot } from "@/lib/ferry-status";
import { kioskHandoffUrl } from "@/lib/qr";
import { getFerryInfo } from "@/lib/stores/ferry-info-store";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";
import { getTodaysTides } from "@/lib/tides";
import { formatPacificTime } from "@/lib/time";

// The full Kingston departure board, kiosk-scaled.
//
// Both directions are in the snapshot, but this screen shows FROM Kingston
// only. The panel is at the Kingston dock: someone reading it is leaving, and a
// second column of arrivals is noise that makes the column they need smaller.
// Arrivals stay one QR away on the phone version.
//
// WALKING ON IS THE HEADLINE, and it sits above the fares table on purpose.
// The single most useful thing this panel can tell the person standing in front
// of it is that walking onto the boat at Kingston costs nothing — WSF collects
// passenger fares at Edmonds only — and that foot passengers never need the
// boarding pass the vehicle signage is all about. Both facts are the Chamber's
// own admin-editable ferry record, not restated here, so a fare change or a
// policy correction reaches the kiosk the same way it reaches the website.

export const revalidate = 60;

/**
 * Departures from Kingston that have not already left, soonest first.
 *
 * `now` is passed in rather than read here so the clock read stays out of the
 * component body — the react-hooks lint rule counts Date.now() there as an
 * impure render call.
 */
function departingSoon(
  snapshot: NonNullable<Awaited<ReturnType<typeof getFerryStatusSnapshot>>>,
  now: number = Date.now(),
) {
  return snapshot.carFerry.sailings
    .filter((s) => s.direction === "from-kingston" && Date.parse(s.departs) >= now)
    .slice(0, 8);
}

export default async function KioskFerryPage() {
  const [snapshot, copy, ferryInfo, tides] = await Promise.all([
    getFerryStatusSnapshot().catch(() => null),
    getCopyOverrides(),
    getFerryInfo(),
    // Each of these degrades on its own. A NOAA outage must not cost the panel
    // its departure board, and a WSDOT outage must not cost it the tides.
    getTodaysTides().catch(() => []),
  ]);

  if (!snapshot) {
    return (
      <KioskScreen title="Ferry" subtitle="Kingston to Edmonds">
        <KioskEmpty>
          Ferry times are briefly unavailable here. The terminal board a few steps away has the
          live departures.
        </KioskEmpty>
      </KioskScreen>
    );
  }

  const departures = departingSoon(snapshot);
  const spaceByDeparture = new Map(
    snapshot.sailingSpace.kingston.map((s) => [s.departs, s.driveUpSpaces]),
  );

  return (
    <KioskScreen
      title="Ferry"
      subtitle={
        snapshot.carFerry.live
          ? "Kingston to Edmonds — live from WSDOT"
          : "Kingston to Edmonds — published schedule, live times unavailable"
      }
    >
      {snapshot.alerts.length > 0 && (
        <div className="mb-8 rounded-3xl bg-coral-deep p-10">
          {snapshot.alerts.slice(0, 2).map((alert) => (
            <p key={alert} className="text-3xl leading-relaxed font-semibold text-white">
              {alert}
            </p>
          ))}
        </div>
      )}

      {/* WALKING ON — above the board on purpose. Most people reading this are
          on foot, and "it's free from here" is the single most useful sentence
          the panel has. Both facts come from the admin-editable ferry record. */}
      <section className="mb-10 rounded-3xl bg-fern p-10" aria-labelledby="kiosk-walkon">
        <h2 id="kiosk-walkon" className="text-5xl font-semibold text-white">
          Walking on? It&apos;s free from Kingston.
        </h2>
        <p className="mt-4 text-3xl leading-relaxed text-white">{ferryInfo.payment.freeLegNote}</p>
        <p className="mt-4 text-3xl leading-relaxed text-white">{ferryInfo.boardingPass.exempt}</p>
      </section>

      {departures.length === 0 ? (
        <KioskEmpty>No further sailings are listed today. Check the terminal board.</KioskEmpty>
      ) : (
        <ul className="mb-10">
          {departures.map((s) => {
            const spaces = spaceByDeparture.get(s.departs);
            return (
              <li
                key={s.departs}
                className="mb-6 flex items-center justify-between gap-8 rounded-3xl bg-white/10 px-10 py-8"
              >
                <span className="text-6xl font-semibold text-white tabular-nums">
                  {formatPacificTime(s.departs)}
                </span>
                <span className="text-3xl text-white/70">{s.vessel ?? ""}</span>
                <span className="text-3xl text-white/85">
                  {typeof spaces === "number"
                    ? spaces > 0
                      ? `${spaces} car spaces`
                      : "Car deck full"
                    : "Walk-on space"}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* Coming back the other way, and what it costs. Rendered from the same
          structured fares the website uses, so October's WSF adjustment is one
          edit in /admin/ferry-info rather than a code change in two places. */}
      <section className="mb-10" aria-labelledby="kiosk-fares">
        <h2 id="kiosk-fares" className="mb-6 text-4xl font-semibold text-white/80">
          Coming back from Edmonds
        </h2>
        <ul>
          {ferryInfo.fares.walkOn.map((row) => (
            <li
              key={row.label}
              className="mb-4 flex flex-wrap items-baseline justify-between gap-6 rounded-2xl bg-white/10 px-8 py-6"
            >
              <span className="text-3xl text-white">{row.label}</span>
              <span className="text-3xl font-semibold text-white tabular-nums">{row.amount}</span>
              {row.note && <span className="w-full text-2xl text-white/70">{row.note}</span>}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-2xl text-white/60">Fares as of {ferryInfo.fares.ratesAsOf}.</p>
      </section>

      {/* Tides — the shoreline is what most visitors walk to, and the cove is a
          different place at a minus low than a plus-eleven high. */}
      <section className="mb-10" aria-labelledby="kiosk-tides">
        <h2 id="kiosk-tides" className="mb-6 text-4xl font-semibold text-white/80">
          Tides at Appletree Cove today
        </h2>
        <KioskTides tides={tides} />
      </section>

      <div className="flex items-center gap-10 rounded-3xl bg-white/10 p-10">
        <KioskQr
          value={kioskHandoffUrl("/ferry")}
          caption={copyText(copy, "kiosk.handoff.prompt")}
          size="sm"
        />
        <p className="text-3xl leading-relaxed text-white/85">
          Both directions, fares, and the fast ferry — on your phone, and it keeps working in the
          queue when the signal drops.
        </p>
      </div>
    </KioskScreen>
  );
}
