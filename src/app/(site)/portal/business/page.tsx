// Business portal home: every listing this account manages, one card each.
// Admins see all listings. Requires a session; bounces to /portal otherwise.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getRestaurants } from "@/lib/stores/business-store";
import { OpenBadge } from "@/components/open-badge";
import { Badge, Callout, Card, PageHeader, Section } from "@/components/ui";

export const metadata: Metadata = { title: "My Business" };
export const dynamic = "force-dynamic";

export default async function BusinessPortalPage() {
  const user = await getSessionUser();
  if (!user) redirect("/portal");
  if (user.role !== "member-business" && user.role !== "admin") redirect("/portal");

  const all = await getRestaurants();
  const listings =
    user.role === "admin" ? all : all.filter((r) => user.editableIds.includes(r.id));

  return (
    <>
      <PageHeader
        eyebrow={user.role === "admin" ? "Chamber admin · all listings" : "Business portal"}
        title="My business"
        intro="Update once, and it's everywhere — your hours, menus, and events flow straight to the public pages, the open-now badge, and the town calendar."
      />
      <Section>
        {listings.length === 0 ? (
          <Callout title="No listings linked to this account yet" tone="coral">
            Your account isn&apos;t connected to a listing. Email the Chamber and
            they&apos;ll link your business in a minute.
          </Callout>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {listings.map((r) => (
              <Link key={r.id} href={`/portal/business/${r.id}`}>
                <Card className="h-full transition hover:border-tide">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display text-lg font-semibold text-sound-deep">
                      {r.name}
                    </p>
                    <OpenBadge weeklyHours={r.weeklyHours} />
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">
                    {r.cuisine} · {"$".repeat(r.priceLevel)}
                  </p>
                  <p className="mt-2 text-sm text-ink">{r.hours ?? "No hours listed yet"}</p>
                  <div className="mt-3">
                    {r.hoursVerified ? (
                      <Badge tone="green">Hours verified {r.hoursVerified}</Badge>
                    ) : (
                      <Badge tone="coral">Hours not verified yet</Badge>
                    )}
                  </div>
                  <p className="mt-3 text-sm font-medium text-tide-deep">
                    Edit listing, hours &amp; events →
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
