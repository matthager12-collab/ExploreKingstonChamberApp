import type { Metadata } from "next";
import {
  PageHeader,
  Section,
  Card,
  Callout,
} from "@/components/ui";
import { FeatureMap } from "@/components/feature-map";
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
        <p className="mt-2 text-xs text-ink-soft">
          Colors follow the parking type shown in the legend. The sign on the pole is
          always the legal authority — where a lot and a posted sign disagree, believe the
          sign. Chamber admins keep this map current in the portal at /admin/maps.
        </p>
      </Section>

      <Section title="Before you park for the ferry">
        <Callout title="The line of cars on SR 104 is the ferry queue — not parking" tone="coral">
          <p>
            People mix these up all the time. If you&apos;re driving onto the boat, you don&apos;t
            park anywhere — you join the holding line on SR 104. During peak periods (daily 8
            am–8 pm in season), watch for the flashing-light advisory sign at Barber Cutoff Rd,
            follow the lane, and take a boarding pass at the dispenser near Lindvog Rd before
            waiting for green lights up to the tollbooths. Leave the line and your pass is void.
            If you&apos;re just picking someone
            up or dropping off, skip the line entirely: stay in the right lane and turn right at
            Washington St before the tollbooths. And if you&apos;re leaving a car behind to walk
            on, use the Port or Diamond lots — not the free 2-hour zone, which the Port
            explicitly asks ferry travelers to avoid.
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

    </>
  );
}
