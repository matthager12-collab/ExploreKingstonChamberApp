import type { Metadata } from "next";
import Link from "next/link";

import { DocumentLang } from "@/components/document-lang";
import { SafetyEssentials } from "@/components/safety-essentials";
import { PageHeader, Section } from "@/components/ui";
import { walkOnRoundTripFare } from "@/lib/data/ferry-info";
import { getFerryStatusSnapshot } from "@/lib/ferry-status";
import { SAFETY_CONTENT, safetyValues } from "@/lib/i18n/safety-content";
import { assertPageVisible, HiddenPageBanner } from "@/lib/page-visibility";
import { getFerryInfo } from "@/lib/stores/ferry-info-store";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";
import { formatPacificTime } from "@/lib/time";
import type { Sailing } from "@/lib/types";

// E14 — "Kingston en español" (FR-92 / M-14-06 partial). `vk/es-page`.
//
// The Spanish half of the safety slice, mirroring /simple section for section:
// the next boats, the same six safety sections rendered from the same typed
// dictionary, and a phone number that reaches a person.
//
// SHIPS DARK. /es is in DEFAULT_HIDDEN_PAGES (src/lib/page-visibility.tsx), so
// with no site-pages record it 404s for visitors and renders for admins with the
// hidden-page banner. It goes public only when an operator writes an explicit
// `hidden: false` record from Admin → Site content, and only after a bilingual
// human has read the strings — the procedure is in docs/OPERATIONS.md,
// "Accessibility & language". Nothing here is machine translated, and there is
// no translation widget or i18n framework anywhere in the path.
//
// WCAG 3.1.2: every Spanish text node sits inside the lang="es" wrapper below,
// and the one English string on the page (the "In English" cross-link label)
// carries its own lang="en" so a screen reader switches voice for exactly two
// words and back.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Kingston en español",
  description:
    "Lo esencial de Kingston, Washington en español sencillo: los próximos barcos, cómo pagar el estacionamiento, dónde hay baños y a quién llamar.",
};

/** `tel:` href for a printed-style number ("360-860-2239" → "tel:+13608602239"). */
function telHref(phone: string): string {
  return `tel:+1${phone.replace(/\D/g, "")}`;
}

/** The next three departures one way, soonest first. Same rule as /simple. */
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
        // Never an empty block — /simple's rule, in Spanish.
        <p className="mt-3 text-xl text-ink">{emptyText}</p>
      )}
    </div>
  );
}

export default async function SpanishPage() {
  const hiddenPreview = await assertPageVisible("/es");
  const [ferry, ferryInfo, copy] = await Promise.all([
    getFerryStatusSnapshot(),
    getFerryInfo(),
    getCopyOverrides(),
  ]);

  const phone = copyText(copy, "contact.phone.number");
  const noBoats = copyText(copy, "es.boats.none");
  // Same honesty stamp /simple and /print carry — see the comment on
  // src/app/simple/page.tsx. Time only, no date: formatPacificDate() renders an
  // English weekday ("Thu, Jul 2"), which has no business inside lang="es".
  const renderedAt = new Date().toISOString();

  return (
    <>
      {/* Outside the lang="es" wrapper: the banner is English admin chrome. */}
      {hiddenPreview && <HiddenPageBanner />}

      {/* WCAG 3.1.1 (Language of Page, Level A): the PAGE's language is Spanish,
          and the root <html lang> is set by the root layout, which a nested
          route cannot re-emit in the App Router. The wrapper below fixes the
          content; this sets the document itself, so the Spanish <title> and
          <meta description> are not announced in an English voice. */}
      <DocumentLang lang="es" />

      <div lang="es">
        <PageHeader
          eyebrow={copyText(copy, "es.header.eyebrow")}
          title={copyText(copy, "es.header.title")}
          intro={copyText(copy, "es.header.intro")}
        />

        <Section>
          <p className="text-lg">
            <Link
              href="/simple"
              className="inline-flex min-h-11 items-center rounded-full border-2 border-sound bg-white px-5 py-2 font-semibold text-sound-deep no-underline"
            >
              {/* The label is English, so it says so — WCAG 3.1.2. */}
              <span lang="en">{copyText(copy, "es.link.english")}</span>
            </Link>
          </p>
        </Section>

        <Section title="Los próximos barcos">
          <p className="mb-4 text-lg text-ink">
            Estos horarios eran correctos a las {formatPacificTime(renderedAt)} de hoy.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <BoatColumn
              title="Saliendo de Kingston"
              sailings={nextThree(ferry.carFerry.sailings, "from-kingston")}
              emptyText={noBoats}
            />
            <BoatColumn
              title="Llegando a Kingston"
              sailings={nextThree(ferry.carFerry.sailings, "to-kingston")}
              emptyText={noBoats}
            />
          </div>
          {/* Same live-vs-schedule honesty line /simple carries, in Spanish. */}
          {!ferry.carFerry.live && (
            <p className="mt-4 text-lg text-ink">{copyText(copy, "es.schedule.notLive")}</p>
          )}
        </Section>

        {/* Same dictionary and the same live values /simple fills, resolved
            against the Spanish half — so the fare a Spanish-speaking visitor
            reads is the one the Chamber last saved, and the wording around it
            is still a translator's, not a substituted English phrase. */}
        <SafetyEssentials
          strings={SAFETY_CONTENT.es}
          values={safetyValues("es", {
            phone,
            walkOnRoundTrip: walkOnRoundTripFare(ferryInfo.fares),
          })}
        />

        <Section title="Hablar con una persona">
          <div className="rounded-2xl border border-sand bg-white p-5">
            <p className="text-lg text-ink">{copyText(copy, "es.help.body")}</p>
            <p className="mt-4">
              {/* The accessible name says whose number it is, in Spanish — a
                  links list full of bare digits is not usable (WCAG 2.4.4). */}
              <a
                href={telHref(phone)}
                aria-label={`Llamar a la Cámara de Comercio de Kingston, ${phone}`}
                className="inline-flex min-h-11 items-center rounded-full bg-sound-deep px-6 py-3 text-2xl font-bold text-white no-underline"
              >
                {phone}
              </a>
            </p>
            <p className="mt-2 text-lg text-ink">Greater Kingston Chamber of Commerce</p>
          </div>
        </Section>
      </div>
    </>
  );
}
