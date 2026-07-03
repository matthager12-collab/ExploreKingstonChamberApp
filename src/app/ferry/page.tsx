// The Ferry page — the app's front door for most visitors.
// Facts verified 2026-07-02 against WSDOT and Kitsap Transit sources
// (see docs/DATA_SOURCES.md). Fares typically change each October;
// every fare block links to its authoritative source.

import type { Metadata } from "next";
import Link from "next/link";
import {
  Badge,
  Callout,
  Card,
  ExternalLink,
  PageHeader,
  Section,
  mapDirectionsUrl,
} from "@/components/ui";
import { getRouteAlerts, getTerminalStatus, getTodaysSailings } from "@/lib/wsf";
import { FAST_FERRY_FACTS, getFastFerrySailings } from "@/lib/kitsap";
import { FerryBoard } from "./ferry-board";

export const metadata: Metadata = { title: "Ferry" };

// Regenerate at most once a minute so "today's sailings" never goes stale,
// even when the WSDOT key is missing and no fetches mark the page dynamic.
export const revalidate = 60;

const WSF_FARES_URL =
  "https://www.wsdot.wa.gov/ferries/fares/faresdetail.aspx?departingterm=8&arrivingterm=12";
const WSF_TICKETS_URL =
  "https://wsdot.wa.gov/travel/washington-state-ferries/tickets/ticket-information";

/** mapDirectionsUrl only offers walking/driving, but Google's dir API also accepts transit. */
function transitDirectionsUrl(destination: string): string {
  return mapDirectionsUrl(destination, "driving").replace(
    "travelmode=driving",
    "travelmode=transit",
  );
}

export default async function FerryPage() {
  const [carFerry, kingston, edmonds, alerts] = await Promise.all([
    getTodaysSailings(),
    getTerminalStatus("kingston"),
    getTerminalStatus("edmonds"),
    getRouteAlerts(),
  ]);
  const fastFerry = getFastFerrySailings();
  const initial = { carFerry, fastFerry, terminals: { kingston, edmonds }, alerts };

  return (
    <>
      <PageHeader
        eyebrow="Getting here and back"
        title="Ferry times"
        intro="Two boats serve Kingston: the Edmonds–Kingston car ferry — about 30 minutes, every day, walk-ons welcome — and a passengers-only fast ferry straight to downtown Seattle in 39 minutes."
      />

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

      <Section title="Next boats" subtitle="Both routes, both directions. Updates every minute while you watch.">
        <FerryBoard initial={initial} serverNow={new Date().toISOString()} />
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
            <ul className="mt-3 space-y-2 text-sm text-ink-soft">
              <li>
                <strong className="text-ink">A walk-on round trip costs $11.35, total.</strong>{" "}
                WSF collects passenger fares only at Edmonds — boarding in Kingston is free, in
                either trip order. Seniors and riders with disabilities pay $5.65; kids 18 and
                under ride free.
              </li>
              <li>
                <strong className="text-ink">Walk-ons always get on.</strong> Even when the car
                line is hours long, foot passengers stroll aboard.
              </li>
              <li>
                <strong className="text-ink">Bikes roll on with walk-ons</strong> — free leaving
                Kingston, pay at Edmonds coming back. The fast ferry takes bikes too.
              </li>
            </ul>
          </Card>
          <Card>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-sound-deep">Drive</h3>
              <Badge tone="navy">$27 each way</Badge>
            </div>
            <ul className="mt-3 space-y-2 text-sm text-ink-soft">
              <li>
                <strong className="text-ink">Car and driver: $27.00</strong> (standard vehicle
                under 22 ft), paid in both directions. Motorcycles $11.80. Each extra passenger
                adds $11.35, collected at Edmonds only.
              </li>
              <li>
                <strong className="text-ink">No reservations on this route.</strong> It&rsquo;s
                first come, first served — the crossing itself is about 30 minutes.
              </li>
              <li>
                <strong className="text-ink">Summer line rules:</strong> when it&rsquo;s busy, the
                holding line runs up SR 104 and a boarding-pass (&ldquo;tally&rdquo;) system runs
                daily 8 am–8 pm. Watch for the flashing sign at Barber Cutoff Rd, then take a pass
                at the dispenser near Lindvog Rd and stay in line — leaving voids it.
              </li>
            </ul>
          </Card>
        </div>
        <p className="mt-3 text-sm text-ink-soft">
          Fares above are summer 2026 rates, checked July 2026 — WSF usually adjusts fares each
          October. Confirm at{" "}
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
            <Badge tone="coral">$2 to Seattle</Badge>
            <Badge tone="navy">$13 coming back</Badge>
            <Badge tone="green">Kids 18 and under free</Badge>
            <Badge tone="sand">No Sundays</Badge>
          </div>
          <p className="mt-4 text-sm text-ink-soft">
            The fare really is direction-based: {FAST_FERRY_FACTS.fares}
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
              <strong className="text-ink">When it runs:</strong> weekdays year-round, Saturdays
              in summer only (roughly May–September), never Sundays. The last weekday boat home
              leaves Seattle at 6:45 PM — there are no late-night runs, even on big game nights,
              so plan evening returns through Edmonds.
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
        <Callout title="Money on the boat">
          <p>
            Cards (Visa, Mastercard, Amex, Discover) work at the WSF tollbooths, but every
            credit/debit purchase carries a 3% surcharge (since March 2026). Two ways to skip it:
            pay <span className="font-medium">cash at the staffed tollbooth</span> (the self-serve
            ticket kiosks are card-only, but the booth takes bills), or tap a pre-loaded ORCA card
            (as long as you didn&rsquo;t load it at a WSF facility). Best of all: walking on from
            Kingston is free — fares are collected at Edmonds — so most walk-on visitors pay nothing
            at the dock. Good To Go! is highway tolling only — it will not pay for a ferry.
          </p>
          <p className="mt-2">
            Driving on? During peak periods (daily 8 am–8 pm in season, plus weekends and holidays)
            you&rsquo;ll need a vehicle boarding pass from the SR 104 holding line — take one at the
            dispenser near Lindvog Rd, and don&rsquo;t leave the line or it&rsquo;s void. Walk-ons,
            cyclists, and motorcycles are exempt.
          </p>
          <p className="mt-2">
            On the fast ferry: tap a card or phone, use ORCA, or bring exact cash — the crew
            carries no change.
          </p>
          <p className="mt-2">
            Need bills, or the full cash-and-boarding rundown? See the{" "}
            <Link
              href="/parking#atms"
              className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
            >
              cash &amp; boarding guide for Kingston
            </Link>
            . Full payment details:{" "}
            <ExternalLink href={WSF_TICKETS_URL}>WSF ticket information</ExternalLink>.
          </p>
        </Callout>
      </Section>

      <Section title="Watch out for">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <h3 className="text-lg font-semibold text-sound-deep">July 4th crowds</h3>
            <p className="mt-2 text-sm text-ink-soft">
              Independence Day is the car ferry&rsquo;s worst day of the year, and Kingston&rsquo;s
              fireworks put the town at the center of it. Expect multi-hour vehicle lines both
              directions. Walk on if you possibly can — and this year the 4th lands on a Saturday,
              so the fast ferry runs its summer Saturday schedule too.
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
              service ends in mid-September, and its current published schedule runs through
              September 12, 2026. WSF shifts to its fall schedule around then too. Planning past
              Labor Day? Re-check times first.
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
              dock; Community Transit buses stop nearby too. Walk on for $11.35 — that covers the
              whole round trip, since boarding in Kingston is free. And it works on Sundays, when
              the fast ferry doesn&rsquo;t run.
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
