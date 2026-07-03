import Image from "next/image";
import Link from "next/link";
import { getTodaysSailings } from "@/lib/wsf";
import { getFastFerrySailings } from "@/lib/kitsap";
import { getForecast } from "@/lib/weather";
import { getTodaysTides } from "@/lib/tides";
import { getEvents } from "@/lib/stores/event-store";
import { getCopyOverrides, copyText, getHiddenPaths } from "@/lib/stores/site-store";
import { formatPacificDate, formatPacificTime, todayPacific } from "@/lib/time";
import { Badge, Card, ExternalLink, Section } from "@/components/ui";
import { VisitorSurvey } from "@/components/visitor-survey";
import { FerryLineInfo } from "@/components/ferry-line-info";

export const revalidate = 60;

const features = [
  { href: "/ferry", title: "Ferry", blurb: "Sailings, live waits, walk-on tips", icon: "⛴️" },
  { href: "/eat", title: "Eat & Drink", blurb: "Menus & ordering, all walkable", icon: "🦪" },
  { href: "/events", title: "Events", blurb: "What's on this week", icon: "🎉" },
  { href: "/itineraries", title: "Itineraries", blurb: "Ready-made Kingston days", icon: "🗺️" },
  { href: "/parking", title: "Parking & ATMs", blurb: "Where to leave the car", icon: "🅿️" },
  { href: "/webcams", title: "Webcams", blurb: "Eyes on the ferry line", icon: "📷" },
  { href: "/stay", title: "Stay", blurb: "Inns, rentals, moorage", icon: "🌙" },
  { href: "/hunt", title: "Scavenger Hunt", blurb: "Free family adventure", icon: "🔎" },
  { href: "/give", title: "Give Back", blurb: "Volunteer & local causes", icon: "💚" },
];

function nextDeparture(
  sailings: { departs: string; direction: string }[],
  direction: "to-kingston" | "from-kingston",
): string | null {
  const now = Date.now();
  const next = sailings
    .filter((s) => s.direction === direction && new Date(s.departs).getTime() > now)
    .sort((a, b) => a.departs.localeCompare(b.departs))[0];
  return next ? formatPacificTime(next.departs) : null;
}

export default async function Home() {
  const [carFerry, forecast, tides, events, copy, hiddenPaths] = await Promise.all([
    getTodaysSailings(),
    getForecast(2),
    getTodaysTides(),
    getEvents(),
    getCopyOverrides(),
    getHiddenPaths(),
  ]);
  const fastFerry = getFastFerrySailings();
  // Admin-hidden pages drop out of the feature grid.
  const visibleFeatures = features.filter((f) => !hiddenPaths.includes(f.href));

  const nextToEdmonds = nextDeparture(carFerry.sailings, "from-kingston");
  const nextToKingston = nextDeparture(carFerry.sailings, "to-kingston");
  const nextFastOut = nextDeparture(fastFerry.sailings, "from-kingston");

  const today = todayPacific();
  const upcoming = events
    .filter((e) => e.start.slice(0, 10) >= today)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 3);

  const weatherNow = forecast[0];

  return (
    <>
      {/* Hero — Kitsap Fast Ferry at the Kingston dock with Mount Rainier behind */}
      <div className="relative isolate overflow-hidden text-white">
        <Image
          src="/brand/photo-kingston-37.jpg"
          alt=""
          fill
          preload
          sizes="100vw"
          className="-z-20 object-cover"
        />
        {/* Navy-to-cyan brand overlay, heaviest at the top where the copy sits,
            keeps white text AAA-readable over the bright sky in the photo */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-b from-sound-deep/95 via-sound-deep/80 to-tide-deep/75"
        />
        <div className="mx-auto max-w-5xl px-4 pt-14 pb-10 sm:pt-20 sm:pb-16">
          <p className="font-nav text-sm font-semibold tracking-[0.25em] text-seaglass uppercase">
            {copyText(copy, "home.hero.eyebrow", "Gateway to the Kitsap & Olympic Peninsulas")}
          </p>
          <h1 className="font-display mt-3 max-w-2xl text-5xl leading-tight font-semibold sm:text-6xl">
            {copyText(copy, "home.hero.title1", "You made the boat.")}
            <br />
            {copyText(copy, "home.hero.title2", "Now make the most of")}{" "}
            <span className="font-script text-[1.15em] font-normal">Kingston</span>.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-white">
            {copyText(
              copy,
              "home.hero.intro",
              "Ferry times, food worth walking to, and everything happening in our little town on Appletree Cove — from the folks who live here.",
            )}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/ferry"
              className="rounded-full bg-coral px-6 py-3 font-semibold text-white shadow hover:bg-coral-deep"
            >
              {copyText(copy, "home.hero.ctaPrimary", "Next boats →")}
            </Link>
            <Link
              href="/itineraries"
              className="rounded-full border border-seaglass/60 px-6 py-3 font-semibold text-white hover:bg-white/10"
            >
              {copyText(copy, "home.hero.ctaSecondary", "Plan my day")}
            </Link>
          </div>
        </div>

        {/* Live strip */}
        <div className="border-t border-white/15 bg-sound-deep/85">
          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-4">
            <div>
              <p className="text-seaglass">Next boat to Edmonds</p>
              <p className="text-lg font-semibold">{nextToEdmonds ?? "Done for today"}</p>
            </div>
            <div>
              <p className="text-seaglass">Next arrival from Edmonds</p>
              <p className="text-lg font-semibold">{nextToKingston ?? "Done for today"}</p>
            </div>
            <div>
              <p className="text-seaglass">Fast ferry to Seattle</p>
              <p className="text-lg font-semibold">{nextFastOut ?? "Not today"}</p>
            </div>
            <div>
              <p className="text-seaglass">{weatherNow ? weatherNow.name : "Weather"}</p>
              <p className="text-lg font-semibold">
                {weatherNow
                  ? `${weatherNow.temperature}°${weatherNow.temperatureUnit} · ${weatherNow.shortForecast}`
                  : "See forecast at weather.gov"}
              </p>
            </div>
          </div>
          {!carFerry.live && (
            <p className="mx-auto max-w-5xl px-4 pb-3 text-xs text-seaglass/80">
              Schedule times, not live status — confirm at wsdot.wa.gov/ferries.
            </p>
          )}
        </div>
      </div>

      {/* Getting in the ferry line */}
      <Section>
        <FerryLineInfo />
      </Section>

      {/* Coming up */}
      {upcoming.length > 0 && (
        <Section title="Coming up in Kingston" subtitle="The next few things worth planning around.">
          <div className="grid gap-4 sm:grid-cols-3">
            {upcoming.map((e) => (
              <Card key={e.id}>
                <p className="text-sm font-semibold text-coral-deep">{formatPacificDate(e.start)}</p>
                <p className="font-display mt-1 text-lg font-semibold text-sound-deep">{e.title}</p>
                <p className="mt-1 text-sm text-ink-soft">{e.venue}</p>
              </Card>
            ))}
          </div>
          <Link
            href="/events"
            className="mt-4 inline-block font-semibold text-tide-deep underline decoration-seaglass underline-offset-2"
          >
            Full events calendar →
          </Link>
        </Section>
      )}

      {/* Feature grid */}
      <Section title="Everything in town, one tap away">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {visibleFeatures.map((f) => (
            <Link
              key={f.href}
              href={f.href}
              className="group rounded-2xl border border-sand bg-white p-4 shadow-[0_1px_3px_rgba(22,64,94,0.08)] transition hover:border-tide hover:shadow-md"
            >
              <span className="text-2xl">{f.icon}</span>
              <p className="font-display mt-2 font-semibold text-sound-deep group-hover:text-tide-deep">
                {f.title}
              </p>
              <p className="mt-0.5 text-sm text-ink-soft">{f.blurb}</p>
            </Link>
          ))}
        </div>
      </Section>

      {/* Photo strip — scenes from the Explore Kingston photo library */}
      <div className="bg-topo border-y border-sand">
        <Section
          title="This is Kingston"
          subtitle="Scenes from around town and the north Kitsap shore."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              {
                src: "/brand/photo-hansville-hero.jpg",
                alt: "Point No Point lighthouse in Hansville with Puget Sound and the Cascades behind",
              },
              {
                src: "/brand/photo-kingston-59.jpg",
                alt: "Aerial view of Kingston's harbor and marina wrapped in evergreen forest",
              },
              {
                src: "/brand/photo-kingston-harbor-35.jpg",
                alt: "Coastal townhomes near the Kingston waterfront in warm evening light",
              },
            ].map((p) => (
              <div
                key={p.src}
                className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-sand shadow-[0_1px_3px_rgba(34,51,77,0.08)]"
              >
                <Image
                  src={p.src}
                  alt={p.alt}
                  fill
                  sizes="(min-width: 640px) 33vw, 100vw"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-ink-soft">
            More photos, stories, and trip ideas at{" "}
            <ExternalLink href="https://explorekingstonwa.com">
              explorekingstonwa.com
            </ExternalLink>
            .
          </p>
        </Section>
      </div>

      {/* Tides + survey */}
      <Section>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <p className="font-display text-lg font-semibold text-sound-deep">
              Tides at Appletree Cove today
            </p>
            {tides.length > 0 ? (
              <ul className="mt-3 space-y-1.5 text-sm">
                {tides.map((t) => (
                  <li key={t.time} className="flex items-center gap-2">
                    <Badge tone={t.type === "high" ? "teal" : "sand"}>
                      {t.type === "high" ? "High" : "Low"}
                    </Badge>
                    <span className="font-medium">{t.time.slice(11)}</span>
                    <span className="text-ink-soft">{t.heightFeet.toFixed(1)} ft</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-soft">
                Tide data unavailable right now — NOAA station 9445639 has the
                official predictions.
              </p>
            )}
            <p className="mt-3 text-xs text-ink-soft">
              Low tide is beach-walk time. Source: NOAA CO-OPS, Kingston station.
            </p>
          </Card>
          <VisitorSurvey />
        </div>
      </Section>
    </>
  );
}
