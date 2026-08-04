import type { Metadata } from "next";
import type { Restaurant } from "@/lib/types";
import { getRestaurants } from "@/lib/stores/business-store";
import { getCopyOverrides, copyText } from "@/lib/stores/site-store";
import { assertPageVisibleStatic } from "@/lib/page-visibility";
import {
  PageHeader,
  Section,
  Card,
  Badge,
  Callout,
  ExternalLink,
  mapSearchUrl,
} from "@/components/ui";
import { OpenBadge, OrderTimingNote } from "@/components/open-badge";
import { NearMe } from "@/components/near-me";
import { AccessFactsBlock } from "@/components/access-facts";
import { readAccessFacts } from "@/lib/schemas/access";
import { ReportInaccurate } from "@/components/report-inaccurate";
import { ClaimListing } from "@/components/claim-listing";
import { LocalBusinessJsonLd } from "@/components/json-ld";
import { FeatureMap } from "@/components/feature-map";
import { GetListedCallout } from "@/components/get-listed";
import { ListingPhoto } from "@/components/listing-photo";
import { getMediaItems } from "@/lib/stores/media-store";
import type { MediaItem } from "@/lib/media/refs";

export const metadata: Metadata = {
  title: "Eat & Drink",
  description:
    "Every restaurant, cafe, and bar in downtown Kingston, WA — all walkable from the Edmonds–Kingston ferry, with menus and online ordering links.",
};

const CHAMBER_EMAIL = "info@kingstonchamber.com";

// Grouped by REAL walk time from the ferry (computed from verified
// coordinates), so the section headings can never contradict the per-card
// walk badges. `maxWalk` is the upper bound of each band, in minutes.
const bands: { title: string; subtitle: string; maxWalk: number }[] = [
  {
    title: "Right off the boat",
    subtitle: "Two or three minutes from the walk-off ramp — doable between sailings.",
    maxWalk: 3,
  },
  {
    title: "A quick stroll",
    subtitle: "A few blocks up Highway 104 or one street over.",
    maxWalk: 6,
  },
  {
    title: "Up the hill",
    subtitle:
      "Seven to twelve minutes up Highway 104 — toward Kola Kole Park and the Firehouse Theater. Worth the walk.",
    maxWalk: Infinity,
  },
];

function telHref(phone: string): string {
  return `tel:+1${phone.replace(/\D/g, "")}`;
}

const buttonBase =
  "inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-semibold";

function RestaurantCard({ r, photos }: { r: Restaurant; photos: Record<string, MediaItem> }) {
  const mapUrl = mapSearchUrl(`${r.name} Kingston WA`);
  const accessFacts = readAccessFacts(r);
  const menuHref = r.menuUrl ?? r.website;
  // Don't render a separate Menu button when it would just repeat the
  // ordering link's destination.
  const showMenu = menuHref !== undefined && menuHref !== r.orderingUrl;

  return (
    <Card className="flex flex-col">
      <LocalBusinessJsonLd restaurant={r} />
      <ListingPhoto images={r.images} library={photos} />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-lg font-semibold text-sound-deep">{r.name}</h3>
        <p className="text-sm text-ink-soft">{r.cuisine}</p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge tone="teal">{r.walkMinutesFromFerry} min walk from ferry</Badge>
        <OpenBadge weeklyHours={r.weeklyHours} />
      </div>

      <p className="mt-3 text-sm leading-relaxed text-ink-soft">{r.description}</p>

      <p className="mt-2 text-sm text-ink-soft">
        {r.hours ? (
          <>
            <span className="font-semibold text-ink">Hours:</span> {r.hours}
          </>
        ) : (
          <ExternalLink href={r.website ?? mapUrl}>Check hours</ExternalLink>
        )}
      </p>

      <div className="mt-4 flex flex-wrap gap-2 pt-1">
        {r.orderingUrl && (
          <a
            href={r.orderingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonBase} bg-coral text-white hover:bg-coral-deep`}
          >
            Order online
          </a>
        )}
        {r.orderingPlatform === "phone-only" && r.phone && (
          <a
            href={telHref(r.phone)}
            className={`${buttonBase} bg-coral text-white hover:bg-coral-deep`}
          >
            Call to order
          </a>
        )}
        {showMenu && menuHref && (
          <a
            href={menuHref}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonBase} border border-tide text-tide-deep hover:bg-tide/10`}
          >
            {r.menuUrl ? "Menu" : "Website"}
          </a>
        )}
        <a
          href={mapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${buttonBase} border border-sand text-ink hover:bg-sand`}
        >
          Map
        </a>
        {(r.orderingUrl || r.orderingPlatform === "phone-only") && (
          <OrderTimingNote weeklyHours={r.weeklyHours} />
        )}
      </div>
      {/* E27 (M-14-05): Chamber-verified access facts, when any exist. The card
          already carries one report link below, which covers these too. */}
      {accessFacts && (
        <AccessFactsBlock
          facts={accessFacts}
          store="restaurants"
          id={r.id}
          subject={r.name}
          showReport={false}
        />
      )}
      <ReportInaccurate store="restaurants" id={r.id} subject={r.name} />
      {/* E17 (M-10-03): the claim intake — a request grants nothing. */}
      <ClaimListing store="restaurants" id={r.id} subject={r.name} />
    </Card>
  );
}

export const revalidate = 60;

export default async function EatPage() {
  // ISR page: the cookie-free gate is the one that actually bakes the 404
  // when hidden (see assertPageVisibleStatic + the /give find, 2026-08-03).
  await assertPageVisibleStatic("/eat");
  const [allRestaurants, copy, mediaItems] = await Promise.all([
    getRestaurants(),
    getCopyOverrides(),
    getMediaItems(),
  ]);
  // Card photos resolve their alt text from the library, so the cards need it.
  // A build/revalidate-time read on a prerendered page, not a per-request one.
  const photos = Object.fromEntries(mediaItems.map((m) => [m.id, m]));
  // Admins can hide a vendor from the public page via the listings workbench.
  const restaurants = allRestaurants.filter((r) => !r.hidden);
  const sorted = [...restaurants].sort(
    (a, b) => a.walkMinutesFromFerry - b.walkMinutesFromFerry || a.name.localeCompare(b.name),
  );
  const grouped = bands
    .map((band, i) => {
      const min = i === 0 ? 0 : bands[i - 1].maxWalk + 1;
      return {
        ...band,
        items: sorted.filter(
          (r) => r.walkMinutesFromFerry >= min && r.walkMinutesFromFerry <= band.maxWalk,
        ),
      };
    })
    .filter((g) => g.items.length > 0);

  return (
    <>
      <PageHeader
        eyebrow={copyText(copy, "eat.header.eyebrow")}
        title={copyText(copy, "eat.header.title")}
        intro={copyText(copy, "eat.header.intro")}
      />

      <Section>
        <NearMe
          places={restaurants.map((r) => ({
            id: r.id,
            name: r.name,
            lat: r.lat,
            lng: r.lng,
            weeklyHours: r.weeklyHours,
            walkMinutesFromFerry: r.walkMinutesFromFerry,
          }))}
        />
      </Section>

      <Section title="The food map">
        <p className="mb-4 text-ink">
          Every kitchen and bar in town, pinned — tap a marker for the walk time
          from the ferry.
        </p>
        <FeatureMap view="food-drink" height="420px" />
      </Section>

      {grouped.map((g) => (
        <Section key={g.title} title={g.title} subtitle={g.subtitle}>
          <div className="grid gap-4 sm:grid-cols-2">
            {g.items.map((r) => (
              <RestaurantCard key={r.id} r={r} photos={photos} />
            ))}
          </div>
        </Section>
      ))}

      <Section>
        <div className="space-y-4">
          <Callout
            title={copyText(copy, "eat.callout.title")}
          >
            <p>
              {copyText(copy, "eat.callout.body")}{" "}
              <a
                href={`mailto:${CHAMBER_EMAIL}?subject=Update%20my%20Visit%20Kingston%20listing`}
                className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
              >
                Update your listing through the Kingston Chamber
              </a>
              .
            </p>
          </Callout>
          <GetListedCallout copy={copy} />
        </div>
      </Section>
    </>
  );
}
