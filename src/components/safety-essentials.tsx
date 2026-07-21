import { Section } from "@/components/ui";
import {
  SAFETY_SECTION_ORDER,
  type SafetySection,
  type SafetyStrings,
} from "@/lib/i18n/safety-content";

// E14 — the one renderer for the EN+ES safety slice (FR-92). `vk/safety-strings`.
//
// /simple passes the English half and /es passes the Spanish half, so the two
// pages mirror each other structurally by construction: a section added to the
// dictionary appears on both, in the same order, or on neither.
//
// Server component, no client JS: this is the content a visitor needs when the
// network is bad and the phone is old.
export function SafetyEssentials({ strings }: { strings: SafetyStrings }) {
  return (
    <>
      {SAFETY_SECTION_ORDER.map((key) => (
        <SafetySectionBlock key={key} section={strings[key]} />
      ))}
    </>
  );
}

function SafetySectionBlock({ section }: { section: SafetySection }) {
  return (
    <Section title={section.title}>
      {/* An ordered list because the order is the instruction — "take a pass,
          THEN wait for green" is the whole point. Numbers are the list's own,
          so they are announced as "1 of 7" rather than read as body text. */}
      <ol className="list-outside list-decimal space-y-3 rounded-2xl border border-sand bg-white py-5 pr-5 pl-9 text-lg text-ink">
        {section.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {section.note && (
        <p className="mt-3 text-lg font-semibold text-ink">{section.note}</p>
      )}
    </Section>
  );
}
