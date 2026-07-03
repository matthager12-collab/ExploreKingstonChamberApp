import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getItinerary } from "@/lib/stores/itinerary-store";
import {
  Badge,
  Callout,
  ExternalLink,
  PageHeader,
  Section,
  mapSearchUrl,
} from "@/components/ui";

// Admin-created itineraries must appear immediately, so no static params —
// every request reads the store (seed merged with the admin overlay).
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const itinerary = await getItinerary(slug);
  if (!itinerary) return { title: "Itinerary not found" };
  return {
    title: itinerary.title,
    description: itinerary.tagline,
  };
}

const modeLabels: Record<string, { label: string; tone: "green" | "navy" | "teal" }> = {
  "walk-on": { label: "No car needed", tone: "green" },
  car: { label: "Bring the car", tone: "navy" },
  either: { label: "Car optional", tone: "teal" },
};

export default async function ItineraryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const itinerary = await getItinerary(slug);
  if (!itinerary) notFound();

  const mode = modeLabels[itinerary.mode];

  return (
    <>
      <PageHeader eyebrow="Itinerary" title={itinerary.title} intro={itinerary.tagline} />
      <Section>
        <div className="mb-8 flex flex-wrap items-center gap-2">
          <Badge tone="coral">{itinerary.duration}</Badge>
          <Badge tone={mode.tone}>{mode.label}</Badge>
          {itinerary.audience.map((tag) => (
            <Badge key={tag} tone="sand">
              {tag}
            </Badge>
          ))}
        </div>

        <ol className="relative border-l-2 border-seaglass pl-0">
          {itinerary.stops.map((stop, i) => (
            <li key={i} className="relative flex gap-4 pb-8 last:pb-0 sm:gap-6">
              <span
                aria-hidden
                className="absolute top-1.5 -left-[7px] h-3 w-3 rounded-full border-2 border-white bg-tide"
              />
              <div className="w-20 shrink-0 pt-0.5 pl-5 text-sm font-semibold whitespace-nowrap text-sound-deep sm:w-24">
                {stop.time}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-semibold text-sound-deep">{stop.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                  {stop.description}
                </p>
                {stop.mapQuery && (
                  <ExternalLink href={mapSearchUrl(stop.mapQuery)} className="mt-2 inline-block text-sm">
                    Map ↗
                  </ExternalLink>
                )}
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-10">
          <Callout tone="coral" title="Before you head back">
            Sailings shift and summer lines grow. Check live wait times and today&rsquo;s
            schedule on the{" "}
            <Link
              href="/ferry"
              className="font-semibold text-coral-deep underline underline-offset-2 hover:text-sound"
            >
              Ferry page
            </Link>{" "}
            before you commit to your boat home.
          </Callout>
        </div>

        <p className="mt-6 text-sm text-ink-soft">
          Want a different kind of day?{" "}
          <Link
            href="/itineraries"
            className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
          >
            Browse all itineraries
          </Link>
          .
        </p>
      </Section>
    </>
  );
}
