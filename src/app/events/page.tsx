import type { Metadata } from "next";
import type { EventCategory, EventItem } from "@/lib/types";
import { getEvents } from "@/lib/stores/event-store";
import { getCopyOverrides, copyText } from "@/lib/stores/site-store";
import { assertPageVisible, HiddenPageBanner } from "@/lib/page-visibility";
import { formatPacificDate, formatPacificTime, todayPacific } from "@/lib/time";
import {
  Badge,
  Callout,
  Card,
  ExternalLink,
  PageHeader,
  Section,
  mapSearchUrl,
} from "@/components/ui";

// "This weekend" depends on today's date — re-render at most every 60 s so a
// statically built page doesn't freeze on the build day.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Events",
  description:
    "What's happening in Kingston, WA — markets, waterfront concerts, fireworks, and community events, curated by the Kingston Chamber.",
};

const categoryTone: Record<
  EventCategory,
  "navy" | "teal" | "coral" | "green" | "sand"
> = {
  festival: "coral",
  market: "green",
  music: "teal",
  community: "navy",
  charity: "coral",
  sports: "navy",
  arts: "sand",
};

const categoryLabel: Record<EventCategory, string> = {
  festival: "Festival",
  market: "Market",
  music: "Music",
  community: "Community",
  charity: "Fundraiser",
  sports: "Sports",
  arts: "Arts",
};

/** "2026-07-05" from an ISO string with a Pacific offset. */
function dateOf(iso: string): string {
  return iso.slice(0, 10);
}

/** The next `count` Pacific date strings, starting today. */
function upcomingDates(count: number): string[] {
  const noonUtc = new Date(`${todayPacific()}T12:00:00Z`).getTime();
  return Array.from({ length: count }, (_, i) =>
    new Date(noonUtc + i * 86_400_000).toISOString().slice(0, 10),
  );
}

function monthLabel(monthKey: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${monthKey}-01T12:00:00Z`));
}

function timeLabel(event: EventItem): string {
  const start = formatPacificTime(event.start);
  // Convention in the seed data: a midnight start means "all day".
  if (start === "12:00 AM") return "All day";
  return event.end ? `${start} – ${formatPacificTime(event.end)}` : start;
}

function DateBlock({ iso }: { iso: string }) {
  // formatPacificDate -> "Sat, Jul 4"
  const [weekday, monthDay] = formatPacificDate(iso).split(", ");
  return (
    <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-sound text-white">
      <span className="text-[10px] font-bold tracking-widest uppercase opacity-80">
        {weekday}
      </span>
      <span className="text-sm font-bold tracking-wide uppercase">{monthDay}</span>
    </div>
  );
}

function EventCard({ event }: { event: EventItem }) {
  return (
    <Card>
      <div className="flex gap-4">
        <DateBlock iso={event.start} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="text-lg font-semibold text-sound-deep">{event.title}</h3>
            <Badge tone={categoryTone[event.category]}>
              {categoryLabel[event.category]}
            </Badge>
          </div>
          <p className="mt-1 text-sm font-medium text-ink">
            {timeLabel(event)}
            <span className="mx-2 text-ink-soft" aria-hidden>
              ·
            </span>
            <ExternalLink
              href={mapSearchUrl(event.address ?? `${event.venue}, Kingston, WA`)}
            >
              {event.venue}
            </ExternalLink>
          </p>
          <p className="mt-2 text-sm text-ink-soft">{event.description}</p>
          <p className="mt-2 text-xs text-ink-soft">
            By {event.organizer}
            {event.url && (
              <>
                <span className="mx-2" aria-hidden>
                  ·
                </span>
                <ExternalLink href={event.url} className="text-xs">
                  Event page
                </ExternalLink>
              </>
            )}
          </p>
        </div>
      </div>
    </Card>
  );
}

export default async function EventsPage() {
  const hiddenPreview = await assertPageVisible("/events");
  const [events, copy] = await Promise.all([getEvents(), getCopyOverrides()]);
  const today = todayPacific();
  const upcoming = events
    .filter((event) => dateOf(event.start) >= today)
    .sort((a, b) => a.start.localeCompare(b.start));

  const weekendWindow = upcomingDates(4);
  const thisWeekend = upcoming.filter((event) =>
    weekendWindow.includes(dateOf(event.start)),
  );

  const byMonth = new Map<string, EventItem[]>();
  for (const event of upcoming) {
    const key = dateOf(event.start).slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), event]);
  }

  return (
    <>
      {hiddenPreview && <HiddenPageBanner />}
      <PageHeader
        eyebrow={copyText(copy, "events.header.eyebrow")}
        title={copyText(copy, "events.header.title")}
        intro={copyText(copy, "events.header.intro")}
      />

      {thisWeekend.length === 0 && byMonth.size === 0 && (
        <Section>
          <Card>
            <p className="font-semibold text-sound-deep">Nothing on the calendar right now.</p>
            <p className="mt-1 text-sm text-ink-soft">
              Between seasons it can go quiet here. Check the{" "}
              <ExternalLink href="https://business.kingstonchamber.com/events">
                Kingston Chamber calendar
              </ExternalLink>{" "}
              and the{" "}
              <ExternalLink href="https://portofkingston.org/events/list/">
                Port of Kingston calendar
              </ExternalLink>{" "}
              for the latest, or submit your own below.
            </p>
          </Card>
        </Section>
      )}

      {thisWeekend.length > 0 && (
        <Section
          title="This weekend"
          subtitle="Coming up in the next few days — no planning required."
        >
          <div className="grid gap-4">
            {thisWeekend.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </Section>
      )}

      {[...byMonth.entries()].map(([monthKey, monthEvents]) => (
        <Section key={monthKey} title={monthLabel(monthKey)}>
          <div className="grid gap-4">
            {monthEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </Section>
      ))}

      <Section>
        <Callout title="Have an event?" tone="coral">
          Submit it through the Kingston Chamber — email{" "}
          <a
            className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
            href="mailto:info@kingstonchamber.com?subject=Event%20for%20the%20Visit%20Kingston%20calendar"
          >
            info@kingstonchamber.com
          </a>{" "}
          with the date, time, venue, and a sentence or two about it.
        </Callout>
        <p className="mt-4 text-sm text-ink-soft">
          This calendar is curated by hand by the Kingston Chamber from its{" "}
          <ExternalLink href="https://business.kingstonchamber.com/events">
            events calendar
          </ExternalLink>{" "}
          and the{" "}
          <ExternalLink href="https://portofkingston.org/events/list/">
            Port of Kingston calendar
          </ExternalLink>
          . Automatic feed sync is on the roadmap — until then, always confirm
          details with the organizer before making the trip.
        </p>
      </Section>
    </>
  );
}
