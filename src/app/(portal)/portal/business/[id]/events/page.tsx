import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEventsForOwner } from "@/lib/stores/event-store";
import { EventsForm } from "../events-form";
import { requireBusinessRecord } from "../record";

// Events is a restaurant-only tab — same 404 reasoning as Hours.
//
// The owner-scoped read (E08) stays here rather than in the layout: it is the
// only pane that needs it, and loading every owner's events on the Listing and
// Hours tabs would be work nobody asked for.

export const metadata: Metadata = { title: "Events" };
export const dynamic = "force-dynamic";

export default async function BusinessEventsPage({
  params,
}: PageProps<"/portal/business/[id]/events">) {
  const { id } = await params;
  const { record } = await requireBusinessRecord(id);
  if (record.kind !== "restaurant") notFound();

  // Includes this listing's pending event submissions with status surfaced.
  const events = await getEventsForOwner(id);

  return <EventsForm initial={record.restaurant} initialEvents={events} />;
}
