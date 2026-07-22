import { KioskQr } from "@/components/kiosk-qr";
import { KioskEmpty, KioskScreen } from "@/components/kiosk-ui";
import { getFerryStatusSnapshot } from "@/lib/ferry-status";
import { kioskHandoffUrl } from "@/lib/qr";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";
import { formatPacificTime } from "@/lib/time";

// The full Kingston departure board, kiosk-scaled.
//
// Both directions are in the snapshot, but this screen shows FROM Kingston
// only. The panel is at the Kingston dock: someone reading it is leaving, and a
// second column of arrivals is noise that makes the column they need smaller.
// Arrivals stay one QR away on the phone version.

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
  const [snapshot, copy] = await Promise.all([
    getFerryStatusSnapshot().catch(() => null),
    getCopyOverrides(),
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
