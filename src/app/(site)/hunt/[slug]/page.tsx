import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getHunt, photoUrl } from "@/lib/hunt-store";
import { HuntPlayer, type PlayerHunt } from "@/components/hunt-player";
import { Badge, Callout, ExternalLink, PageHeader, Section, mapDirectionsUrl } from "@/components/ui";

// Admin-created hunts must appear immediately, so no static params — every
// request reads the store (seed hunts merged with .data/hunts custom hunts).
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const hunt = await getHunt(slug);
  if (!hunt) return { title: "Scavenger Hunt" };
  return {
    title: `${hunt.title} — Scavenger Hunt`,
    description: hunt.description,
  };
}

export default async function HuntDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const hunt = await getHunt(slug);
  if (!hunt) notFound();

  // Hand the client only what it needs: reference photos become URLs served
  // by /api/hunts/photo; the on-disk path stays server-side.
  const playerHunt: PlayerHunt = {
    id: hunt.id,
    slug: hunt.slug,
    title: hunt.title,
    description: hunt.description,
    difficulty: hunt.difficulty,
    durationMinutes: hunt.durationMinutes,
    stops: hunt.stops.map(({ referencePhoto, ...stop }) => ({
      ...stop,
      referencePhotoUrl: referencePhoto ? photoUrl(referencePhoto) : undefined,
    })),
  };

  return (
    <>
      <PageHeader eyebrow="Scavenger hunt" title={hunt.title} intro={hunt.description} />

      <Section>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={hunt.difficulty === "easy" ? "green" : "coral"}>
            {hunt.difficulty === "easy" ? "Easy" : "Moderate"}
          </Badge>
          <Badge tone="teal">~{hunt.durationMinutes} min</Badge>
          <Badge tone="sand">{hunt.stops.length} stops</Badge>
        </div>

        <div className="mt-4">
          <Callout title="Before you start">
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Stops unlock in order. At each one: read the clue, find the spot (some stops show a
                reference photo of what you&apos;re looking for), and post your photo. Taken within
                the check-in radius, it checks the stop off automatically.
              </li>
              <li>
                Posted photos are sent to the hunt organizers, along with your location when your
                phone allows it — don&apos;t include anything you wouldn&apos;t share. No signal or
                no camera? You can still finish every stop on the honor system.
              </li>
              <li>
                GPS pins are approximate on purpose, with a generous check-in radius. If your phone
                says you&apos;re close but the app disagrees, post the photo anyway and carry on —
                the honor system has you covered.
              </li>
              <li>
                The hunt starts near the ferry dock:{" "}
                <ExternalLink href={mapDirectionsUrl("Kingston Ferry Terminal, Kingston, WA", "walking")}>
                  walking directions
                </ExternalLink>
                .
              </li>
            </ul>
          </Callout>
        </div>
      </Section>

      <Section title="The hunt">
        <HuntPlayer hunt={playerHunt} />
        <p className="mt-6 text-sm text-ink-soft">
          Done here?{" "}
          <Link
            href="/hunt"
            className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
          >
            Back to all hunts
          </Link>
        </p>
      </Section>
    </>
  );
}
