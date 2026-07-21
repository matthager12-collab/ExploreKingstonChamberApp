import type { Metadata } from "next";
import { Callout, Card, ExternalLink, PageHeader, Section } from "@/components/ui";
import { getWebcams } from "@/lib/stores/listing-stores";
import { getCopyOverrides, copyText } from "@/lib/stores/site-store";
import { assertPageVisible, HiddenPageBanner } from "@/lib/page-visibility";
import { WebcamGrid } from "./webcam-grid";

// Webcams are admin-editable (seed + overlay via the listing store);
// revalidate keeps admin edits fresh here.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Webcams",
  description:
    "Live WSDOT camera views of the Kingston and Edmonds ferry lines, plus nearby local cams.",
};

export default async function WebcamsPage() {
  const hiddenPreview = await assertPageVisible("/webcams");
  const [cams, copy] = await Promise.all([getWebcams(), getCopyOverrides()]);
  // Same split the seed file used: edmonds-* ids on the Edmonds side,
  // everything else (including any admin-added local cams) on the Kingston side.
  const kingstonCams = cams.filter((w) => !w.id.startsWith("edmonds-"));
  const edmondsCams = cams.filter((w) => w.id.startsWith("edmonds-"));
  return (
    <>
      {hiddenPreview && <HiddenPageBanner />}
      <PageHeader
        eyebrow={copyText(copy, "webcams.header.eyebrow")}
        title={copyText(copy, "webcams.header.title")}
        intro={copyText(copy, "webcams.header.intro")}
      />

      <Section>
        <Callout title="How locals read these" tone="teal">
          Start with the SR 104 cams on the Kingston side. If cars are stacked
          up at Lindvog Road — or worse, back at Barber Cutoff — the holding
          lanes are full and you should expect a real wait. Walk-ons board
          nearly every sailing, so when the line looks grim, consider parking
          in town and walking on instead. Also good to know: since June 1,
          2026, WSDOT runs a traffic management system on SR 104, with crews
          handing out boarding passes 8 a.m.–8 p.m. — details on{" "}
          <ExternalLink href="https://wsdot.wa.gov/travel/washington-state-ferries">
            the WSF site
          </ExternalLink>
          .
        </Callout>
      </Section>

      <Section
        title="Kingston side"
        subtitle="In order along the approach — Lindvog Road is the first checkpoint, the terminal cam is the boat itself."
      >
        <WebcamGrid cams={kingstonCams} />
      </Section>

      <Section
        title="Edmonds side"
        subtitle="Heading to Kingston? The holding-lanes cam tells you most of what you need to know."
      >
        <WebcamGrid cams={edmondsCams} />
      </Section>

      <Section
        title="Around town"
        subtitle="A couple of nearby non-WSDOT cams worth a look. We link out rather than embed — they're privately run."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Card>
            <h3 className="text-lg font-semibold text-sound-deep">Skunk Bay Weather</h3>
            <p className="mt-1 text-sm text-ink-soft">
              A beloved private weather station in Hansville, about 7 miles
              north of Kingston, looking across Admiralty Inlet. Updates every
              minute, and it&rsquo;s locally famous for northern-lights
              timelapses.
            </p>
            <p className="mt-3 text-sm">
              <ExternalLink href="https://www.skunkbayweather.com/">
                skunkbayweather.com
              </ExternalLink>
            </p>
          </Card>
          <Card>
            <h3 className="text-lg font-semibold text-sound-deep">Port of Edmonds cams</h3>
            <p className="mt-1 text-sm text-ink-soft">
              Two views on the far side of the run: the marina entrance and the
              Edmonds Marsh. Handy for a look at conditions on the water before
              you sail.
            </p>
            <p className="mt-3 text-sm">
              <ExternalLink href="https://portofedmonds.gov/marina-camera/">
                portofedmonds.gov/marina-camera
              </ExternalLink>
            </p>
          </Card>
        </div>
        <p className="mt-5 text-sm text-ink">
          No camera points at downtown Kingston or the marina yet — the WSDOT
          terminal cams above are the closest thing.
        </p>
      </Section>

      <Section>
        <p className="text-sm text-ink">
          Camera images courtesy of{" "}
          <ExternalLink href="https://wsdot.wa.gov/travel/washington-state-ferries">
            WSDOT
          </ExternalLink>
          . Feeds are provided as-is under WSDOT&rsquo;s{" "}
          <ExternalLink href="https://wsdot.wa.gov/about/policies/travel-information-disclaimer">
            travel information disclaimer
          </ExternalLink>{" "}
          and occasionally go dark — for live sailing status, check the WSF
          site directly.
        </p>
      </Section>
    </>
  );
}
