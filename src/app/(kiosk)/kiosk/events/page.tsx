import { KioskQr } from "@/components/kiosk-qr";
import { KioskCard, KioskEmpty, KioskScreen } from "@/components/kiosk-ui";
import { kioskHandoffUrl } from "@/lib/qr";
import { getEvents } from "@/lib/stores/event-store";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";

// What's on in town, kiosk-scaled.
//
// getEvents() is the ONE canonical events source (FR-EVT-09) — the same read
// the website's calendar makes, so an event approved once appears here with no
// separate kiosk publishing step, and an event that is still pending appears
// nowhere. The kiosk is a consumer of the moderated graph, never a publisher.

export const revalidate = 60;

/** Pacific-local day + time, the format every other date in the app uses. */
function whenLabel(startIso: string): string {
  const d = new Date(startIso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/**
 * Upcoming only, soonest first. A kiosk showing last weekend's festival is
 * worse than a kiosk showing nothing — it is actively misleading to somebody
 * deciding whether to stay in town.
 *
 * A module function rather than inline in the component so the clock read stays
 * out of the render body: the react-hooks lint rule treats Date.now() there as
 * an impure call, and it is right to, even though a server component renders
 * once per request.
 */
function upcomingEvents(events: Awaited<ReturnType<typeof getEvents>>, now: number = Date.now()) {
  return events
    .filter((e) => {
      const end = e.end ? Date.parse(e.end) : Date.parse(e.start);
      return Number.isFinite(end) && end >= now;
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .slice(0, 12);
}

export default async function KioskEventsPage() {
  const [events, copy] = await Promise.all([getEvents(), getCopyOverrides()]);
  const upcoming = upcomingEvents(events);

  return (
    <KioskScreen title="What's on" subtitle="Happening in and around Kingston">
      <div className="mb-10 flex items-center gap-10 rounded-3xl bg-white/10 p-10">
        <KioskQr
          value={kioskHandoffUrl("/events")}
          caption={copyText(copy, "kiosk.handoff.prompt")}
          size="sm"
        />
        <p className="text-3xl leading-relaxed text-white/85">
          The whole calendar, with directions and details, on your phone.
        </p>
      </div>

      {upcoming.length === 0 ? (
        <KioskEmpty>
          Nothing is on the calendar just now. The Chamber office across the road always knows what
          is happening this week.
        </KioskEmpty>
      ) : (
        upcoming.map((e) => (
          <KioskCard
            key={e.id}
            title={e.title}
            meta={`${whenLabel(e.start)}${e.venue ? ` · ${e.venue}` : ""}`}
            body={e.description}
          />
        ))
      )}
    </KioskScreen>
  );
}
