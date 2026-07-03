import type { Metadata } from "next";
import type { Restaurant } from "@/lib/types";
import { restaurants } from "@/lib/data/restaurants";
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

export const metadata: Metadata = {
  title: "Eat & Drink",
  description:
    "Every restaurant, cafe, and bar in downtown Kingston, WA — all walkable from the Edmonds–Kingston ferry, with menus and online ordering links.",
};

const CHAMBER_EMAIL = "info@kingstonchamber.com";

// Grouped by vibe; every restaurant id appears exactly once. Anything added
// to the data file later but not listed here falls into "More around town".
const groups: { title: string; subtitle: string; ids: string[] }[] = [
  {
    title: "Right off the boat",
    subtitle:
      "Sit-down meals within about four minutes of the terminal — doable even between sailings.",
    ids: [
      "sourdough-willys",
      "saucy-sailor",
      "kingston-ale-house",
      "dvine-lounge",
      "filling-station",
    ],
  },
  {
    title: "Worth the stroll",
    subtitle:
      "Five to ten minutes up the hill or over toward the Village Green.",
    ids: [
      "nirvana-indian-nepali",
      "grub-hut",
      "los-tres-compadres",
      "argensol-kitchen",
      "da-poke-shop",
      "westside-pizza",
    ],
  },
  {
    title: "Coffee & quick bites",
    subtitle: "Fast fuel before a sailing — all of these move quickly.",
    ids: ["jaime-les-crepes", "kingston-coffee-company", "cup-and-muffin", "borrowed-kitchen-bakery"],
  },
  {
    title: "Drinks",
    subtitle: "Local pours for the evening — one taproom, one jazz cellar.",
    ids: ["friends-and-neighbors-brewing", "cellar-cat"],
  },
];

function telHref(phone: string): string {
  return `tel:+1${phone.replace(/\D/g, "")}`;
}

const buttonBase =
  "inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-semibold";

function RestaurantCard({ r }: { r: Restaurant }) {
  const mapUrl = mapSearchUrl(`${r.name} Kingston WA`);
  const menuHref = r.menuUrl ?? r.website;
  // Don't render a separate Menu button when it would just repeat the
  // ordering link's destination.
  const showMenu = menuHref !== undefined && menuHref !== r.orderingUrl;

  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-lg font-semibold text-sound-deep">{r.name}</h3>
        <p className="text-sm text-ink-soft">
          {r.cuisine} · <span aria-label={`price level ${r.priceLevel} of 3`}>{"$".repeat(r.priceLevel)}</span>
        </p>
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
    </Card>
  );
}

export default function EatPage() {
  const grouped = groups
    .map((g) => ({
      ...g,
      items: g.ids
        .map((id) => restaurants.find((r) => r.id === id))
        .filter((r): r is Restaurant => r !== undefined),
    }))
    .filter((g) => g.items.length > 0);

  const listedIds = new Set(groups.flatMap((g) => g.ids));
  const leftovers = restaurants.filter((r) => !listedIds.has(r.id));

  return (
    <>
      <PageHeader
        eyebrow="Downtown Kingston"
        title="Eat & Drink"
        intro="Everything here is a walk from the ferry dock — two minutes to a crêpe, ten to the Village Green. Heads up: plenty of Kingston kitchens take orders by phone, not app. That's normal here."
      />

      {grouped.map((g) => (
        <Section key={g.title} title={g.title} subtitle={g.subtitle}>
          <div className="grid gap-4 sm:grid-cols-2">
            {g.items.map((r) => (
              <RestaurantCard key={r.id} r={r} />
            ))}
          </div>
        </Section>
      ))}

      {leftovers.length > 0 && (
        <Section title="More around town">
          <div className="grid gap-4 sm:grid-cols-2">
            {leftovers.map((r) => (
              <RestaurantCard key={r.id} r={r} />
            ))}
          </div>
        </Section>
      )}

      <Section>
        <Callout title="Menus and hours change — trust the kitchen, not the internet.">
          <p>
            We verify this list against the real world, but small-town kitchens
            move fast. When it matters, call ahead or check the restaurant&apos;s
            own site. Run a food spot in Kingston?{" "}
            <a
              href={`mailto:${CHAMBER_EMAIL}?subject=Update%20my%20Visit%20Kingston%20listing`}
              className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
            >
              Update your listing through the Kingston Chamber
            </a>
            .
          </p>
        </Callout>
      </Section>
    </>
  );
}
