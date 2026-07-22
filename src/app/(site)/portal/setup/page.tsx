import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasAnyUsers } from "@/lib/auth";
import { Callout, PageHeader, Section } from "@/components/ui";
import { SetupForm } from "../forms";

export const metadata: Metadata = { title: "First-run setup" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await hasAnyUsers()) redirect("/portal");
  return (
    <>
      <PageHeader
        eyebrow="One-time setup"
        title="Create the Chamber admin account"
        intro="This first account gets admin rights: it invites every business and nonprofit, and manages the whole site. This page disappears once it's created."
      />
      <Section>
        <SetupForm />
        <div className="mt-6 max-w-lg">
          <Callout title="Who should own this?">
            Someone at the Chamber — the admin account controls invites,
            listings, events, and visitor analytics.
          </Callout>
        </div>
      </Section>
    </>
  );
}
