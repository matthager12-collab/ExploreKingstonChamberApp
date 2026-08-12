import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getCharities } from "@/lib/stores/charity-store";
import { Callout } from "@/components/ui";
import { PortalPage } from "@/components/portal/page";

export const metadata: Metadata = { title: "Nonprofit portal" };
export const dynamic = "force-dynamic";

export default async function NonprofitPortalPage() {
  const user = await getSessionUser();
  if (!user) redirect("/portal");
  if (user.role !== "org-editor" && user.role !== "admin") redirect("/portal");

  const all = await getCharities();
  const orgs =
    user.role === "admin" ? all : all.filter((c) => user.editableIds.includes(c.id));

  // No "back to the portal" link any more — the rail is always on screen, so
  // it would be a second copy of a control already visible. Same reason the
  // Overview stopped being a grid of link cards.
  return (
    <PortalPage
      title="My organization"
      intro="Keep your profile current, post volunteer shifts, and schedule events without double-booking the town."
      width="wide"
    >
      {orgs.length === 0 ? (
        <Callout title="No organizations linked to your account" tone="coral">
          Your account isn&apos;t linked to any organization yet. Contact the Chamber and
          they&apos;ll connect you to your listing.
        </Callout>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {orgs.map((org) => (
            <li key={org.id}>
              <Link
                href={`/portal/nonprofit/${org.id}`}
                className="flex h-full flex-col rounded-2xl border border-border bg-white p-5 transition-colors hover:border-border-strong"
              >
                <p className="font-display text-lg font-semibold text-primary-deep">
                  {org.name}
                </p>
                <p className="mt-1 line-clamp-3 text-sm text-ink-soft">{org.mission}</p>
                <p className="mt-3 text-sm font-semibold text-secondary">
                  Manage profile, shifts &amp; events →
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PortalPage>
  );
}
