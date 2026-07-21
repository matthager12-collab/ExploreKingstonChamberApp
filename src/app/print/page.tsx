import type { Metadata } from "next";

import { PrintButton } from "@/components/print-button";
import { PageHeader, Section } from "@/components/ui";
import { getFerryStatusSnapshot } from "@/lib/ferry-status";
import { assertPageVisible, HiddenPageBanner } from "@/lib/page-visibility";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";
import { formatPacificDate, formatPacificTime } from "@/lib/time";
import type { Sailing } from "@/lib/types";

// E14 — the printable one-pager (M-18-07 / FR-47).
//
// The guaranteed non-app fallback: today's boats and a set of numbers that
// reach a human, on a sheet of paper that keeps working when the phone is dead,
// the signal is gone, or the reader never downloaded an app in the first place.
// Server-rendered from getFerryStatusSnapshot() so it prints identically with
// JavaScript off; the only client code is the print button.
//
// The site chrome is print:hidden (site-nav.tsx / site-footer.tsx), so what
// comes out of the printer is this page and nothing else.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Kingston at a glance",
  description:
    "A printable one-page summary of Kingston, Washington: today's ferry departures, the phone numbers that reach a person, and parking and restroom basics.",
};

/**
 * The phone numbers on the paper. Each is published by the agency itself:
 *   - Chamber: from the copy registry (contact.phone.number), so the office can
 *     change its own number without a deploy. See docs/OPERATIONS.md §9 item 7.
 *   - Washington State Ferries automated information line: 511 (within
 *     Washington) and 1-888-808-7977, published on WSF's own contact page,
 *     https://apps.wsdot.wa.gov/travel/washington-state-ferries/contact-us
 *   - Kitsap Transit customer service (the Kingston–Seattle fast ferry and the
 *     local buses): 1-800-501-7433 (1-800-501-RIDE), published at
 *     https://www.kitsaptransit.com/learn/contact
 * Every entry renders as visible text AND as a tel: link — the number has to be
 * readable, copyable, and writable-down, not only tappable.
 */
const AGENCY_PHONES = [
  {
    who: "Washington State Ferries — automated ferry information",
    number: "511",
    note: "Free from a Washington phone.",
  },
  {
    who: "Washington State Ferries — from outside Washington",
    number: "888-808-7977",
    note: "Same information, toll free.",
  },
  {
    who: "Kitsap Transit — customer service",
    number: "800-501-7433",
    note: "Buses and the Kingston–Seattle fast ferry.",
  },
];

/** `tel:` href. Short codes like 511 stay as-is; 10-digit numbers get +1. */
function telHref(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `tel:+1${digits}` : `tel:${digits}`;
}

function times(sailings: Sailing[], direction: Sailing["direction"]): string[] {
  return sailings
    .filter((s) => s.direction === direction)
    .sort((a, b) => a.departs.localeCompare(b.departs))
    .map((s) => formatPacificTime(s.departs));
}

// An <h4>, not an <h3>: the two ferry-TYPE headings on this page are <h3>, and
// each owns two direction headings. As siblings they produced two identically
// named "Leaving Kingston" headings at the same level, which a screen-reader
// heading list renders as an ambiguous flat run. Nested one level down, each
// direction reads under the boat it belongs to.
function Departures({ label, list }: { label: string; list: string[] }) {
  return (
    <div className="mt-4">
      <h4 className="text-base font-semibold text-sound-deep">{label}</h4>
      {list.length > 0 ? (
        // A list, not a middle-dot-joined paragraph: a run of times separated by
        // "·" is announced as one undifferentiated sentence. As <li>s they are
        // counted and steppable, and they still print as a compact row.
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-base leading-relaxed text-ink">
          {list.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-base text-ink">No departures today.</p>
      )}
    </div>
  );
}

export default async function PrintPage() {
  const hiddenPreview = await assertPageVisible("/print");
  const [ferry, copy] = await Promise.all([getFerryStatusSnapshot(), getCopyOverrides()]);

  // "As of" is the moment this HTML was GENERATED — not the moment it was read.
  // revalidate = 60 marks the page stale after a minute, but stale-while-
  // revalidate means a low-traffic page keeps serving the last render until
  // someone asks for it again, which can be far longer than a minute. That is
  // exactly why the stamp is here: it makes the age of the numbers visible to
  // the reader instead of implied. Any page that publishes departure times owes
  // the reader the same stamp — /simple and /es carry it for this reason.
  const renderedAt = new Date().toISOString();
  const chamberPhone = copyText(copy, "contact.phone.number");

  return (
    <>
      {hiddenPreview && <HiddenPageBanner />}
      <PageHeader
        title={copyText(copy, "print.header.title")}
        intro={copyText(copy, "print.header.intro")}
      />

      <Section>
        <PrintButton />
      </Section>

      <Section title="Today's boats">
        <p className="text-base text-ink">
          As of {formatPacificTime(renderedAt)} on {formatPacificDate(renderedAt)}.
        </p>
        {!ferry.carFerry.live && (
          <p className="mt-2 text-base font-semibold text-ink">
            {copyText(copy, "ferry.schedule.notLive")}
          </p>
        )}

        <h3 className="mt-6 font-display text-xl font-semibold text-sound-deep">
          Car ferry — Edmonds and Kingston
        </h3>
        <Departures label="Leaving Kingston" list={times(ferry.carFerry.sailings, "from-kingston")} />
        <Departures label="Leaving Edmonds" list={times(ferry.carFerry.sailings, "to-kingston")} />

        <h3 className="mt-6 font-display text-xl font-semibold text-sound-deep">
          Fast ferry — Kingston and Seattle (people only, no cars)
        </h3>
        {/* The fast ferry has no live feed at all — it always comes from the
            bundled Kitsap Transit timetable, so the caveat always applies. */}
        {!ferry.fastFerry.live && (
          <p className="mt-1 text-base text-ink">{copyText(copy, "ferry.schedule.notLive")}</p>
        )}
        <Departures
          label="Leaving Kingston"
          list={times(ferry.fastFerry.sailings, "from-kingston")}
        />
        <Departures label="Leaving Seattle" list={times(ferry.fastFerry.sailings, "to-kingston")} />
      </Section>

      <Section title="Numbers that reach a person">
        <ul className="space-y-3">
          <li>
            <p className="text-base font-semibold text-ink">
              {copyText(copy, "contact.phone.label")}
            </p>
            {/* The visible text stays the bare number (it has to be readable
                and copyable on paper); the accessible name adds whose number it
                is, so a screen reader's links list is not a column of anonymous
                digits — WCAG 2.4.4. */}
            <p className="text-lg text-ink">
              <a
                href={telHref(chamberPhone)}
                aria-label={`${copyText(copy, "contact.phone.label")}, ${chamberPhone}`}
                className="font-bold underline underline-offset-2"
              >
                {chamberPhone}
              </a>
            </p>
          </li>
          {AGENCY_PHONES.map((p) => (
            <li key={p.number}>
              <p className="text-base font-semibold text-ink">{p.who}</p>
              <p className="text-lg text-ink">
                <a
                  href={telHref(p.number)}
                  aria-label={`${p.who}, ${p.number}`}
                  className="font-bold underline underline-offset-2"
                >
                  {p.number}
                </a>{" "}
                <span className="text-base">— {p.note}</span>
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Restrooms and parking">
        <p className="text-base leading-relaxed text-ink">{copyText(copy, "print.basics.body")}</p>
      </Section>

      <Section>
        <p className="border-t border-sand pt-4 text-base font-semibold text-ink">
          {copyText(copy, "print.caveat")} Printed {formatPacificDate(renderedAt)}.
        </p>
      </Section>
    </>
  );
}
