import type { Metadata } from "next";
import {
  PageHeader,
  Section,
  Card,
  Badge,
  Callout,
  ExternalLink,
  mapSearchUrl,
  mapDirectionsUrl,
} from "@/components/ui";
import { TownMap, MapLegend } from "@/components/town-map";
import { RULE_LABELS, type MapZone, type ParkingRule } from "@/lib/data/parking";
import { getParkingZones } from "@/lib/stores/parking-store";
import { atms, atmMeta } from "@/lib/data/atms";
import { FERRY_PAYMENT, BOARDING_PASS, SOURCES } from "@/lib/data/ferry-info";

// Zones come from the parking-zones store (seed + Chamber-admin overlay), so
// corrections made at /admin/map go live here within a minute.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Parking & ATMs",
  description:
    "Interactive map of every place to park in Kingston, WA — the Port lots, the free 2-hour zone, street parking, overnight options — plus every ATM near the ferry dock.",
};

/* ------------------------------------------------------------------ */
/* Parking card helpers                                                */
/* ------------------------------------------------------------------ */

const RULE_BADGE_TONE: Record<ParkingRule, "green" | "teal" | "navy" | "sand" | "coral"> = {
  "free-2hr": "green",
  "free-unrestricted": "teal",
  paid: "navy",
  "park-and-ride-24h": "sand",
  prohibited: "coral",
  "load-zone": "sand",
  permit: "coral",
};

const GROUPS: { rule: ParkingRule; title: string; blurb: string }[] = [
  {
    rule: "free-2hr",
    title: "Free — 2-hour limit",
    blurb:
      "Fine for lunch and a stroll; wrong for ferry trips. The 2-hour limits are enforced.",
  },
  {
    rule: "free-unrestricted",
    title: "Free street parking — no time limit",
    blurb:
      "The closest truly unlimited free parking to the dock. Obey posted signs — they always win.",
  },
  {
    rule: "paid",
    title: "Paid lots",
    blurb: "The reliable options for ferry travel and longer stays.",
  },
  {
    rule: "park-and-ride-24h",
    title: "Free park & rides — 24 hours max",
    blurb:
      "Free with bus connections to the ferry, but capped at 24 hours — day trips, not getaways.",
  },
];

function overnightText(zone: MapZone): string {
  if (zone.overnight === "yes")
    return "Overnight: OK — but check out the details first.";
  if (zone.overnight === "no") return "Overnight: no.";
  return zone.id.startsWith("port-")
    ? "Overnight: call the Port office first — 360-297-3545."
    : "Overnight: confirm on-site first.";
}

function ZoneCard({ zone }: { zone: MapZone }) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="text-lg font-semibold text-sound-deep">{zone.name}</h4>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={RULE_BADGE_TONE[zone.rule]}>{RULE_LABELS[zone.rule]}</Badge>
          {zone.confidence === "unverified" && (
            <Badge tone="coral">Unverified — field-check</Badge>
          )}
        </div>
      </div>

      <p className="text-sm text-ink">{zone.summary}</p>
      <p className="text-sm font-semibold text-ink">{overnightText(zone)}</p>
      <p className="text-sm text-ink-soft">{zone.details}</p>

      {zone.confidence !== "verified" && zone.sourceNote && (
        <p className="text-xs italic text-ink-soft">{zone.sourceNote}</p>
      )}

      <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm">
        <ExternalLink
          href={mapDirectionsUrl(`${zone.center[0]},${zone.center[1]}`, "driving")}
        >
          Directions
        </ExternalLink>
        <ExternalLink href={mapSearchUrl(`${zone.center[0]},${zone.center[1]}`)}>
          Open in Maps
        </ExternalLink>
        {zone.sourceUrl && <ExternalLink href={zone.sourceUrl}>Source</ExternalLink>}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default async function ParkingPage() {
  const parkingZones = await getParkingZones();
  const prohibited = parkingZones.filter((z) => z.rule === "prohibited");

  return (
    <>
      <PageHeader
        eyebrow="Plan your visit"
        title="Parking & ATMs"
        intro="Kingston's parking universe is small but full of gotchas: a paid Port lot by the marina, a commuter lot one block up, a strictly enforced free 2-hour row, a couple of genuinely unrestricted streets, and two free park & rides. The map shows all of it — color-coded — and where the cash machines are."
      />

      <Section
        title="The map"
        subtitle="Every public street in the Kingston UGA, color-coded by parking rule, plus lots, park & rides, and ATMs. Tap anything for rules, directions, and a Street View look at the actual curb. Rates verified July 2, 2026."
      >
        <TownMap zones={parkingZones} atms={atms} height="500px" />
        <MapLegend />
        <p className="mt-2 text-xs text-ink-soft">
          Dark-navy dots are ATMs; the dashed navy line is the Kingston urban growth
          area (Census boundary). Green and cyan streets come from the county&apos;s 2015
          curb inventory; gray streets have no restriction we know of — either way, the
          sign on the pole is always the legal authority. Markers labeled
          &ldquo;unverified&rdquo; still need an on-the-ground check. Chamber admins can
          correct any shape or pin at /admin/map — local eyes beat any database.
        </p>
      </Section>

      <Section
        title="Where to park"
        subtitle="Grouped by rule. Prices change — every card links to its source."
      >
        <div className="space-y-8">
          {GROUPS.map((group) => {
            const zones = parkingZones.filter((z) => z.rule === group.rule);
            if (zones.length === 0) return null;
            return (
              <div key={group.rule}>
                <h3 className="text-xl font-semibold text-sound-deep">{group.title}</h3>
                <p className="mt-1 mb-3 text-sm text-ink-soft">{group.blurb}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {zones.map((zone) => (
                    <ZoneCard key={zone.id} zone={zone} />
                  ))}
                </div>
              </div>
            );
          })}

          <div>
            <h3 className="text-xl font-semibold text-sound-deep">Where not to park</h3>
            <p className="mt-1 mb-3 text-sm text-ink-soft">
              No-parking streets (per the 2015 county study) plus the Port&apos;s boat-launch
              apron — obey posted signs.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {prohibited.map((zone) => (
                <ZoneCard key={zone.id} zone={zone} />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6">
          <Callout title="The line of cars on SR 104 is the ferry queue — not parking" tone="coral">
            <p>
              People mix these up all the time. If you&apos;re driving onto the boat, you don&apos;t
              park anywhere — you join the holding line on SR 104. During peak periods (daily 8
              am–8 pm in season), watch for the flashing-light advisory sign at Barber Cutoff Rd,
              follow the lane, and take a boarding pass at the dispenser near Lindvog Rd before
              waiting for green lights up to the tollbooths. Leave the line and your pass is void.
              (See the boarding-pass details in{" "}
              <a href="#atms" className="underline decoration-coral/60 underline-offset-2">
                ATMs &amp; cash
              </a>{" "}
              below, including the current machine-down note.) If you&apos;re just picking someone
              up or dropping off, skip the line entirely: stay in the right lane and turn right at
              Washington St before the tollbooths. And if you&apos;re leaving a car behind to walk
              on, use the Port or Diamond lots — not the free 2-hour zone, which the Port
              explicitly asks ferry travelers to avoid.
            </p>
          </Callout>
        </div>
      </Section>

      <Section
        title="Overnight parking, honestly"
        subtitle="The short version: one lot clearly allows it, one probably does, and everything else is a day-use situation."
      >
        <div className="max-w-2xl space-y-3 text-ink-soft">
          <p>
            <span className="font-semibold text-ink">Diamond lot D515 — yes.</span> The only
            option that plainly allows overnight and multi-day parking: $12 covers 12–24 hours,
            with published rates out to 7 days ($38). One block from the tollbooths.
          </p>
          <p>
            <span className="font-semibold text-ink">Port numbered spaces — call first.</span>{" "}
            The Port charges by the 12-hour block and never explicitly forbids cars overnight,
            but it never explicitly allows it either. Before leaving a car overnight, call the
            Port office: 360-297-3545. And to be clear:{" "}
            <span className="font-medium text-ink">no RV parking on Port property</span>, and no
            camping.
          </p>
          <p>
            <span className="font-semibold text-ink">Park & rides — 24 hours max.</span>{" "}
            George&apos;s Corner and Bayside are free but intended for day use; Kitsap Transit
            caps them at 24 hours. One night squeaks by; a weekend does not.
          </p>
          <p>
            <span className="font-semibold text-ink">Streets — legal where unsigned, with a
            catch.</span> Kingston is unincorporated, and Kitsap County has no blanket overnight
            ban — restrictions exist only where posted. But under state law (RCW 46.55.085) a
            vehicle left in the right-of-way can be tagged as apparently abandoned and impounded
            24 hours after tagging. So an overnight on Georgia or Pennsylvania Ave is fine;
            multi-day storage is not. The posted hours of the downtown 2-hour limits aren&apos;t
            documented anywhere online, so don&apos;t assume a 2-hour street frees up at night —
            read the sign.
          </p>
        </div>
      </Section>

      <Section title="ATMs & cash" id="atms">
        <div className="max-w-2xl space-y-3 text-ink-soft">
          <p>
            Do you even need cash? Less than you might think. {FERRY_PAYMENT.freeLegNote}{" "}
            You can pay the car ferry by card or ORCA — or by cash at the staffed tollbooth,
            which is the one way to dodge the 3% card surcharge. The Kitsap Transit fast ferry
            farebox takes exact cash too (the crew carries no change), and cash stays handy in
            town for tips, the Sunday market, and small shops.
          </p>
          <p>
            There is <span className="font-medium text-ink">no ATM at the ferry terminal</span>{" "}
            and no bank branch in walkable downtown Kingston. The one confirmed 24-hour bank ATM
            is a 10–12 minute walk up the hill; the full-service branches are a short drive west
            at George&apos;s Corner. In a pinch, Grocery Outlet (Kingston Center) and Safeway
            (George&apos;s Corner) give debit cash-back at the register — fee-free.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Card className="flex flex-col gap-3">
            <h3 className="text-lg font-semibold text-sound-deep">Paying for the ferry</h3>
            <ul className="space-y-2 text-sm text-ink-soft">
              {FERRY_PAYMENT.methods.map((m) => (
                <li key={m} className="flex gap-2">
                  <span aria-hidden className="text-tide">
                    •
                  </span>
                  <span>{m}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-ink">
              <span className="font-semibold">Kiosks:</span> {FERRY_PAYMENT.kioskNote}
            </p>
            <p className="text-sm text-ink">
              <span className="font-semibold">The 3% card surcharge:</span>{" "}
              {FERRY_PAYMENT.surchargeNote}
            </p>
            <p className="text-sm text-ink-soft">{FERRY_PAYMENT.cashNote}</p>
            <p className="text-sm font-medium text-ink">{FERRY_PAYMENT.freeLegNote}</p>
            <div className="mt-auto pt-1 text-sm">
              <ExternalLink href={SOURCES[0].url}>WSF ticket information</ExternalLink>
            </div>
          </Card>

          <Card className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-lg font-semibold text-sound-deep">
                Boarding pass (drivers only)
              </h3>
              <Badge tone="navy">8 am–8 pm, in season</Badge>
            </div>
            <p className="text-sm text-ink-soft">{BOARDING_PASS.summary}</p>
            <p className="text-sm text-ink">
              <span className="font-semibold">When it&apos;s in effect:</span>{" "}
              {BOARDING_PASS.whenRequired}
            </p>
            <p className="text-sm text-ink">
              <span className="font-semibold">Where to grab it:</span> {BOARDING_PASS.where}
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
              {BOARDING_PASS.how.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="text-sm text-coral-deep">
              <span className="font-semibold">What voids it:</span> {BOARDING_PASS.voids}
            </p>
            <p className="text-sm text-ink">
              <span className="font-semibold">Walk-ons are exempt:</span> {BOARDING_PASS.exempt}
            </p>
            <Callout title="Right now: the machine is down" tone="coral">
              <p>{BOARDING_PASS.currentNote}</p>
            </Callout>
            <div className="mt-auto pt-1 text-sm">
              <ExternalLink href={SOURCES[1].url}>WSDOT: how the system works</ExternalLink>
            </div>
          </Card>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {atms.map((atm) => {
            const meta = atmMeta[atm.id];
            const walkable = atm.walkMinutesFromFerry <= 25;
            const route = walkable ? meta?.walkRoute : meta?.driveRoute;
            return (
              <Card key={atm.id} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-lg font-semibold text-sound-deep">{atm.name}</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {meta?.open24h && <Badge tone="green">Open 24 hours</Badge>}
                    {walkable ? (
                      <Badge tone="teal">{atm.walkMinutesFromFerry} min walk from the dock</Badge>
                    ) : (
                      <Badge tone="sand">
                        ~{meta?.driveMinutes ?? 10} min drive from the dock
                      </Badge>
                    )}
                    {meta?.access && <Badge tone="navy">{meta.access}</Badge>}
                    {meta?.confidence === "unverified" && (
                      <Badge tone="coral">Unverified — field-check</Badge>
                    )}
                  </div>
                </div>

                <p className="text-sm text-ink-soft">{atm.address}</p>

                <p className="text-sm text-ink">
                  <span className="font-semibold">Fees:</span> {atm.feeNote}
                </p>

                {atm.notes && <p className="text-sm text-ink-soft">{atm.notes}</p>}

                {route && (
                  <p className="text-sm text-ink-soft">
                    <span className="font-semibold text-ink">
                      {walkable ? "Walking there:" : "Getting there:"}
                    </span>{" "}
                    {route}
                  </p>
                )}

                <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm">
                  <ExternalLink href={mapSearchUrl(`${atm.name}, ${atm.address}`)}>
                    Open in Maps
                  </ExternalLink>
                  {atm.walkMinutesFromFerry <= 25 ? (
                    <ExternalLink href={mapDirectionsUrl(atm.address, "walking")}>
                      Walking directions
                    </ExternalLink>
                  ) : (
                    <ExternalLink href={mapDirectionsUrl(atm.address, "driving")}>
                      Driving directions
                    </ExternalLink>
                  )}
                  {meta?.sourceUrl && (
                    <ExternalLink href={meta.sourceUrl}>Source</ExternalLink>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </Section>
    </>
  );
}
