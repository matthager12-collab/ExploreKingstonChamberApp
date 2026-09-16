// Chamber-wide events workbench. Page access is admin-gated by the /admin
// layout; /api/admin/content-records re-checks the admin role server-side.
//
// Scope note: this edits the IN-APP events store. Events mirrored from the
// GrowthZone and Port calendars are upstream records — correcting one there
// means correcting it at the source, which is what /admin/events-sources is
// for. The two screens are deliberately separate: this one is "our events",
// that one is "everyone else's feeds".

import type { Metadata } from "next";
import { getEventsAdmin } from "@/lib/stores/event-store";
import { getMediaItems } from "@/lib/stores/media-store";
import type { GenericRecord } from "@/lib/schemas/form";
import { PageHeader, Section } from "@/components/ui";
import { EventsEditor } from "./editor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Events Workbench",
  description: "Edit every event on the Kingston calendar, including repeating series.",
};

export default async function AdminEventsPage() {
  // Admin read (E08): pending member submissions included, status surfaced —
  // reviewers must be able to see work before it goes public.
  const [events, photoLibrary] = await Promise.all([getEventsAdmin(), getMediaItems()]);

  return (
    <>
      <PageHeader
        eyebrow="Chamber admin"
        title="Events Workbench"
        intro="Every event on the town calendar, whoever created it. Editing one publishes straight away; the public page picks it up within a minute."
      />
      <Section
        title="Events"
        subtitle="Pick an event to edit, or add a new one. Set “Repeats” for anything that happens on a schedule — a weekly market, a monthly meeting, a summer concert series — and the calendar expands it for you, minus any dates you skip."
      >
        <EventsEditor
          initial={events as unknown as GenericRecord[]}
          photoLibrary={photoLibrary}
        />
      </Section>
    </>
  );
}
