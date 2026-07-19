import type { Metadata } from "next";
import Link from "next/link";
import { getAllHunts } from "@/lib/hunt-store";
import { getCopyOverrides, copyText } from "@/lib/stores/site-store";
import { assertPageVisible, HiddenPageBanner } from "@/lib/page-visibility";
import { Badge, Callout, Card, ExternalLink, PageHeader, Section, mapDirectionsUrl } from "@/components/ui";

// Hunts can be created/edited by the Chamber in the admin builder at any
// time, so render per-request instead of at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Scavenger Hunt",
  description:
    "Free, self-guided scavenger hunts around downtown Kingston, WA. Solve clues and post a photo at each spot to check it off — no app, no signup.",
};

const steps = [
  {
    title: "Solve the clue",
    body: "Pick a hunt below and walk to the first spot. Stops unlock one at a time, so there's no skipping ahead — the clue is the game.",
  },
  {
    title: "Snap & post",
    body: "At the spot, take the photo prompt. Your photo posts to the hunt organizers with your location, and if you're standing in the right place the stop checks itself off.",
  },
  {
    title: "Finish & show off",
    body: "Find every stop and you'll get a completion screen. Show it at a participating downtown business and tell them the Chamber sent you.",
  },
];

export default async function HuntPage() {
  const hiddenPreview = await assertPageVisible("/hunt");
  const [hunts, copy] = await Promise.all([getAllHunts(), getCopyOverrides()]);

  return (
    <>
      {hiddenPreview && <HiddenPageBanner />}
      <PageHeader
        eyebrow={copyText(copy, "hunt.header.eyebrow")}
        title={copyText(copy, "hunt.header.title")}
        intro={copyText(copy, "hunt.header.intro")}
      />

      <Section title="How it works">
        <div className="grid gap-4 sm:grid-cols-3">
          {steps.map((step, i) => (
            <Card key={step.title}>
              <p className="flex h-8 w-8 items-center justify-center rounded-full bg-sound text-sm font-bold text-white">
                {i + 1}
              </p>
              <h3 className="mt-3 text-lg font-semibold text-sound-deep">{step.title}</h3>
              <p className="mt-1 text-sm text-ink-soft">{step.body}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Pick your hunt" subtitle="Every hunt starts within a short walk of the ferry terminal.">
        <div className="grid gap-4 sm:grid-cols-2">
          {hunts.map((hunt) => (
            <Card key={hunt.id} className="flex flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={hunt.difficulty === "easy" ? "green" : "coral"}>
                  {hunt.difficulty === "easy" ? "Easy" : "Moderate"}
                </Badge>
                <Badge tone="teal">~{hunt.durationMinutes} min</Badge>
                <Badge tone="sand">{hunt.stops.length} stops</Badge>
              </div>
              <h3 className="mt-3 text-xl font-semibold text-sound-deep">{hunt.title}</h3>
              <p className="mt-2 flex-1 text-sm text-ink-soft">{hunt.description}</p>
              <Link
                href={`/hunt/${hunt.slug}`}
                className="mt-4 inline-flex w-fit items-center rounded-full bg-coral px-5 py-2 text-sm font-semibold text-white hover:bg-coral-deep"
              >
                Start this hunt →
              </Link>
            </Card>
          ))}
        </div>
      </Section>

      <Section>
        <Callout title="Good to know before you go">
          <ul className="list-disc space-y-1 pl-4">
            <li>
              Photos you post are sent to the hunt organizers, along with your location when your
              phone allows it, so they can verify finds. Don&apos;t include anything in the frame
              you wouldn&apos;t share.
            </li>
            <li>
              GPS and uploads need signal and permission. No bars, denied permission, or a stubborn
              phone? The hunt falls back to the honor system and you keep playing.
            </li>
            <li>
              Progress saves on your phone automatically, so you can pause for lunch and pick the
              hunt back up later — on the same phone and browser.
            </li>
            <li>
              Hunts begin near the ferry dock:{" "}
              <ExternalLink href={mapDirectionsUrl("Kingston Ferry Terminal, Kingston, WA", "walking")}>
                walking directions to the start
              </ExternalLink>
              .
            </li>
            <li>
              Wondering which businesses honor the finish screen? Check with the{" "}
              <ExternalLink href="https://explorekingstonwa.com">Kingston Chamber</ExternalLink> or
              just ask at any downtown shop.
            </li>
          </ul>
        </Callout>
      </Section>
    </>
  );
}
