import type { Metadata } from "next";
import Link from "next/link";

import { SafetyEssentials } from "@/components/safety-essentials";
import { SimpleModeToggle } from "@/components/simple-mode-toggle";
import { PageHeader, Section } from "@/components/ui";
import { getFerryStatusSnapshot } from "@/lib/ferry-status";
import { SAFETY_CONTENT } from "@/lib/i18n/safety-content";
import {
  assertPageVisible,
  getEffectiveHiddenPaths,
  HiddenPageBanner,
} from "@/lib/page-visibility";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";
import { formatPacificTime } from "@/lib/time";
import type { Sailing } from "@/lib/types";

// E14 — "Kingston basics" (M-14-03 / NFR-95 / NFR-04).
//
// The cognitive-simplicity page: one primary thing per section, grade-6
// language, huge type, every target >= 44px. It is deliberately the SIMPLEST
// page in the app — no map, no live polling, no client data fetch.
//
// It reads no cookies of its own: no getSide(), no next/headers. The one
// cookie-adjacent call is assertPageVisible(), which only reaches the session
// while the page is HIDDEN (see the note in src/lib/page-visibility.tsx) — the
// visible path returns before touching auth, so this page stays static-friendly
// for E13 precaching. Simple mode itself is localStorage + data-simple, never a
// cookie, for exactly the same reason.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Kingston basics",
  description:
    "The short version of Kingston, Washington in big, plain type: the next boats, places to eat, what is on, and a phone number that reaches a person.",
};

/** The three destinations worth one big tap each. */
const BIG_LINKS = [
  { href: "/eat", title: "Places to eat", blurb: "Every restaurant and cafe in town." },
  { href: "/events", title: "What is on", blurb: "Things happening in Kingston soon." },
  { href: "/print", title: "A page you can print", blurb: "Today's boats and the phone numbers, on paper." },
];

/** `tel:` href for a printed-style number ("360-860-2239" → "tel:+13608602239"). */
function telHref(phone: string): string {
  return `tel:+1${phone.replace(/\D/g, "")}`;
}

/** The next three departures one way, soonest first. */
function nextThree(sailings: Sailing[], direction: Sailing["direction"]): Sailing[] {
  const now = Date.now();
  return sailings
    .filter((s) => s.direction === direction && new Date(s.departs).getTime() > now)
    .sort((a, b) => a.departs.localeCompare(b.departs))
    .slice(0, 3);
}

function BoatColumn({
  title,
  sailings,
  emptyText,
}: {
  title: string;
  sailings: Sailing[];
  emptyText: string;
}) {
  return (
    <div className="rounded-2xl border border-sand bg-white p-5">
      <h3 className="font-display text-xl font-semibold text-sound-deep sm:text-2xl">{title}</h3>
      {sailings.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {sailings.map((s) => (
            <li key={s.departs} className="text-3xl font-bold text-ink sm:text-4xl">
              {formatPacificTime(s.departs)}
            </li>
          ))}
        </ul>
      ) : (
        // Never an empty block: after the last sailing of the day there are
        // legitimately no times, and the page has to say so in words.
        <p className="mt-3 text-xl text-ink">{emptyText}</p>
      )}
    </div>
  );
}

export default async function SimplePage() {
  const hiddenPreview = await assertPageVisible("/simple");
  const [ferry, copy, hiddenPaths] = await Promise.all([
    getFerryStatusSnapshot(),
    getCopyOverrides(),
    getEffectiveHiddenPaths(),
  ]);

  const phone = copyText(copy, "contact.phone.number");
  const noBoats = copyText(copy, "simple.boats.none");
  const links = BIG_LINKS.filter((l) => !hiddenPaths.includes(l.href));

  return (
    <>
      {hiddenPreview && <HiddenPageBanner />}
      <PageHeader
        eyebrow={copyText(copy, "simple.header.eyebrow")}
        title={copyText(copy, "simple.header.title")}
        intro={copyText(copy, "simple.header.intro")}
      />

      <Section>
        <SimpleModeToggle className="border border-sand bg-white" />
      </Section>

      {/* E14 (FR-92 / WCAG 3.1.2): the cross-link to the Spanish page. It is
          filtered by the SAME effective-hidden computation as every other link
          here, so while /es ships dark a visitor never sees a link to a 404.
          The label is Spanish, so it carries lang="es" — two words, and the
          screen reader switches voice for exactly those two. */}
      {!hiddenPaths.includes("/es") && (
        <Section>
          <p className="text-lg">
            <Link
              href="/es"
              className="inline-flex min-h-11 items-center rounded-full border-2 border-sound bg-white px-5 py-2 font-semibold text-sound-deep no-underline"
            >
              <span lang="es">{copyText(copy, "simple.link.spanish")}</span>
            </Link>
          </p>
        </Section>
      )}

      <Section title="The next boats">
        <div className="grid gap-4 sm:grid-cols-2">
          <BoatColumn
            title="Leaving Kingston"
            sailings={nextThree(ferry.carFerry.sailings, "from-kingston")}
            emptyText={noBoats}
          />
          <BoatColumn
            title="Coming to Kingston"
            sailings={nextThree(ferry.carFerry.sailings, "to-kingston")}
            emptyText={noBoats}
          />
        </div>
        {/* Same live-vs-schedule honesty pattern as next-ferries.tsx: say so
            when the times came from the bundled schedule, not the live feed. */}
        {!ferry.carFerry.live && (
          <p className="mt-4 text-lg text-ink">{copyText(copy, "ferry.schedule.notLive")}</p>
        )}
      </Section>

      <Section title="Where to go next">
        <ul className="grid gap-4 sm:grid-cols-3">
          {links.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="flex min-h-11 flex-col justify-center rounded-2xl border-2 border-sound bg-white px-5 py-5 no-underline"
              >
                <span className="font-display text-2xl font-semibold text-sound-deep">
                  {l.title}
                </span>
                <span className="mt-1 text-lg text-ink">{l.blurb}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      {/* E14 (FR-92): the English half of the safety slice. /es renders the
          Spanish half of this exact dictionary through the same component, so
          the two pages cannot drift apart in structure or coverage. */}
      <SafetyEssentials strings={SAFETY_CONTENT.en} />

      <Section title="Talk to a person">
        <div className="rounded-2xl border border-sand bg-white p-5">
          <p className="text-lg text-ink">{copyText(copy, "simple.help.body")}</p>
          <p className="mt-4">
            <a
              href={telHref(phone)}
              className="inline-flex min-h-11 items-center rounded-full bg-sound-deep px-6 py-3 text-2xl font-bold text-white no-underline"
            >
              {phone}
            </a>
          </p>
          <p className="mt-2 text-lg text-ink">{copyText(copy, "contact.phone.label")}</p>
        </div>
      </Section>
    </>
  );
}
