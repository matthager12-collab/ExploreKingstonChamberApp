// E12 public event-suggestion page (M-05-03): flag-gated like every unified-
// calendar surface — dark (404) until E15 flips the flag, except for a
// signed-in admin previewing. Dynamic (session read), never ISR: the
// admin-preview branch must not land in a shared cache.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getUnifiedCalendarAccess } from "@/lib/stores/unified-calendar-store";
import { PageHeader, Section } from "@/components/ui";
import { SuggestEventForm } from "./suggest-form";

export const metadata: Metadata = {
  title: "Suggest an event",
  description:
    "Suggest an event for the Kingston, WA community calendar — reviewed by the Kingston Chamber before publishing.",
};

export const dynamic = "force-dynamic";

export default async function SuggestEventPage() {
  const access = await getUnifiedCalendarAccess();
  if (!access.enabled && !access.adminPreview) notFound();

  return (
    <>
      <PageHeader
        eyebrow="Kingston events"
        title="Suggest an event"
        intro="Know something happening in Kingston that belongs on the calendar? Tell us about it — the Chamber reviews every suggestion before it goes live."
      />
      <Section>
        {access.adminPreview && (
          // text-ink, not text-ink-soft: ink-soft is 4.62:1 on white but only
          // 4.20:1 once a sand tint lifts the background toward it (E15
          // follow-up — the palette-wide contrast guard now catches this).
          <p className="mb-4 rounded-lg border border-sand-deep bg-sand/40 px-3 py-2 text-xs font-medium text-ink">
            Admin preview — the unified calendar flag is off, so visitors can&apos;t
            see this page yet.
          </p>
        )}
        <SuggestEventForm />
      </Section>
    </>
  );
}
