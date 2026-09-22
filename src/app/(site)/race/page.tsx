import type { Metadata } from "next";
import Link from "next/link";
import {
  Callout,
  Card,
  ExternalLink,
  PageHeader,
  Section,
  mapDirectionsUrl,
} from "@/components/ui";
import { race } from "@/lib/data/race";
import { assertPageVisible, HiddenPageBanner } from "@/lib/page-visibility";
import { safeExternalHref } from "@/lib/safe-href";

import { RaceRegistration } from "./registration";

export const metadata: Metadata = {
  title: race.shortName,
  description: `${race.whenLabel}. Register for the Chamber's Halloween-costume 5K and finish-line party in Kingston.`,
};

// A DEFAULT_HIDDEN_PAGES member: hidden at build time, so the bare gate's
// cookies() read makes this route dynamic. Accepted, exactly like /es.
export default async function RacePage() {
  const adminPreview = await assertPageVisible("/race");
  const register = safeExternalHref(race.registrationUrl);

  return (
    <>
      {adminPreview && <HiddenPageBanner />}
      <PageHeader eyebrow="Chamber event" title={race.name} intro={race.intro} />

      <Section title="Register" id="register">
        <Card>
          <ul className="space-y-3">
            {race.rates.map((rate) => (
              <li key={rate.title} className="flex items-baseline justify-between gap-4">
                <div>
                  <p className="font-semibold text-sound-deep">{rate.title}</p>
                  <p className="text-sm text-ink">{rate.note}</p>
                </div>
                <p className="text-xl font-semibold text-sound-deep">{rate.price}</p>
              </li>
            ))}
          </ul>
          <div className="mt-5">
            <RaceRegistration linkUrl={register} />
          </div>
          <p className="mt-4 text-sm text-ink">
            Registration is handled by Zeffy, a free ticketing platform for nonprofits, so every
            dollar of your entry reaches the Chamber. Your e-ticket arrives by email.
          </p>
        </Card>
      </Section>

      <Section title="When and where">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <h3 className="text-lg font-semibold text-sound-deep">The race</h3>
            <p className="mt-1 text-ink">{race.whenLabel}</p>
            <p className="text-ink">
              Starts in {race.venue} &mdash; {race.address}
            </p>
            <p className="mt-2 text-sm">
              <ExternalLink href={mapDirectionsUrl(race.address, "driving")}>
                Directions to the start
              </ExternalLink>
            </p>
          </Card>
          <Card>
            <h3 className="text-lg font-semibold text-sound-deep">The After Dark Party</h3>
            <p className="mt-1 text-ink">Finish at {race.partyVenue} by sunset.</p>
            <ul className="mt-2 space-y-2 text-sm text-ink">
              {race.party.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      <Section title="What your entry includes">
        <Card>
          <ul className="space-y-2 text-ink">
            {race.includes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-ink">{race.fundsNote}</p>
        </Card>
      </Section>

      <Section title="Plan your day">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <h3 className="text-lg font-semibold text-sound-deep">Coming by ferry?</h3>
            <p className="mt-1 text-sm text-ink">
              The start is a short walk from the Kingston terminal. Check{" "}
              <Link href="/ferry" className="font-medium text-tide-deep underline">
                live sailings and how full the boat is
              </Link>{" "}
              before you leave Edmonds.
            </p>
          </Card>
          <Card>
            <h3 className="text-lg font-semibold text-sound-deep">Driving?</h3>
            <p className="mt-1 text-sm text-ink">
              Race-day parking fills up. The{" "}
              <Link href="/parking" className="font-medium text-tide-deep underline">
                parking map
              </Link>{" "}
              shows every lot, including accessible spaces.
            </p>
          </Card>
        </div>
        <div className="mt-5">
          <Callout title="Sponsorships and questions" tone="coral">
            Local businesses can sponsor the race or host a booth at the finish-line party. Email{" "}
            <a
              href={`mailto:${race.organizerEmail}`}
              className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
            >
              {race.organizerEmail}
            </a>
            .
          </Callout>
        </div>
      </Section>
    </>
  );
}
