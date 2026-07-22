// /admin/accounts — Chamber account & invite management.
//
// Server component: the /admin layout already gates this route, but we
// re-check the role here anyway (defense in depth — a future layout edit must
// not silently expose account data).
//
// E06 removed the pre-setup grace that used to let this page render while zero
// users existed. It mirrored the layout's grace, and the layout's version was
// the audit's highest-risk finding: an emptied user store re-opened /admin at
// the worst possible moment. Bootstrap never needed this page — the first admin
// is created at /portal/setup.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  getSessionUser,
  inviteState,
  listInvites,
  listOrganizations,
  listUsers,
  toPublicUser,
} from "@/lib/auth";
import { getRestaurants } from "@/lib/stores/business-store";
import { getCharities } from "@/lib/stores/charity-store";
import { PageHeader } from "@/components/ui";
import { AccountsManager } from "./manager";

export const metadata: Metadata = { title: "Accounts & invites" };
export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const user = await getSessionUser();
  if (user?.role !== "admin") redirect("/portal");

  const [users, invites, orgs, restaurants, charities] = await Promise.all([
    listUsers(),
    listInvites(),
    listOrganizations(),
    getRestaurants(),
    getCharities(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Chamber admin"
        title="Accounts & invites"
        intro="Invite businesses and nonprofits to the portal, see who manages what, and hand out codes that link each account to its listings."
      />
      <AccountsManager
        // toPublicUser builds the client payload field by field, so no hash can
        // reach the page props. The old `({ passwordHash, ...rest })` destructure
        // stripped only the field it named — a future secret column would have
        // ridden along into the browser.
        users={users.map(toPublicUser)}
        invites={invites.map((i) => ({
          ...i,
          // Props to a client component are JSON-serialized; Dates must already
          // be strings or the boundary rejects them.
          createdAt: i.createdAt.toISOString(),
          expiresAt: i.expiresAt.toISOString(),
          revokedAt: i.revokedAt?.toISOString() ?? null,
          usedAt: i.usedAt?.toISOString() ?? null,
          // Same derivation GET /api/portal/invites uses, so a server-rendered
          // list and a freshly minted invite badge identically.
          state: inviteState(i),
        }))}
        orgs={orgs.map((o) => ({ id: o.id, name: o.name, kind: o.kind }))}
        restaurants={restaurants.map((r) => ({ id: r.id, name: r.name }))}
        charities={charities.map((c) => ({ id: c.id, name: c.name }))}
      />
      {/* E09: account history is metadata-only (who/what/when — bodies are
          stripped server-side for these stores) and restore is structurally
          disabled; the audit browser is the right surface for it. */}
      <section className="mx-auto max-w-5xl px-4 pb-8">
        <p className="text-sm text-ink-soft">
          Need to know who changed an account or invite?{" "}
          <a
            href="/admin/audit?store=users"
            className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
          >
            View the account change history
          </a>{" "}
          — actions only, details stay hidden for security, and accounts can
          never be &quot;restored&quot;.
        </p>
      </section>
    </>
  );
}
