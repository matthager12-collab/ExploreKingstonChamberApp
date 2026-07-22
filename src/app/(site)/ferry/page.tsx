// The Ferry page — the app's front door for most visitors.
// Facts verified 2026-07-02 against WSDOT and Kitsap Transit sources
// (see docs/DATA_SOURCES.md). Fares typically change each October;
// every fare block links to its authoritative source.

import type { Metadata } from "next";
import {
  Badge,
  Callout,
  Card,
  ExternalLink,
  PageHeader,
  Section,
  mapDirectionsUrl,
} from "@/components/ui";
import {
  getRouteAlerts,
  getTerminalStatus,
  getTodaysSailings,
  getVesselLocations,
} from "@/lib/wsf";
import { FAST_FERRY_FACTS, getFastFerrySailings } from "@/lib/kitsap";
import { getCopyOverrides, copyText } from "@/lib/stores/site-store";
import { walkOnRoundTripFare } from "@/lib/data/ferry-info";
import { SAFETY_TOKEN_FALLBACKS } from "@/lib/i18n/safety-content";
import { getFerryInfo, type FareRow } from "@/lib/stores/ferry-info-store";
import { getWebcams } from "@/lib/stores/listing-stores";
import {
  assertPageVisible,
  getEffectiveHiddenPaths,
  HiddenPageBanner,
} from "@/lib/page-visibility";
import { FerryBoard } from "./ferry-board";
import { FerryVesselMap } from "@/components/ferry-vessel-map";
import { FerryLineInfo } from "@/components/ferry-line-info";
import { Sr104TrafficMap } from "@/components/sr104-traffic-map";
import { getSide } from "@/lib/side-server";
import { SideSwitcher } from "@/components/side-switcher";
import { getEmpiricalBusyness } from "@/lib/stores/ferry-observations";
import { getFerryPredictionAccess } from "@/lib/stores/ferry-prediction-store";
import { FerryBusyToday } from "@/components/ferry-busy-today";
import { FerryWebcamsBox } from "@/components/ferry-webcams-box";
import { todayPacific } from "@/lib/time";

export const metadata: Metadata = { title: "Ferry" };

// Regenerate at most once a minute so "today's sailings" never goes stale,
// even when the WSDOT key is missing and no fetches mark the page dynamic.
export const revalidate = 60;

const WSF_FARES_URL =
  "https://www.wsdot.wa.gov/ferries/fares/faresdetail.aspx?departingterm=8&arrivingterm=12";
const WSF_TICKETS_URL =
  "https://wsdot.wa.gov/travel/washington-state-ferries/tickets/ticket-information";

/** E27 — the structured fares block shared by all three /ferry fare sections.
 *  The senior/disability (RRFP) discount is a labeled row here, not a
 *  mid-sentence aside — that is the point of the M-01-06 remainder. Every
 *  figure is driven by the admin-editable ferryInfo.fares record. */
function FareList({ rows }: { rows: FareRow[] }) {
  return (
    <dl className="divide-y divide-sand">
      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2">
          <dt className="font-medium text-ink">{row.label}</dt>
          <dd className="text-sm font-semibold tabular-nums text-sound-deep">{row.amount}</dd>
          {row.note && <dd className="w-full text-xs text-ink-soft">{row.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** mapDirectionsUrl only offers walking/driving, but Google's dir API also accepts transit. */
function transitDirectionsUrl(destination: string): string {
  return mapDirectionsUrl(destination, "driving").replace(
    "travelmode=driving",
    "travelmode=transit",
  );
}

export default async function FerryPage() {
  const hiddenPreview = await assertPageVisible("/ferry");
  const [carFerry, kingston, edmonds, alerts, copy, ferryInfo, side, empirical, prediction, cams, hiddenPaths] =
    await Promise.all([
      getTodaysSailings(),
      getTerminalStatus("kingston"),
      getTerminalStatus("edmonds"),
      getRouteAlerts(),
      getCopyOverrides(),
      getFerryInfo(),
      getSide(),
      getEmpiricalBusyness(),
      getFerryPredictionAccess(),
      getWebcams(),
      getEffectiveHiddenPaths(),
    ]);
  const fastFerry = getFastFerrySailings();
  // The walk-on round trip is quoted mid-sentence further down, not just in the
  // fare table — same rule as /simple and /es: it comes from the record, and if
  // the record has no usable figure the sentence names none. The EN wording is
  // shared with the safety dictionary so all three pages say the same thing.
  const walkOnRoundTrip =
    walkOnRoundTripFare(ferryInfo.fares) ?? SAFETY_TOKEN_FALLBACKS.en.walkOnRoundTrip;
  const vessels = await getVesselLocations();
  const initial = { carFerry, fastFerry, terminals: { kingston, edmonds }, alerts };
  const serverNow = new Date().toISOString();
  const today = todayPacific();
  // Cameras for the side the visitor is on (same split as the Webcams page).
  const sideCams = cams.filter((w) =>
    side === "edmonds" ? w.id.startsWith("edmonds-") : !w.id.startsWith("edmonds-"),
  );
  const webcamsPageVisible = !hiddenPaths.includes("/webcams");

  return (
    <>
      {hiddenPreview && <HiddenPageBanner />}
      {side === "edmonds" ? (
        <PageHeader
          eyebrow={copyText(copy, "ferry.header.edmonds.eyebrow")}
          title={copyText(copy, "ferry.header.edmonds.title")}
          intro={copyText(copy, "ferry.header.edmonds.intro")}
        />
      ) : (
        <PageHeader
          eyebrow={copyText(copy, "ferry.header.eyebrow")}
          title={copyText(copy, "ferry.header.title")}
          intro={copyText(copy, "ferry.header.intro")}
        />
      )}

      <div className="mx-auto max-w-5xl px-4 pt-4">
        <SideSwitcher side={side} tone="light" />
      </div>

      {alerts.length > 0 && (
        <div className="mx-auto max-w-5xl px-4 pb-2">
          <Callout tone="coral" title="Service alerts right now">
            <ul className="list-disc space-y-1 pl-5">
              {alerts.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <p className="mt-2">
              Details at{" "}
              <ExternalLink href="https://wsdot.wa.gov/travel/washington-state-ferries">
                wsdot.wa.gov/ferries
              </ExternalLink>
              .
            </p>
          </Callout>
        </div>
      )}

      <div className="mx-auto max-w-5xl px-4 pt-2">
        <FerryLineInfo side={side} />
      </div>

      {/* Only shown when the prediction feature is live for visitors. While it's
          hidden, admins preview it on /ferry/plan, not here. */}
      {prediction.enabled && (
        <div className="mx-auto max-w-5xl px-4 pt-4">
          <FerryBusyToday
            today={today}
            serverNow={serverNow}
            defaultDirection={side === "edmonds" ? "to-kingston" : "from-kingston"}
            empirical={empirical.table}
            observed={{ sampleCount: empirical.sampleCount, days: empirical.days }}
          />
        </div>
      )}

      <Section title="Next boats" subtitle="Both routes, both directions. Updates every minute while you watch.">
        <FerryBoard initial={initial} serverNow={serverNow} side={side} />
      </Section>

      {/* Kingston's SR-104 boarding-pass line is only relevant when you're
          boarding AT Kingston. On the Edmonds side you board at the Edmonds dock
          (the FerryLineInfo edmonds variant covers that), so hide this Section. */}
      {side === "kingston" && (
        <Section
          id="ferry-line-map"
          title="Getting in the ferry line"
          subtitle="Kingston's SR 104 boarding-pass system, mapped — our take on WSDOT's traffic map."
        >
          {ferryInfo.boardingPass.currentNote.trim() && (
            <div className="mb-4">
              <Callout tone="coral" title="Heads up right now">
                <p>{ferryInfo.boardingPass.currentNote}</p>
              </Callout>
            </div>
          )}
          <Sr104TrafficMap />
        </Section>
      )}

      <Section>
        <FerryWebcamsBox
          cams={sideCams}
          sideLabel={side === "edmonds" ? "the Edmonds approach" : "the Kingston approach"}
          totalCount={cams.length}
          webcamsPageVisible={webcamsPageVisible}
        />
      </Section>

      <Section
        title="Where are the boats right now?"
        subtitle="Live positions of the Edmonds–Kingston ferries, like WSDOT's VesselWatch."
      >
        <FerryVesselMap initial={vessels} />
      </Section>

      <Section
        title="Walk on or drive?"
        subtitle="Walking on is cheaper, skips the car line entirely, and always gets a spot."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-sound-deep">Walk on</h3>
              <Badge tone="green">Free from Kingston</Badge>
            </div>
            {/* E27: fares are the structured, admin-editable ferryInfo.fares
                record now — the senior/disability (RRFP) discount is its own
                labeled row rather than a mid-sentence aside. */}
            <div className="mt-3">
              <FareList rows={ferryInfo.fares.walkOn} />
              <ul className="mt-3 space-y-2 text-sm text-ink-soft">
                <li>
                  <strong className="text-ink">Walk-ons always get on.</strong> Even when the car
                  line is hours long, foot passengers stroll aboard.
                </li>
              </ul>
            </div>
          </Card>
          <Card>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-sound-deep">Drive</h3>
              <Badge tone="navy">$27 each way</Badge>
            </div>
            {/* E27: drive-on fares from the structured record. */}
            <div className="mt-3">
              <FareList rows={ferryInfo.fares.drive} />
              <ul className="mt-3 space-y-2 text-sm text-ink-soft">
                <li>
                  <strong className="text-ink">No reservations on this route.</strong> It&rsquo;s
                  first come, first served — the crossing itself is about 30 minutes.
                </li>
                <li>
                  {/* E14 plain-language pass: 45 words, four chained actions, and
                      "tally" — staff vocabulary, not visitor vocabulary. Dropped. */}
                  <strong className="text-ink">Summer line rules:</strong> when it is busy, the line
                  of cars runs up SR 104. A boarding-pass system runs every day from 8 am to 8 pm.
                  Watch for the flashing sign at Barber Cutoff Rd. Take a pass from the machine near
                  Lindvog Rd. Stay in the line — if you leave it, your pass stops working.
                </li>
              </ul>
            </div>
          </Card>
        </div>
        <p className="mt-3 text-sm text-ink">
          {ferryInfo.fares.ratesAsOf} Confirm at{" "}
          <ExternalLink href={WSF_FARES_URL}>WSDOT&rsquo;s Edmonds–Kingston fare page</ExternalLink>
          .
        </p>
      </Section>

      <Section
        title="The $2 boat to Seattle"
        subtitle="Kitsap Transit's passenger-only fast ferry: Kingston to downtown in 39 minutes."
      >
        <Card>
          <div className="flex flex-wrap gap-2">
            <Badge tone="sand">No Sundays</Badge>
          </div>
          {/* E27: fast-ferry fares from the structured record. */}
          <div className="mt-4">
            <FareList rows={ferryInfo.fares.fastFerry} />
          </div>
          <p className="mt-3 text-sm text-ink-soft">
            The fare really is direction-based — cheap heading to Seattle, more coming back. Pay
            with ORCA, a contactless credit/debit tap, cash, or the Transit GO Ticket app.
          </p>
          <ul className="mt-3 space-y-2 text-sm text-ink-soft">
            <li>
              <strong className="text-ink">Seattle side: Pier 50, not Colman Dock.</strong>{" "}
              {FAST_FERRY_FACTS.seattleTerminal} Don&rsquo;t follow the car-ferry crowds into the
              big terminal next door.
            </li>
            <li>
              <strong className="text-ink">Kingston side:</strong>{" "}
              {FAST_FERRY_FACTS.kingstonTerminal}
            </li>
            <li>
              <strong className="text-ink">Boarding:</strong> {FAST_FERRY_FACTS.boarding}
            </li>
            <li>
              <strong className="text-ink">When it runs:</strong> weekdays year-round, and
              Saturdays in summer only (roughly May to September). Never Sundays.
              {/* E14 plain-language pass: this is the sentence that decides whether
                  someone is stranded in Seattle. It ended on a nominalization
                  ("plan evening returns through Edmonds"). */}{" "}
              The last weekday fast ferry home leaves Seattle at 6:45 pm. There are no later
              boats, not even on big game nights. If you are coming back in the evening, go
              through Edmonds instead.
            </li>
          </ul>
          <p className="mt-4 text-sm text-ink-soft">
            Watch the boat in real time on the{" "}
            <ExternalLink href={FAST_FERRY_FACTS.trackerUrl}>Kitsap Transit ferry tracker</ExternalLink>{" "}
            or check the{" "}
            <ExternalLink href={FAST_FERRY_FACTS.scheduleUrl}>full schedule</ExternalLink>.
          </p>
        </Card>
      </Section>

      <Section>
        <Callout title="Paying for the ferry">
          {/* E14 plain-language pass: four unexplained abbreviations, the finance
              term "surcharge", and an exception nested in parentheses inside the
              instruction the reader has to act on at the toll booth. */}
          <p>
            You can pay at the Kingston toll booths with a card — Visa, Mastercard, American
            Express, or Discover — or with an ORCA transit card. Card payments add a 3% fee, and
            have since March 2026. To avoid that fee, tap an ORCA card you loaded with money
            somewhere other than a ferry terminal. Best of all: walking onto the boat in Kingston
            is free. Fares are only collected on the Edmonds side, so most walk-on visitors pay
            nothing at the dock. A Good To Go! pass is for highway tolls only. It will not pay for
            the ferry.
          </p>
          <p className="mt-2">
            Driving on? In the busy season — every day from 8 am to 8 pm, plus weekends and
            holidays — you need a vehicle boarding pass from the SR 104 line. Take one from the
            machine near Lindvog Rd, and stay in the line: if you leave it, the pass stops working.
            You do not need a pass if you are walking on, riding a bike, or riding a motorcycle.
          </p>
          <p className="mt-2">
            Full payment details:{" "}
            <ExternalLink href={WSF_TICKETS_URL}>WSF ticket information</ExternalLink>.
          </p>
          {ferryInfo.sources.length > 0 && (
            <p className="mt-2 text-xs">
              Sources:{" "}
              {ferryInfo.sources.map((s, i) => (
                <span key={s.url}>
                  {i > 0 && " · "}
                  <ExternalLink href={s.url}>{s.label}</ExternalLink>
                </span>
              ))}
            </p>
          )}
        </Callout>
      </Section>

      <Section title="Watch out for">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <h3 className="text-lg font-semibold text-sound-deep">Holiday weekends</h3>
            <p className="mt-2 text-sm text-ink-soft">
              Summer holiday weekends are the car ferry&rsquo;s worst stretch, and Kingston sits
              at the center of it. Expect multi-hour vehicle lines in both directions. Walk on if
              you possibly can.
            </p>
          </Card>
          <Card>
            <h3 className="text-lg font-semibold text-sound-deep">Hood Canal Bridge</h3>
            <p className="mt-2 text-sm text-ink-soft">
              Heading west to the Olympic Peninsula? SR 104 crosses the Hood Canal Bridge about 14
              miles from town, and drawspan openings for boat traffic can stop the highway for 45+
              minutes with little warning. Check the bridge status on{" "}
              <ExternalLink href="https://wsdot.wa.gov">wsdot.wa.gov</ExternalLink> before you
              commit to the drive.
            </p>
          </Card>
          <Card>
            <h3 className="text-lg font-semibold text-sound-deep">Seasonal schedules</h3>
            <p className="mt-2 text-sm text-ink-soft">
              Both boats change timetables with the seasons. The fast ferry&rsquo;s Saturday
              service ends in mid-September, and WSF shifts to its fall schedule around then
              too. Planning past Labor Day? Re-check times first.
            </p>
          </Card>
        </div>
      </Section>

      <Section
        title="Coming from Seattle without a car"
        subtitle="Two good routes — and on Sundays, Edmonds is the only one."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <h3 className="text-lg font-semibold text-sound-deep">Fast ferry from Pier 50</h3>
            <p className="mt-2 text-sm text-ink-soft">
              Downtown to downtown in 39 minutes: $13 out, $2 back, kids free. Weekdays and summer
              Saturdays only — no Sunday boats, and the last weekday departure from Seattle is
              6:45 PM.
            </p>
            <p className="mt-3 text-sm">
              <ExternalLink href={transitDirectionsUrl("Pier 50, 801 Alaskan Way, Seattle, WA")}>
                Transit directions to Pier 50
              </ExternalLink>
            </p>
          </Card>
          <Card>
            <h3 className="text-lg font-semibold text-sound-deep">
              Train or bus to Edmonds, then walk on
            </h3>
            <p className="mt-2 text-sm text-ink-soft">
              Sounder trains and Amtrak Cascades stop at Edmonds Station, right beside the ferry
              dock; Community Transit buses stop nearby too. Walk on for {walkOnRoundTrip} — that
              covers the whole round trip, since boarding in Kingston is free. And it works on
              Sundays, when the fast ferry doesn&rsquo;t run.
            </p>
            <p className="mt-3 text-sm">
              <ExternalLink href={transitDirectionsUrl("Edmonds Ferry Terminal, Edmonds, WA")}>
                Transit directions to the Edmonds ferry dock
              </ExternalLink>
            </p>
          </Card>
        </div>
      </Section>
    </>
  );
}
