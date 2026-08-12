import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { can, getSessionUser } from "@/lib/auth";
import { getCharity, getVolunteerNeedsForCharity } from "@/lib/stores/charity-store";
import { getEventsForOwner } from "@/lib/stores/event-store";
import { todayPacific } from "@/lib/time";
import { PortalPage } from "@/components/portal/page";
import { NonprofitEditor } from "./editor";

export const metadata: Metadata = { title: "Manage organization" };
export const dynamic = "force-dynamic";

export default async function ManageOrgPage({
  params,
}: PageProps<"/portal/nonprofit/[id]">) {
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
    <PortalPage
      title={org.name}
      intro={intro}
      width="wide"
      actions={
        <Link
          href="/portal/nonprofit"
          className="text-sm font-semibold text-secondary underline underline-offset-2 hover:text-secondary-deep"
        >
          ← All organizations
        </Link>
      }
    >
      <NonprofitEditor
        org={org}
        initialNeeds={needs}
        initialEvents={events}
        today={todayPacific()}
      />
    </PortalPage>
  );
}
