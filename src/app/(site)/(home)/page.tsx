import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getForecast } from "@/lib/weather";
import { getTodaysTides } from "@/lib/tides";
import { getEvents } from "@/lib/stores/event-store";
import { getCopyOverrides, copyText } from "@/lib/stores/site-store";
import { getEffectiveHiddenPaths } from "@/lib/page-visibility";
import { getFerryStatusSnapshot } from "@/lib/ferry-status";
import { formatPacificDate, formatPacificTime, todayPacific } from "@/lib/time";
import { Badge, Card, ExternalLink, Section } from "@/components/ui";
import { VisitorSurvey } from "@/components/visitor-survey";
import { FerryLineInfo } from "@/components/ferry-line-info";
import { NextFerries } from "@/components/next-ferries";
import { SideSwitcher } from "@/components/side-switcher";
import { getSide } from "@/lib/side-server";
import { getFerryPredictionEnabled } from "@/lib/stores/ferry-prediction-store";
import { getPhotoContext } from "@/lib/stores/photo-store";
import { resolvePhoto } from "@/lib/photo-resolve";
import type { PhotoSlotKey } from "@/lib/photo-slots";

export const revalidate = 60;

/**
 * Override ONLY the share-preview image, from the admin-chosen share.og slot.
 *
 * Everything else about the card — title, description, twitter card type — is
 * inherited from the root layout's static metadata and deliberately not
 * repeated here. Scoped to this page on purpose: see the note in
 * photo-slots.ts about why this must not move into the root layout.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { overrides, library } = await getPhotoContext();
  const og = resolvePhoto("share.og", overrides["share.og"], library);
  return {
    openGraph: { images: [{ url: og.src, alt: og.alt }] },
    twitter: { images: [og.src] },
  };
}

const features = [
  { href: "/ferry", title: "Ferry", blurb: "Sailings, live waits, walk-on tips", icon: "⛴️" },
  { href: "/eat", title: "Eat & Drink", blurb: "Menus & ordering, all walkable", icon: "🦪" },
  { href: "/events", title: "Events", blurb: "What's on this week", icon: "🎉" },
  { href: "/itineraries", title: "Itineraries", blurb: "Ready-made Kingston days", icon: "🗺️" },
  { href: "/parking", title: "Parking", blurb: "Where to leave the car", icon: "🅿️" },
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
  const [ferry, forecast, tides, events, copy, hiddenPaths, side, predictionEnabled, photos] =
    await Promise.all([
      getFerryStatusSnapshot(),
      getForecast(2),
      getTodaysTides(),
      getEvents(),
      getCopyOverrides(),
      getEffectiveHiddenPaths(),
      getSide(),
      getFerryPredictionEnabled(),
      getPhotoContext(),
    ]);
  // Admin-chosen photos, resolved through the same helper the /admin/media
  // preview uses — the editor and this page must never disagree about what a
  // slot renders. An untouched slot resolves to the /brand asset below.
  const photo = (key: PhotoSlotKey) => resolvePhoto(key, photos.overrides[key], photos.library);
  const fastFerry = ferry.fastFerry;
  // Admin-hidden pages drop out of the feature grid.
  const visibleFeatures = features.filter((f) => !hiddenPaths.includes(f.href));

  const nextFastOut = nextDeparture(fastFerry.sailings, "from-kingston");

  const today = todayPacific();
  // E13: dates the ferry widget's staleness label from THIS render, not from
  // the visitor's clock at hydration — this HTML can be served back out of the
  // service worker's shell cache hours later. Same prop the /ferry board takes.
  const serverNow = new Date().toISOString();
  const upcoming = events
    .filter((e) => e.start.slice(0, 10) >= today)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 3);

  const weatherNow = forecast[0];

  return (
    <>
      {/* Hero — Coastal Elegance */}
      <div className="relative isolate min-h-[90vh] overflow-hidden text-white flex flex-col justify-between pb-8">
        {/* home.hero is a DECORATIVE slot, so resolvePhoto always returns
            alt="" — the headline below already says what this page is. */}
        <Image
          src={photo("home.hero").src}
          alt={photo("home.hero").alt}
          fill
          preload
          // This is the LCP element on "/" (verified via the Lighthouse CI
          // trace: selector main#main > div.relative > img.-z-20). `preload`
          // alone emits the <link rel=preload as=image> with NO fetchpriority,
          // which Chrome schedules as a LOW-priority fetch — behind every JS
          // chunk on the connection pool. fetchPriority="high" rides the same
          // preload link (ImagePreload forwards it) and bumps the hero ahead
          // of non-critical requests, exactly the web.dev LCP guidance.
          fetchPriority="high"
          sizes="100vw"
          className="-z-20 object-cover"
        />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-b from-sound-deep/90 via-sound/60 to-transparent"
        />
        <div className="mx-auto w-full max-w-5xl px-4 pt-14 sm:pt-20">
          <SideSwitcher side={side} tone="dark" className="mb-6" />
          {side === "edmonds" ? (
            <>
              <p className="font-nav text-sm font-semibold tracking-[0.25em] text-cyan-200 uppercase">
                {copyText(copy, "home.hero.edmonds.eyebrow")}
              </p>
              <h1 className="font-display mt-3 max-w-2xl text-5xl leading-tight font-semibold sm:text-6xl drop-shadow-lg">
                {copyText(copy, "home.hero.edmonds.title1")}{" "}
                <span className="font-script text-[1.15em] font-normal text-cyan-100">short sail</span>{" "}
                {copyText(copy, "home.hero.edmonds.title2")}
              </h1>
              <p className="mt-4 max-w-xl text-lg text-white/90 drop-shadow-md">
                {copyText(copy, "home.hero.edmonds.intro")}
              </p>
            </>
          ) : (
            <>
              <p className="font-nav text-sm font-semibold tracking-[0.25em] text-cyan-200 uppercase">
                {copyText(copy, "home.hero.eyebrow")}
              </p>
              <h1 className="font-display mt-3 max-w-2xl text-5xl leading-tight font-semibold sm:text-7xl drop-shadow-xl">
                {copyText(copy, "home.hero.title1")}
                <br />
                <span className="font-script text-[1.15em] font-normal text-cyan-100">Kingston's</span> Magic.
              </h1>
              <p className="mt-4 max-w-xl text-lg text-white/90 drop-shadow-md">
                {copyText(copy, "home.hero.intro")}
              </p>
            </>
          )}
        </div>

        {/* Floating Glassmorphic Ferry Status Widget */}
        <div className="mx-auto w-full max-w-5xl px-4 mt-12">
          <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-6 shadow-[0_8px_32px_rgba(0,0,0,0.12)]">
            <NextFerries initial={ferry} serverNow={serverNow} tone="dark" side={side} />
            <div className="mt-5 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-t border-white/15 pt-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-cyan-200 font-medium">
                  {copyText(copy, "home.strip.fastFerry")}
                </span>
                <span className="font-bold text-white">{nextFastOut ?? "Not today"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-cyan-200 font-medium">
                  {weatherNow ? weatherNow.name : "Weather:"}
                </span>
                <span className="font-bold text-white">
                  {weatherNow
                    ? `${weatherNow.temperature}°${weatherNow.temperatureUnit} · ${weatherNow.shortForecast}`
                    : "See forecast at weather.gov"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* E14 (M-14-03): the plain-language door, above everything else on the
          page for the reader who needs it most. Hideable like any other page,
          so it goes through the same hiddenPaths filter as the feature grid. */}
      {!hiddenPaths.includes("/simple") && (
        <Section>
          <Link
            href="/simple"
            className="flex min-h-11 items-center justify-between gap-4 rounded-2xl border-2 border-sound bg-white px-5 py-4"
          >
            <span>
              <span className="font-display block text-xl font-semibold text-sound-deep">
                Kingston basics
              </span>
              <span className="block text-base text-ink">
                Big type, short words: the next boats, where to eat, and a phone number that
                reaches a person.
              </span>
            </span>
            <span className="shrink-0 text-lg font-semibold text-sound-deep" aria-hidden>
              →
            </span>
          </Link>
        </Section>
      )}

      {/* Plan-ahead callout → the ferry busyness planner. Shown only when the
          feature is live for visitors; admins preview it on /ferry/plan. */}
      {predictionEnabled && (
        <Section>
          <Link
            href="/ferry/plan"
            className="flex items-center justify-between gap-4 rounded-2xl border border-tide/30 bg-tide/[0.04] px-5 py-4 transition-colors hover:bg-tide/[0.08]"
          >
            <div>
              <p className="font-display font-semibold text-sound-deep">
                {side === "edmonds"
                  ? "Crossing to Kingston? See how busy the ferry will be."
                  : "Planning a ferry trip? See how busy it will be."}
              </p>
              <p className="text-sm text-ink-soft">
                Pick any date and time for a busyness estimate, when to arrive, and a full-day
                trendline.
              </p>
            </div>
            <span className="shrink-0 text-lg font-semibold text-tide-deep" aria-hidden>
              →
            </span>
          </Link>
        </Section>
      )}

      {/* Getting in the ferry line */}
      <Section>
        <FerryLineInfo side={side} />
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
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {visibleFeatures.map((f) => (
            <Link
              key={f.href}
              href={f.href}
              className="group relative overflow-hidden rounded-3xl border border-white/60 bg-white/40 p-5 backdrop-blur-md shadow-[0_4px_24px_rgba(11,25,44,0.06)] transition-all duration-300 hover:-translate-y-1 hover:bg-white/60 hover:shadow-[0_8px_32px_rgba(11,25,44,0.12)]"
            >
              {/* Purely decorative hover glow — carries no information, so it
                  is the kind of thing simple mode drops (E14 .simple-hide). */}
              <div className="simple-hide absolute inset-0 -z-10 bg-gradient-to-br from-white/40 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              {/* E14: decorative — the card title already names the
                  destination, so the glyph must not double-read into the
                  link's accessible name. */}
              <span aria-hidden="true" className="text-3xl drop-shadow-sm">
                {f.icon}
              </span>
              <p className="font-display mt-3 text-lg font-semibold text-sound-deep group-hover:text-tide-deep">
                {f.title}
              </p>
              <p className="mt-1 text-sm text-ink">{f.blurb}</p>
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
            {/* Defaults and their descriptions live in photo-slots.ts now, so
                "Reset to default" in the admin editor is truthful — the same
                reason the copy registry owns the text fallbacks. */}
            {(["home.strip.1", "home.strip.2", "home.strip.3"] as const).map((key) => {
              const p = photo(key);
              return (
                <div
                  key={key}
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
              );
            })}
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
