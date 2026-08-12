// Listing editor page (server side): await params, enforce can(…, "edit-record") against
// the session, load the listing — a restaurant (plus the events it owns) or a
// lodging place — and hand everything to the matching client editor.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { can, getSessionUser } from "@/lib/auth";
import { getRestaurant } from "@/lib/stores/business-store";
import { getLodging } from "@/lib/stores/listing-stores";
import { getDirectoryListingsAdmin } from "@/lib/stores/directory-store";
import { getEventsForOwner } from "@/lib/stores/event-store";
import { PageHeader } from "@/components/ui";
import { BusinessEditor } from "./editor";
import { LodgingEditor } from "./lodging-editor";
import { DirectoryEditor } from "./directory-editor";

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

  const intro =
    user.role === "admin"
      ? "Everything below goes live the moment you save — the food pages, the open-now badge, the town calendar, and your syndication feed."
      : "Edits below are submitted for a quick Chamber review — they go live once approved, usually within a couple of days.";

  const backLink = (
    <div className="mx-auto max-w-5xl px-4">
      <Link
        href="/portal/business"
        className="text-sm font-medium text-tide-deep underline underline-offset-2 hover:text-sound"
      >
        ← All my listings
      </Link>
    </div>
  );

  const restaurant = await getRestaurant(id);
  if (restaurant) {
    // Owner-scoped read (E08): includes this listing's pending event
    // submissions with status surfaced, so the editor can badge them.
    const events = await getEventsForOwner(id);

    return (
      <>
        <PageHeader eyebrow="Business portal" title={restaurant.name} intro={intro} />
        {backLink}
        <BusinessEditor initial={restaurant} initialEvents={events} />
      </>
    );
  }

  const lodging = (await getLodging()).find((l) => l.id === id);
  if (!lodging) {
    // Directory branch — the ADMIN read on purpose: imported listings are
    // drafts, and the owner must be able to load their own draft. Access is
    // already proven (the can() gate above), so surfacing the draft here
    // leaks nothing.
    const dir = (await getDirectoryListingsAdmin()).find((d) => d.id === id);
    if (!dir) redirect("/portal/business");

    const { status, ...record } = dir;
    const isDraft = status !== "live";
    const dirIntro =
      user.role === "admin"
        ? "Edits save immediately; the listing keeps its current publish state."
        : isDraft
          ? "This listing isn't public yet. Fill it in at your own pace — the Chamber reviews and publishes it, and your edits save instantly until then."
          : "Edits below are submitted for a quick Chamber review — they go live once approved, usually within a couple of days.";

    return (
      <>
        <PageHeader eyebrow="Business portal" title={record.name} intro={dirIntro} />
        {backLink}
        <DirectoryEditor initial={record} isDraft={isDraft} />
      </>
    );
  }

  const lodgingIntro =
    user.role === "admin"
      ? "Everything below goes live the moment you save — the stay page and the kiosk both follow."
      : "Edits below are submitted for a quick Chamber review — they go live once approved, usually within a couple of days.";

  return (
    <>
      <PageHeader eyebrow="Business portal" title={lodging.name} intro={lodgingIntro} />
      {backLink}
      <LodgingEditor initial={lodging} />
    </>
  );
}
