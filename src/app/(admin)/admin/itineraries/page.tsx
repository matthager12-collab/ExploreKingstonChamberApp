// Chamber-facing itinerary admin: the itinerary builder (editor.tsx).
// Page access is admin-gated by the /admin layout; the API it saves through
// (/api/admin/content-records) re-checks the admin role server-side.

import type { Metadata } from "next";
import { getItinerariesAdmin } from "@/lib/stores/itinerary-store";
import { itineraries as seedItineraries } from "@/lib/data/itineraries";
import { PageHeader, Section } from "@/components/ui";
import { ItineraryEditor } from "./editor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Itinerary Builder",
  description: "Create and edit the ready-made Kingston day plans on /itineraries.",
};

export default async function AdminItinerariesPage() {
  const itineraries = await getItinerariesAdmin();
  const seedIds = seedItineraries.map((i) => i.id);

  return (
    <>
      <PageHeader
        eyebrow="Chamber admin"
        title="Itinerary Builder"
        intro="Create and edit the ready-made day plans visitors see at /itineraries. Seed itineraries ship with the app; editing one saves a custom copy that overrides it."
      />
      <Section
        title="Builder"
        subtitle="Pick an itinerary to edit — or start a new one. Each stop gets a time, a title, a description, and an optional map query for the Map link."
      >
        <ItineraryEditor initialItineraries={itineraries} seedIds={seedIds} />
      </Section>
    </>
  );
}
