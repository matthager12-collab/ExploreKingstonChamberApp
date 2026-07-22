import type { Metadata } from "next";
import Link from "next/link";
import type { EventCategory, EventItem } from "@/lib/types";
import { attachmentKind, attachmentPublicUrl } from "@/lib/events/attachment-refs";
import { normalizedToEventItem } from "@/lib/events/normalize";
import { getUnifiedEvents } from "@/lib/events/unified";
import { getEvents } from "@/lib/stores/event-store";
import { getUnifiedCalendarEnabled } from "@/lib/stores/unified-calendar-store";
import { getCopyOverrides, copyText } from "@/lib/stores/site-store";
import { assertPageVisible, HiddenPageBanner } from "@/lib/page-visibility";
import { formatPacificDate, formatPacificTime, todayPacific } from "@/lib/time";
import { ReportInaccurate } from "@/components/report-inaccurate";
import { EventJsonLd } from "@/components/json-ld";
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
      <span className="text-[0.625rem] font-bold tracking-widest uppercase opacity-80">
        {weekday}
      </span>
      <span className="text-sm font-bold tracking-wide uppercase">{monthDay}</span>
    </div>
  );
}

function EventCard({ event, external }: { event: EventItem; external?: boolean }) {
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
            {event.venue && (
              <>
                <span className="mx-2 text-ink-soft" aria-hidden>
                  ·
                </span>
                <ExternalLink
                  href={mapSearchUrl(event.address ?? `${event.venue}, Kingston, WA`)}
                >
                  {event.venue}
                </ExternalLink>
              </>
            )}
          </p>
          <p className="mt-2 text-sm text-ink-soft">{event.description}</p>
          {event.attachments && event.attachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {event.attachments.map((ref) =>
                attachmentKind(ref) === "pdf" ? (
                  <a
                    key={ref}
                    href={attachmentPublicUrl(ref)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-sand-deep px-2.5 py-1.5 text-xs font-medium text-tide-deep hover:border-tide"
                  >
                    📄 Flyer (PDF)
                  </a>
                ) : (
                  <a key={ref} href={attachmentPublicUrl(ref)} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={attachmentPublicUrl(ref)}
                      alt={`${event.title} flyer`}
                      loading="lazy"
                      className="h-24 w-24 rounded-lg object-cover ring-1 ring-sand-deep"
                    />
                  </a>
                ),
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-ink-soft">
            {event.organizer && <>By {event.organizer}</>}
            {event.url && (
              <>
                {event.organizer && (
                  <span className="mx-2" aria-hidden>
                    ·
                  </span>
                )}
                <ExternalLink href={event.url} className="text-xs">
                  Event page
                </ExternalLink>
              </>
            )}
          </p>
          {event.eventContact && (
            <p className="mt-1 text-xs text-ink-soft">
              Questions about this event? {event.eventContact}
            </p>
          )}
          {/* External (ingested) events aren't records in the events store —
              corrections belong upstream, so no report intake for them. */}
          {!external && (
            <ReportInaccurate store="events" id={event.id} subject={event.title} />
          )}
        </div>
      </div>
    </Card>
  );
}

export default async function EventsPage() {
  const hiddenPreview = await assertPageVisible("/events");
  // Ship-dark flag (E12): OFF → exactly the pre-E12 in-app-only page. The
  // check is session-free on purpose — this page is ISR (shared cache), so
  // an admin-preview branch here would serve preview data to everyone;
  // admins preview the merged calendar on /admin/events-sources instead.
  const unified = await getUnifiedCalendarEnabled();
  const copy = await getCopyOverrides();
  let events: EventItem[];
  const externalIds = new Set<string>();
  if (unified) {
    const merged = await getUnifiedEvents();
    events = merged.map(normalizedToEventItem);
    for (const n of merged) {
      if (n.source !== "in-app") externalIds.add(normalizedToEventItem(n).id);
    }
  } else {
    events = await getEvents();
  }
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
      {/* Event structured data (M-13-02/M-13-03). Emitted for UPCOMING events
          only — the same list the page renders, which is live-only via the
          default getters (E08), so nothing pending or draft is ever described
          to a crawler. Suppressed entirely on an admin's hidden-page preview:
          that render is not what the public sees, and marking up an unpublished
          page would invite it into search results. */}
      {!hiddenPreview && upcoming.map((event) => <EventJsonLd key={event.id} event={event} />)}
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
              <EventCard key={event.id} event={event} external={externalIds.has(event.id)} />
            ))}
          </div>
        </Section>
      )}

      {[...byMonth.entries()].map(([monthKey, monthEvents]) => (
        <Section key={monthKey} title={monthLabel(monthKey)}>
          <div className="grid gap-4">
            {monthEvents.map((event) => (
              <EventCard key={event.id} event={event} external={externalIds.has(event.id)} />
            ))}
          </div>
        </Section>
      ))}

      <Section>
        {unified ? (
          <>
            <Callout title="Have an event?" tone="coral">
              Suggest it for the Kingston calendar —{" "}
              <Link
                className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
                href="/events/suggest"
              >
                submit it here
              </Link>{" "}
              and the Chamber will review it before it goes live.
            </Callout>
            <p className="mt-4 text-sm text-ink">
              This calendar is maintained by the Kingston Chamber and merges
              community calendars around town automatically. Always confirm
              details with the organizer before making the trip.
            </p>
          </>
        ) : (
          <>
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
            <p className="mt-4 text-sm text-ink">
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
          </>
        )}
      </Section>
    </>
  );
}
