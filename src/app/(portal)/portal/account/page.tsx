// /portal/account — the signed-in user's own account, any role.
//
// Server half: shows who you are (name, email, role, what you manage, member
// since) and hands the editable parts to the client settings component.
// Linked ids are resolved to display names here so the client never needs the
// full listing stores.
//
// Archetype D7 (form page). The data logic below is unchanged from the
// pre-shell version — same session gate, same three stores, same id→name
// resolution. Only the presentation moved onto the portal primitives.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ROLE_LABELS, ROLE_TONES } from "@/lib/auth/roles";
import { getRestaurants } from "@/lib/stores/business-store";
import { getCharities } from "@/lib/stores/charity-store";
import { getLodging } from "@/lib/stores/listing-stores";
import { Badge } from "@/components/ui";
import { FieldList, PortalPage, PortalPanel } from "@/components/portal/page";
import { AccountSettings } from "./settings";

export const metadata: Metadata = { title: "My account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) redirect("/portal");

  const [restaurants, charities, lodging] = await Promise.all([
    getRestaurants(),
    getCharities(),
    getLodging(),
  ]);
  const nameById = new Map<string, string>();
  for (const r of restaurants) nameById.set(r.id, r.name);
  for (const c of charities) nameById.set(c.id, c.name);
  for (const l of lodging) nameById.set(l.id, l.name);
  const linkedNames = user.editableIds.map((id: string) => nameById.get(id) ?? id);

  const createdLabel = user.createdAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <PortalPage
      title="My account"
      intro="Your profile, what you manage, and your sign-in details."
    >
      <PortalPanel title="Profile">
        <FieldList
          fields={[
            { label: "Name", value: user.name },
            { label: "Email", value: user.email },
            {
              label: "Role",
              value: <Badge tone={ROLE_TONES[user.role]}>{ROLE_LABELS[user.role]}</Badge>,
            },
            { label: "Account created", value: createdLabel },
            {
              label: "Manages",
              value:
                user.role === "admin"
                  ? "Everything (admin)"
                  : linkedNames.length > 0
                    ? linkedNames.join(", ")
                    : "—",
            },
          ]}
        />
      </PortalPanel>

      <AccountSettings name={user.name} email={user.email} />
    </PortalPage>
  );
}
