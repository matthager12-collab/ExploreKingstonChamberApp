import type { Metadata } from "next";
import Link from "next/link";
import type { Itinerary } from "@/lib/types";
import { getItineraries } from "@/lib/stores/itinerary-store";
import { getCopyOverrides, copyText } from "@/lib/stores/site-store";
import { assertPageVisibleStatic } from "@/lib/page-visibility";
import { Badge, Card, PageHeader, Section } from "@/components/ui";
import { groupItineraries } from "./grouping";

// Itineraries are admin-editable (seed + overlay via the itinerary store);
// revalidate keeps admin edits fresh here.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Itineraries",
  description:
    "Ready-made Kingston days: walk-on wanders, family beach days, gardens, Suquamish, Port Gamble, the wild north end — plus weekend and three-day plans.",
};

const modeLabels: Record<string, { label: string; tone: "green" | "navy" | "teal" }> = {
  "walk-on": { label: "No car needed", tone: "green" },
  car: { label: "Bring the car", tone: "navy" },
  either: { label: "Car optional", tone: "teal" },
};

export default async function ItinerariesPage() {
  // ISR page: the cookie-free gate is the one that actually bakes the 404
  // when hidden (see assertPageVisibleStatic + the /give find, 2026-08-03).
  await assertPageVisibleStatic("/itineraries");
  const [itineraries, copy] = await Promise.all([getItineraries(), getCopyOverrides()]);
  const { groups, leftovers } = groupItineraries(itineraries);

  return (
    <>
      <PageHeader
        eyebrow={copyText(copy, "itineraries.header.eyebrow")}
        title={copyText(copy, "itineraries.header.title")}
        intro={copyText(copy, "itineraries.header.intro")}
      />
      {groups.map((group) => {
        // Leftovers ride along with the last section rather than getting a
        // heading of their own — see groupItineraries: they must appear
        // somewhere, but they do not deserve to be announced.
        const items =
          group.key === "multi-day" ? [...group.items, ...leftovers] : group.items;
        if (items.length === 0) return null;
        return (
          <Section key={group.key} title={group.title} subtitle={group.subtitle}>
            <ItineraryGrid itineraries={items} />
          </Section>
        );
      })}
    </>
  );
}

function ItineraryGrid({ itineraries }: { itineraries: Itinerary[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {itineraries.map((it) => {
        const mode = modeLabels[it.mode];
        return (
          <Link key={it.slug} href={`/itineraries/${it.slug}`} className="group block h-full">
            <Card className="flex h-full flex-col transition-shadow group-hover:shadow-[0_4px_12px_rgba(22,64,94,0.15)]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="coral">{it.duration}</Badge>
                {mode && <Badge tone={mode.tone}>{mode.label}</Badge>}
              </div>
              {/* h3, not h2: each grid now sits inside a titled <Section>, which
                  renders the h2 above it. The cards were h2 while the page had
                  no section headings at all (axe: heading-order); now that they
                  do, h3 is what keeps the outline intact. Visual size is
                  carried by the classes, not the tag. */}
              <h3 className="mt-3 text-xl font-semibold text-sound-deep group-hover:text-tide-deep">
                {it.title}
              </h3>
              <p className="mt-2 flex-1 text-sm text-ink-soft">{it.tagline}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {it.audience.map((tag) => (
                  <Badge key={tag} tone="sand">
                    {tag}
                  </Badge>
                ))}
              </div>
              <p className="mt-4 text-sm font-semibold text-tide-deep">
                {it.stops.length} stops → See the plan
              </p>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
