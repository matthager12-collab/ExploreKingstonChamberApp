import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser, hasAnyUsers } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { redirect } from "next/navigation";
import { getCopyOverrides } from "@/lib/stores/site-store";
import { getRestaurants } from "@/lib/stores/business-store";
import { getCharities } from "@/lib/stores/charity-store";
import { getLodging } from "@/lib/stores/listing-stores";
import { Callout, PageHeader, Section } from "@/components/ui";
import { PortalInviteHint } from "@/components/get-listed";
import { LoginForm, LogoutButton } from "@/components/portal/auth-forms";
import { FieldList, PortalPage, PortalPanel } from "@/components/portal/page";

export const metadata: Metadata = { title: "Portal" };
export const dynamic = "force-dynamic";

/* The portal's front door.
 *
 * WAS a grid of link cards — one per portal area, plus one per admin surface.
 * That made sense when there was no navigation. With the rail on screen, every
 * card was a second copy of a link already visible two inches to the left, and
 * the first thing you met after signing in was a menu repeating the menu.
 *
 * Now it answers "what do I manage", which the rail cannot: the rail lists
 * SECTIONS, this lists YOUR RECORDS. Nothing here duplicates a nav item.
 *
 * Signed out it is unchanged — the login form inside the site chrome, which the
 * (portal) layout supplies when there is no session so the page is not a dead
 * end. */

export default async function PortalPage_() {
  if (!(await hasAnyUsers())) redirect("/portal/setup");

  const user = await getSessionUser();
  if (!user) {
    // copy/get-listed-cta: the no-account hint under the form is
    // Chamber-editable, so the login branch needs the copy overlay too.
    const copy = await getCopyOverrides();
    return (
      <>
        <PageHeader
          eyebrow="For local businesses & nonprofits"
          title="Kingston Portal"
          intro="Update your hours once and every page of this site follows. Manage your events, volunteer shifts, and listing — free, from the Chamber."
        />
        <Section>
          <LoginForm />
          <PortalInviteHint copy={copy} />
        </Section>
      </>
    );
  }

  // Resolve the ids this account may edit into names, exactly as
  // /portal/account does — the client never needs the listing stores.
  const [restaurants, charities, lodging] = await Promise.all([
    getRestaurants(),
    getCharities(),
    getLodging(),
  ]);
  const nameById = new Map<string, string>();
  for (const r of restaurants) nameById.set(r.id, r.name);
  for (const c of charities) nameById.set(c.id, c.name);
  for (const l of lodging) nameById.set(l.id, l.name);

  const managed = user.editableIds.map((id: string) => ({
    id,
    name: nameById.get(id) ?? id,
  }));

  // moderator and viewer are provisioned and ENFORCED (E06) but have no
  // surfaces yet. Say so plainly rather than showing an empty dashboard that
  // looks broken.
  const awaitingTools = user.role === "moderator" || user.role === "viewer";
  const firstName = user.name.split(" ")[0];

  return (
    <PortalPage
      title={`Hi, ${firstName}`}
      intro="What you manage, and where to pick it up."
      actions={<LogoutButton />}
    >
      {awaitingTools && (
        <Callout title={`${ROLE_LABELS[user.role]} access is set up`}>
          Your account and permissions are active. Manage your account details
          from the menu any time.
        </Callout>
      )}

      {managed.length > 0 && (
        <PortalPanel title={managed.length === 1 ? "Your listing" : "Your listings"}>
          <ul className="flex flex-col gap-2">
            {managed.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4"
              >
                <span className="min-w-0 font-semibold text-ink">{m.name}</span>
                <Link
                  href={`/portal/business/${m.id}`}
                  className="shrink-0 font-semibold text-secondary underline underline-offset-2 hover:text-secondary-deep"
                >
                  Edit listing
                </Link>
              </li>
            ))}
          </ul>
        </PortalPanel>
      )}

      <PortalPanel title="Your account">
        <FieldList
          fields={[
            { label: "Signed in as", value: user.name },
            { label: "Email", value: user.email },
            { label: "Role", value: ROLE_LABELS[user.role] },
            ...(user.orgName ? [{ label: "Organisation", value: user.orgName }] : []),
            ...(user.role === "admin"
              ? [{ label: "Manages", value: "Everything (admin)" }]
              : []),
          ]}
        />
      </PortalPanel>
    </PortalPage>
  );
}
