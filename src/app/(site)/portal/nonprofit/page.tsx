import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getCharities } from "@/lib/stores/charity-store";
import { Callout, Card, PageHeader, Section } from "@/components/ui";

export const metadata: Metadata = { title: "Nonprofit portal" };
export const dynamic = "force-dynamic";

export default async function NonprofitPortalPage() {
  const user = await getSessionUser();
  if (!user) redirect("/portal");
  if (user.role !== "org-editor" && user.role !== "admin") redirect("/portal");

  const all = await getCharities();
  const orgs =
    user.role === "admin" ? all : all.filter((c) => user.editableIds.includes(c.id));

  return (
    <>
      <PageHeader
        eyebrow="Nonprofit portal"
        title="My organization"
        intro="Keep your profile current, post volunteer shifts, and schedule events without double-booking the town."
      />
      <Section>
        {orgs.length === 0 ? (
          <Callout title="No organizations linked to your account" tone="coral">
            Your account isn&apos;t linked to any organization yet. Contact the Chamber and
            they&apos;ll connect you to your listing.
          </Callout>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {orgs.map((org) => (
              <Link key={org.id} href={`/portal/nonprofit/${org.id}`}>
                <Card className="h-full transition hover:border-tide">
                  <p className="font-display text-lg font-semibold text-sound-deep">{org.name}</p>
                  <p className="mt-1 line-clamp-3 text-sm text-ink-soft">{org.mission}</p>
                  <p className="mt-3 text-sm font-medium text-tide-deep">
                    Manage profile, shifts &amp; events →
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        )}
        <p className="mt-6 text-sm">
          <Link
            href="/portal"
            className="font-medium text-ink-soft underline underline-offset-2 hover:text-ink"
          >
            ← Back to the portal
          </Link>
        </p>
      </Section>
    </>
  );
}
