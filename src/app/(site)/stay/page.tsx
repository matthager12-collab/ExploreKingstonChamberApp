import type { Metadata } from "next";
import type { Lodging } from "@/lib/types";
import { AccessFactsBlock } from "@/components/access-facts";
import { ClaimListing } from "@/components/claim-listing";
import { readAccessFacts } from "@/lib/schemas/access";
import { getLodging } from "@/lib/stores/listing-stores";
import { getCopyOverrides, copyText } from "@/lib/stores/site-store";
import { GetListedCallout } from "@/components/get-listed";
import { ListingPhoto } from "@/components/listing-photo";
import { getMediaItems } from "@/lib/stores/media-store";
import type { MediaItem } from "@/lib/media/refs";
import { assertPageVisible, HiddenPageBanner } from "@/lib/page-visibility";
import {
  PageHeader,
  Section,
  Card,
  Badge,
  Callout,
  ExternalLink,
  mapSearchUrl,
} from "@/components/ui";

// Lodging is admin-editable (seed + overlay via the listing store);
// revalidate keeps admin edits fresh here.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Stay",
  description:
    "Where to stay in and around Kingston, WA — hotels, vacation rentals, Hood Canal camping, and guest moorage for boaters.",
};

// Compliant deep links only: these open a live search on the other site.
// Airbnb has no affiliate program and prohibits scraping/mirroring listings,
// so we link out and nothing more. URL formats are undocumented and can
// change — re-check them in a browser every few months.
const AIRBNB_SEARCH = "https://www.airbnb.com/s/Kingston--WA--United-States/homes";
const VRBO_SEARCH = "https://www.vrbo.com/search?destination=Kingston%2C%20Washington";

const typeMeta: Record<
  Lodging["type"],
  { label: string; tone: "navy" | "teal" | "coral" | "green" | "sand" }
> = {
  hotel: { label: "Hotel", tone: "navy" },
  "vacation-rental": { label: "Vacation rentals", tone: "teal" },
  bnb: { label: "B&B", tone: "sand" },
  camping: { label: "Camping", tone: "green" },
  marina: { label: "Marina", tone: "coral" },
};

function LodgingCard({ place, photos }: { place: Lodging; photos: Record<string, MediaItem> }) {
  const meta = typeMeta[place.type];
  const accessFacts = readAccessFacts(place);
  return (
    <Card className="flex flex-col gap-3">
      <ListingPhoto images={place.images} library={photos} />
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold text-sound-deep">{place.name}</h3>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>
      <p className="text-sm text-ink-soft">{place.description}</p>
      {place.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {place.tags.map((tag) => (
            <Badge key={tag} tone="sand">
              {tag}
            </Badge>
          ))}
        </div>
      )}
      <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm">
        {place.website && <ExternalLink href={place.website}>Website</ExternalLink>}
        {place.bookingUrl && <ExternalLink href={place.bookingUrl}>Book</ExternalLink>}
        {place.address && (
          <ExternalLink href={mapSearchUrl(`${place.name}, ${place.address}`)}>
            Map
          </ExternalLink>
        )}
      </div>
      {/* E27 (M-14-05): unlike the /eat cards, /stay has no report link of its
          own, so the access block carries E08's intake itself. */}
      {accessFacts && (
        <AccessFactsBlock
          facts={accessFacts}
          store="lodging"
          id={place.id}
          subject={place.name}
        />
      )}
      {/* E17 (M-10-03): the claim intake — a request grants nothing. */}
      <ClaimListing store="lodging" id={place.id} subject={place.name} />
    </Card>
  );
}

export default async function StayPage() {
  const hiddenPreview = await assertPageVisible("/stay");
  const [lodging, copy, mediaItems] = await Promise.all([
    getLodging(),
    getCopyOverrides(),
    getMediaItems(),
  ]);
  // Card photos resolve their alt text from the library — see /eat.
  const photos = Object.fromEntries(mediaItems.map((m) => [m.id, m]));
  return (
    <>
      {hiddenPreview && <HiddenPageBanner />}
      <PageHeader
        eyebrow={copyText(copy, "stay.header.eyebrow")}
        title={copyText(copy, "stay.header.title")}
        intro={copyText(copy, "stay.header.intro")}
      />

      <Section
        title="Places to stay"
        subtitle="A short, hand-checked list — Kingston is a small town, and that's the point."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {lodging.map((place) => (
            <LodgingCard key={place.id} place={place} photos={photos} />
          ))}
        </div>
      </Section>

      <Section
        title="Search the big sites"
        subtitle="More rentals come and go than any list can keep up with."
      >
        <Card>
          <ul className="space-y-2">
            <li>
              <ExternalLink href={AIRBNB_SEARCH}>
                Search Airbnb for Kingston, WA rentals
              </ExternalLink>
            </li>
            <li>
              <ExternalLink href={VRBO_SEARCH}>
                Search Vrbo for Kingston, WA rentals
              </ExternalLink>
            </li>
          </ul>
          <p className="mt-3 text-xs text-ink-soft">
            These links simply open a search on an outside site. They aren&apos;t
            endorsements, we don&apos;t vet the listings, and Explore Kingston earns
            nothing if you book.
          </p>
        </Card>
      </Section>

      <Section>
        <div className="space-y-4">
          <Callout title="Arriving by boat?" tone="teal">
            Guest moorage at the Kingston Marina puts you steps from the ferry
            dock and downtown — no car required for the whole weekend. Slips
            fill up on summer weekends, so confirm availability and current
            rates with the{" "}
            <ExternalLink href="https://www.portofkingston.org">
              Port of Kingston
            </ExternalLink>{" "}
            before you head out.
          </Callout>

          {/* copy/get-listed-cta: was a hardcoded lodging-only email callout;
              now the shared Chamber-editable get-listed CTA (email + phone). */}
          <GetListedCallout copy={copy} />
        </div>
      </Section>
    </>
  );
}
