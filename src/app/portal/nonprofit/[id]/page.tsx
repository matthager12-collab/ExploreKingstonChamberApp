import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { can, getSessionUser } from "@/lib/auth";
import { getCharity, getVolunteerNeeds } from "@/lib/stores/charity-store";
import { getEvents } from "@/lib/stores/event-store";
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

  const needs = (await getVolunteerNeeds()).filter((n) => n.charityId === id);
  const events = (await getEvents()).filter((e) => e.charityId === id || e.ownerId === id);

  return (
    <>
      <PageHeader
        eyebrow="Nonprofit portal"
        title={org.name}
        intro="Your profile, volunteer shifts, and events — changes go live on the site the moment you save."
      />
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
