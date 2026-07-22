import type { Metadata } from "next";
import Link from "next/link";
import {
  PageHeader,
  Section,
  Card,
  Callout,
} from "@/components/ui";
import { FeatureMap } from "@/components/feature-map";
import { freeOrPaidFromRule, parkingRuleLabel } from "@/lib/map/parking-labels";
import { CostBadge } from "@/components/cost-badge";
import { resolveMapView } from "@/lib/map/resolve";
import { getCopyOverrides, copyText } from "@/lib/stores/site-store";
import { getFerryInfo } from "@/lib/stores/ferry-info-store";
import { assertPageVisible, HiddenPageBanner } from "@/lib/page-visibility";

// The parking map is the Chamber's live "parking-cash" map-CMS view, built and
// edited in the portal. resolveMapView() renders the draft directly (it does
// not gate on `published`); revalidate keeps portal edits fresh here.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Parking",
  description:
    "Interactive map of every place to park in Kingston, WA — the Port lots, the free 2-hour zone, street parking, and overnight options near the ferry dock.",
};

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default async function ParkingPage() {
  const hiddenPreview = await assertPageVisible("/parking");
  const parkingMap = await resolveMapView("parking-cash");
  const copy = await getCopyOverrides();
  const ferryInfo = await getFerryInfo();

  return (
    <>
      {hiddenPreview && <HiddenPageBanner />}
      <PageHeader
        eyebrow={copyText(copy, "parking.header.eyebrow")}
        title={copyText(copy, "parking.header.title")}
        intro={copyText(copy, "parking.header.intro")}
      />

      <Section
        title="The map"
        subtitle={copyText(copy, "parking.map.subtitle")}
      >
        {parkingMap ? (
          <FeatureMap resolved={parkingMap} height="500px" />
        ) : (
          <Card>
            <p className="text-sm text-ink-soft">Parking map coming soon.</p>
          </Card>
        )}
        <p className="mt-2 text-xs text-ink">
          Colors follow the parking type shown in the legend. The sign on the pole is
          always the legal authority — where a lot and a posted sign disagree, believe the
          sign. Chamber admins keep this map current in the portal at /admin/maps.
        </p>
        {/* E27: you just parked — the next question is almost always this one. */}
        <p className="mt-3">
          <Link
            href="/map/restrooms"
            className="inline-flex min-h-[44px] items-center text-sm font-semibold text-tide-deep underline"
          >
            Need a restroom? Find the nearest one →
          </Link>
        </p>
        {/* E14 (M-14-04): on the map canvas a lot's type is carried by its
            marker colour alone, and the type name only appears inside a popup
            you have to tap. feature-map.tsx is frozen, so the text alternative
            lives here — same data, no colour required, and it prints. */}
        {parkingMap?.builtins.parkingZones && parkingMap.builtins.parkingZones.length > 0 && (
          <div className="mt-4">
            <h3 className="text-lg font-semibold text-sound-deep">Every lot, in words</h3>
            <p className="mt-1 text-sm text-ink">
              The same lots as the map above, with the parking type spelled out.
            </p>
            <ul className="mt-3 divide-y divide-sand rounded-2xl border border-sand bg-white">
              {parkingMap.builtins.parkingZones.map((z) => (
                <li key={z.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-semibold text-ink">{z.name}</p>
                    {/* E27: the shared free-vs-paid badge, in text. Absent for
                        permit / load-zone / no-parking rows, where a money
                        answer would be wrong — see freeOrPaidFromRule. */}
                    {(() => {
                      const cost = freeOrPaidFromRule(z.rule);
                      return cost ? <CostBadge cost={cost} /> : null;
                    })()}
                  </div>
                  {/* parkingRuleLabel(), not z.rule: the raw value is an
                      internal slug ("free-2hr"), and printing it does not
                      convey the type the marker colour was encoding. */}
                  <p className="text-sm text-ink">
                    {parkingRuleLabel(z.rule)}
                    {z.summary ? ` — ${z.summary}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Before you park for the ferry">
        <Callout title="The line of cars on SR 104 is the ferry queue — not parking" tone="coral">
          {/* E14 plain-language pass (NFR-04): this was one 130-word block whose
              core instruction chained four actions in a single 44-word sentence.
              Same facts, one idea per sentence, three decisions split apart. */}
          <p>
            People mix these two things up all the time. If you are driving onto the boat, do
            not park. You join the line of cars on SR 104 instead.
          </p>
          <p className="mt-2">
            In the busy season, from 8 am to 8 pm, watch for the flashing sign at Barber Cutoff
            Rd. Follow that lane. Take a boarding pass from the machine near Lindvog Rd. Then
            wait for a green light before you drive up to the toll booths. Stay in the line — if
            you leave it, your pass stops working.
          </p>
          <p className="mt-2">
            Only dropping someone off or picking them up? Do not join the line. Stay in the right
            lane and turn right at Washington St, before the toll booths.
          </p>
          <p className="mt-2">
            Leaving your car and walking onto the boat? Use a Port lot or a Diamond lot. Do not
            use the free 2-hour spaces — the Port asks ferry riders to stay out of those.
          </p>
          {ferryInfo.boardingPass.currentNote.trim() && (
            <p className="mt-3 font-medium text-ink">
              {ferryInfo.boardingPass.currentNote}
            </p>
          )}
        </Callout>
      </Section>

      <Section
        title="Overnight parking, honestly"
        subtitle="The short version: one lot clearly allows it, one probably does, and everything else is a day-use situation."
      >
        <div className="max-w-2xl space-y-3 text-ink">
          <p>
            <span className="font-semibold text-ink">Diamond lot D515 — yes.</span> The only
            option that plainly allows overnight and multi-day parking: $12 covers 12–24 hours,
            with published rates out to 7 days ($38). One block from the tollbooths.
          </p>
          <p>
            <span className="font-semibold text-ink">Port numbered spaces — call first.</span>{" "}
            {/* E14 plain-language pass: the rule was a double negative
                ("never explicitly forbids … but never explicitly allows"), which
                made the reader resolve two negations to reach "nobody knows". */}
            The Port charges in 12-hour blocks. Its rules do not say you can leave a car
            overnight, and they do not say you cannot. Nobody knows for sure. So call the Port
            office first, at 360-297-3545, before you leave a car there overnight. Two things are
            certain:{" "}
            <span className="font-medium text-ink">no RV parking on Port property</span>, and no
            camping.
          </p>
          <p>
            <span className="font-semibold text-ink">Park & rides — 24 hours max.</span>{" "}
            George&apos;s Corner and Bayside are free but intended for day use; Kitsap Transit
            caps them at 24 hours. One night squeaks by; a weekend does not.
          </p>
          <p>
            <span className="font-semibold text-ink">Streets — legal where there is no sign,
            with a catch.</span>{" "}
            {/* E14 plain-language pass: the sentence whose consequence is a tow
                was passive ("can be tagged … and impounded") and carried three
                unexplained legal terms plus a bare statute number. */}
            Kingston is not its own city, and Kitsap County has no county-wide overnight parking
            ban. A street only has rules if a sign says so. But state law lets the county act on a
            car left on a public street for a long time: it can put a tag on the car, call it
            abandoned, and tow it 24 hours later. (The law is Washington state code RCW 46.55.085.)
            So one night on Georgia Ave or Pennsylvania Ave is fine. Leaving a car for several days
            is not. The downtown 2-hour signs do not list their hours anywhere online, so do not
            assume a 2-hour space is free at night. Read the sign.
          </p>
        </div>
      </Section>

    </>
  );
}
