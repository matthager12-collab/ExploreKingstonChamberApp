// Listing editor page (server side): await params, enforce can(…, "edit-record") against
// the session, load the restaurant plus the events it owns, hand everything
// to the client editor.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { can, getSessionUser } from "@/lib/auth";
import { getRestaurant } from "@/lib/stores/business-store";
import { getEventsForOwner } from "@/lib/stores/event-store";
import { PageHeader } from "@/components/ui";
import { BusinessEditor } from "./editor";

export const metadata: Metadata = { title: "Edit listing" };
export const dynamic = "force-dynamic";

export default async function EditListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getSessionUser();
  if (!user) redirect("/portal");
  if (!can(user, "edit-record", id)) redirect("/portal");

  const restaurant = await getRestaurant(id);
  if (!restaurant) redirect("/portal/business");

  // Owner-scoped read (E08): includes this listing's pending event
  // submissions with status surfaced, so the editor can badge them.
  const events = await getEventsForOwner(id);

  const intro =
    user.role === "admin"
      ? "Everything below goes live the moment you save — the food pages, the open-now badge, the town calendar, and your syndication feed."
      : "Edits below are submitted for a quick Chamber review — they go live once approved, usually within a couple of days.";

  return (
    <>
      <PageHeader eyebrow="Business portal" title={restaurant.name} intro={intro} />
      <div className="mx-auto max-w-5xl px-4">
        <Link
          href="/portal/business"
          className="text-sm font-medium text-tide-deep underline underline-offset-2 hover:text-sound"
        >
          ← All my listings
        </Link>
      </div>
      <BusinessEditor initial={restaurant} initialEvents={events} />
    </>
  );
}
