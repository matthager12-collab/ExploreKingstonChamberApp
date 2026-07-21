import type { Metadata } from "next";
import type { Charity, EventItem } from "@/lib/types";
import { getCharities, getVolunteerNeeds } from "@/lib/stores/charity-store";
import { getEvents } from "@/lib/stores/event-store";
import { getCopyOverrides, copyText } from "@/lib/stores/site-store";
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
import { formatPacificDate, formatPacificTime, todayPacific } from "@/lib/time";

export const metadata: Metadata = {
  title: "Give Back",
  description:
    "Kingston-area nonprofits, volunteer shifts you can join this summer, and a shared calendar so fundraisers don't land on the same day.",
};

const VOLUNTEER_KITSAP_URL = "https://unitedwaykitsap.galaxydigital.com/";
const CHAMBER_EVENTS_URL = "https://business.kingstonchamber.com/events";

/** Honest v1 signup path: email the org if we have one, else their site, else the county portal. */
function raiseHandHref(charity: Charity | undefined, needTitle: string): string {
  if (charity?.contactEmail) {
    return `mailto:${charity.contactEmail}?subject=${encodeURIComponent(
      `Volunteering: ${needTitle}`
    )}`;
  }
  if (charity?.website) return charity.website;
  return VOLUNTEER_KITSAP_URL;
}

const pacificDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
});

function pacificDateKey(iso: string): string {
  return pacificDay.format(new Date(iso));
}

export const revalidate = 60;

export default async function GiveBackPage() {
  const hiddenPreview = await assertPageVisible("/give");
  const [charities, volunteerNeeds, events, copy] = await Promise.all([
    getCharities(),
    getVolunteerNeeds(),
    getEvents(),
    getCopyOverrides(),
  ]);
  const charityById = new Map(charities.map((c) => [c.id, c]));
  const today = todayPacific();

  const sortedNeeds = [...volunteerNeeds]
    .filter((n) => pacificDateKey(n.date) >= today)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Deconfliction view: group every upcoming event (charity or not) by Pacific date.
  const upcoming = (events as EventItem[])
    .filter((e: EventItem) => pacificDateKey(e.start) >= today)
    .sort(
      (a: EventItem, b: EventItem) =>
        new Date(a.start).getTime() - new Date(b.start).getTime()
    );

  const byDate = new Map<string, EventItem[]>();
  for (const e of upcoming) {
    const key = pacificDateKey(e.start);
    const list = byDate.get(key);
    if (list) list.push(e);
    else byDate.set(key, [e]);
  }
  const dateEntries = [...byDate.entries()];
  const busyCount = dateEntries.filter(([, list]) => list.length >= 2).length;

  return (
    <>
      {hiddenPreview && <HiddenPageBanner />}
      <PageHeader
        eyebrow={copyText(copy, "give.header.eyebrow")}
        title={copyText(copy, "give.header.title")}
        intro={copyText(copy, "give.header.intro")}
      />

      <Section
        title="Nonprofit directory"
        subtitle={copyText(copy, "give.directory.subtitle")}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {charities.map((c) => (
            <Card key={c.id}>
              <h3 className="text-lg font-semibold text-sound-deep">{c.name}</h3>
              <p className="mt-2 text-sm text-ink-soft">{c.mission}</p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {c.website && <ExternalLink href={c.website}>Website</ExternalLink>}
                {c.contactEmail && (
                  <a
                    href={`mailto:${c.contactEmail}`}
                    className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
                  >
                    {c.contactEmail}
                  </a>
                )}
                {!c.website && !c.contactEmail && (
                  <ExternalLink href={mapSearchUrl(`${c.name} Kingston WA`)}>
                    Find them on the map
                  </ExternalLink>
                )}
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        title="Volunteer right now"
        subtitle={copyText(copy, "give.volunteer.subtitle")}
      >
        {sortedNeeds.length === 0 && (
          <Card>
            <p className="font-semibold text-sound-deep">No shifts posted right now.</p>
            <p className="mt-1 text-sm text-ink-soft">
              Things quiet down between events — but the organizations above always welcome an
              email from someone who wants to help. Reach out to any of them directly.
            </p>
          </Card>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {sortedNeeds.map((need) => {
            const charity = charityById.get(need.charityId);
            const pct = Math.min(
              100,
              Math.round((need.slotsFilled / need.slotsTotal) * 100)
            );
            const spotsLeft = Math.max(0, need.slotsTotal - need.slotsFilled);
            return (
              <Card key={need.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-semibold text-sound-deep">
                    {need.title}
                  </h3>
                  <Badge tone={spotsLeft > 0 ? "green" : "sand"}>
                    {spotsLeft > 0 ? `${spotsLeft} spots left` : "Full"}
                  </Badge>
                </div>
                {charity && (
                  <p className="mt-1 text-sm font-medium text-tide-deep">
                    {charity.name}
                  </p>
                )}
                <p className="mt-1 text-sm text-ink">
                  {formatPacificDate(need.date)} · {need.timeRange}
                </p>
                <p className="mt-2 flex-1 text-sm text-ink-soft">
                  {need.description}
                </p>
                <div className="mt-4">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-sand">
                    <div
                      className="h-full rounded-full bg-fern"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">
                    {need.slotsFilled} of {need.slotsTotal} slots filled
                  </p>
                </div>
                <div className="mt-3">
                  <ExternalLink href={raiseHandHref(charity, need.title)}>
                    Raise your hand →
                  </ExternalLink>
                </div>
              </Card>
            );
          })}
        </div>

        <div className="mt-6">
          <Callout title="Want more options? The whole county is one click away.">
            United Way of Kitsap County runs a free volunteer-matching portal —
            the{" "}
            <ExternalLink href={VOLUNTEER_KITSAP_URL}>
              Volunteer Center of Kitsap County
            </ExternalLink>{" "}
            — where you can browse needs across the region and track your hours.
            It&apos;s free for volunteers, and Kingston nonprofits can register
            their own agency there too (confirm details with{" "}
            <a
              href="mailto:sjones@unitedwaykitsap.org"
              className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
            >
              sjones@unitedwaykitsap.org
            </a>
            ).
          </Callout>
        </div>
      </Section>

      <Section
        title="Planning a fundraiser? Deconflict first"
        subtitle={copyText(copy, "give.deconflict.subtitle")}
      >
        {dateEntries.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-soft">
              Nothing on the calendar yet. Cross-check the{" "}
              <ExternalLink href={CHAMBER_EVENTS_URL}>
                Greater Kingston Chamber events calendar
              </ExternalLink>{" "}
              before you pick a date.
            </p>
          </Card>
        ) : (
          <>
            <p className="mb-3 text-sm text-ink">
              {upcoming.length} upcoming {upcoming.length === 1 ? "event" : "events"}
              {busyCount > 0 && (
                <>
                  {" "}
                  · {busyCount} {busyCount === 1 ? "date" : "dates"} already
                  doing double duty
                </>
              )}
            </p>
            <Card className="divide-y divide-sand p-0">
              {dateEntries.map(([dateKey, list]) => {
                const busy = list.length >= 2;
                return (
                  <div
                    key={dateKey}
                    className="flex flex-col gap-1 p-4 sm:flex-row sm:gap-6"
                  >
                    <div className="flex shrink-0 items-center gap-2 sm:w-44 sm:items-start sm:pt-0.5">
                      <span className="font-semibold text-sound-deep">
                        {formatPacificDate(list[0].start)}
                      </span>
                      {busy && <Badge tone="coral">Busy date</Badge>}
                    </div>
                    <ul className="min-w-0 flex-1 space-y-1">
                      {list.map((e) => (
                        <li key={e.id} className="text-sm text-ink">
                          <span className="text-ink-soft">
                            {formatPacificTime(e.start)}
                          </span>{" "}
                          <span className="font-medium">{e.title}</span>
                          <span className="text-ink-soft"> — {e.organizer}</span>
                          {e.category === "charity" && (
                            <span className="ml-2 align-middle">
                              <Badge tone="green">nonprofit</Badge>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </Card>
          </>
        )}

        <div className="mt-6">
          <Callout tone="coral" title="How this gets better">
            Today this is a read-only view of the town calendar. On the roadmap:
            nonprofits log in, post tentative dates, and get an automatic
            conflict warning — a heads-up, never a hard block — before they
            book. Until then, also cross-check the{" "}
            <ExternalLink href={CHAMBER_EVENTS_URL}>
              Greater Kingston Chamber calendar
            </ExternalLink>
            , which lists events this page may not have yet.
          </Callout>
        </div>
      </Section>
    </>
  );
}
