import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { can, getSessionUser } from "@/lib/auth";
import { getCharity, getVolunteerNeedsForCharity } from "@/lib/stores/charity-store";
import { getEventsForOwner } from "@/lib/stores/event-store";
import { todayPacific } from "@/lib/time";
import { PageHeader } from "@/components/ui";
import { NonprofitEditor } from "./editor";

export const metadata: Metadata = { title: "Manage organization" };
export const dynamic = "force-dynamic";

export default async function ManageOrgPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getSessionUser();
  if (!user || !can(user, "edit-record", id)) redirect("/portal");

  const org = await getCharity(id);
  if (!org) notFound();

  // Owner-scoped reads (E08): include this org's pending submissions with
  // status surfaced, so the editor can badge "awaiting review".
  const needs = await getVolunteerNeedsForCharity(id);
  const events = await getEventsForOwner(id);

  const intro =
    user.role === "admin"
      ? "Your profile, volunteer shifts, and events — changes go live on the site the moment you save."
      : "Your profile, volunteer shifts, and events — changes are submitted for a quick Chamber review and go live once approved.";

  return (
    <>
      <PageHeader eyebrow="Nonprofit portal" title={org.name} intro={intro} />
      <p className="mx-auto -mt-2 max-w-5xl px-4 text-sm">
        <Link
          href="/portal/nonprofit"
          className="font-medium text-ink-soft underline underline-offset-2 hover:text-ink"
        >
          ← All organizations
        </Link>
      </p>
      <NonprofitEditor org={org} initialNeeds={needs} initialEvents={events} today={todayPacific()} />
    </>
  );
}
