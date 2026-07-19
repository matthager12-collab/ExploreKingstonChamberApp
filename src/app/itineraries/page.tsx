import type { Metadata } from "next";
import Link from "next/link";
import { getItineraries } from "@/lib/stores/itinerary-store";
import { getCopyOverrides, copyText } from "@/lib/stores/site-store";
import { assertPageVisible, HiddenPageBanner } from "@/lib/page-visibility";
import { Badge, Card, PageHeader, Section } from "@/components/ui";

// Itineraries are admin-editable (seed + overlay via the itinerary store);
// revalidate keeps admin edits fresh here.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Itineraries",
  description:
    "Ready-made Kingston days: walk-on wanders, family beach days, rainy-day plans, and the road to Olympic National Park.",
};

const modeLabels: Record<string, { label: string; tone: "green" | "navy" | "teal" }> = {
  "walk-on": { label: "No car needed", tone: "green" },
  car: { label: "Bring the car", tone: "navy" },
  either: { label: "Car optional", tone: "teal" },
};

export default async function ItinerariesPage() {
  const hiddenPreview = await assertPageVisible("/itineraries");
  const [itineraries, copy] = await Promise.all([getItineraries(), getCopyOverrides()]);
  return (
    <>
      {hiddenPreview && <HiddenPageBanner />}
      <PageHeader
        eyebrow={copyText(copy, "itineraries.header.eyebrow")}
        title={copyText(copy, "itineraries.header.title")}
        intro={copyText(copy, "itineraries.header.intro")}
      />
      <Section>
        <div className="grid gap-4 sm:grid-cols-2">
          {itineraries.map((it) => {
            const mode = modeLabels[it.mode];
            return (
              <Link
                key={it.slug}
                href={`/itineraries/${it.slug}`}
                className="group block h-full"
              >
                <Card className="flex h-full flex-col transition-shadow group-hover:shadow-[0_4px_12px_rgba(22,64,94,0.15)]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="coral">{it.duration}</Badge>
                    <Badge tone={mode.tone}>{mode.label}</Badge>
                  </div>
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
      </Section>
    </>
  );
}
