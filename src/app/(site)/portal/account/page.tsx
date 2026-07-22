// /portal/account — the signed-in user's own account, any role.
//
// Server half: shows who you are (name, email, role, what you manage, member
// since) and hands the editable parts to the client settings component.
// Linked ids are resolved to display names here so the client never needs the
// full listing stores.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ROLE_LABELS, ROLE_TONES } from "@/lib/auth/roles";
import { getRestaurants } from "@/lib/stores/business-store";
import { getCharities } from "@/lib/stores/charity-store";
import { Badge, Card, PageHeader, Section } from "@/components/ui";
import { AccountSettings } from "./settings";

export const metadata: Metadata = { title: "My account" };
export const dynamic = "force-dynamic";


export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) redirect("/portal");

  const [restaurants, charities] = await Promise.all([getRestaurants(), getCharities()]);
  const nameById = new Map<string, string>();
  for (const r of restaurants) nameById.set(r.id, r.name);
  for (const c of charities) nameById.set(c.id, c.name);
  const linkedNames = user.editableIds.map((id: string) => nameById.get(id) ?? id);

  const createdLabel = user.createdAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <>
      <PageHeader
        eyebrow="Portal"
        title="My account"
        intro="Your profile, what you manage, and your sign-in details."
      />

      <Section title="Profile">
        <Card>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-ink">Name</dt>
              <dd className="mt-0.5 text-ink-soft">{user.name}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Email</dt>
              <dd className="mt-0.5 text-ink-soft">{user.email}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Role</dt>
              <dd className="mt-1">
                <Badge tone={ROLE_TONES[user.role]}>{ROLE_LABELS[user.role]}</Badge>
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Account created</dt>
              <dd className="mt-0.5 text-ink-soft">{createdLabel}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-semibold text-ink">Manages</dt>
              <dd className="mt-0.5 text-ink-soft">
                {user.role === "admin"
                  ? "Everything (admin)"
                  : linkedNames.length > 0
                    ? linkedNames.join(", ")
                    : "—"}
              </dd>
            </div>
          </dl>
        </Card>
      </Section>

      <AccountSettings name={user.name} email={user.email} />
    </>
  );
}
