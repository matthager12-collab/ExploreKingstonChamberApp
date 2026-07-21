import { Section } from "@/components/ui";
import {
  fillSafetyText,
  SAFETY_SECTION_ORDER,
  type SafetySection,
  type SafetyStrings,
  type SafetyValues,
} from "@/lib/i18n/safety-content";

// E14 — the one renderer for the EN+ES safety slice (FR-92). `vk/safety-strings`.
//
// /simple passes the English half and /es passes the Spanish half, so the two
// pages mirror each other structurally by construction: a section added to the
// dictionary appears on both, in the same order, or on neither.
//
// Server component, no client JS: this is the content a visitor needs when the
// network is bad and the phone is old.
// `values` fills the dictionary's `{token}` placeholders — today just the
// Chamber phone, which lives in the copy registry so the office can change it
// without a deploy. Both pages pass the same registry read, so the number on
// /simple and /es can never diverge from the one in Admin → Site content.
export function SafetyEssentials({
  strings,
  values,
}: {
  strings: SafetyStrings;
  values: SafetyValues;
}) {
  return (
    <>
      {SAFETY_SECTION_ORDER.map((key) => (
        <SafetySectionBlock key={key} section={strings[key]} values={values} />
      ))}
    </>
  );
}

function SafetySectionBlock({
  section,
  values,
}: {
  section: SafetySection;
  values: SafetyValues;
}) {
  return (
    <Section title={fillSafetyText(section.title, values)}>
      {/* An ordered list because the order is the instruction — "take a pass,
          THEN wait for green" is the whole point. Numbers are the list's own,
          so they are announced as "1 of 7" rather than read as body text. */}
      <ol className="list-outside list-decimal space-y-3 rounded-2xl border border-sand bg-white py-5 pr-5 pl-9 text-lg text-ink">
        {section.steps.map((step) => (
          <li key={step}>{fillSafetyText(step, values)}</li>
        ))}
      </ol>
      {section.note && (
        <p className="mt-3 text-lg font-semibold text-ink">
          {fillSafetyText(section.note, values)}
        </p>
      )}
    </Section>
  );
}
