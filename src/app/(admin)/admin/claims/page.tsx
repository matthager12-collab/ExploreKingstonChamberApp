// /admin/claims — the Chamber-facing claims console (E17 charter step 6).
//
// One phone-first table across all four claimable domains (restaurants,
// lodging, charities, directory): claimed vs unclaimed, with the owning org
// named, per-row invite minting through the EXISTING invites API, and the way
// back out — releasing a claim that went to the wrong business (the only
// surface in the product that can). Open claim_request worklist items surface
// at the top and deep-link to their listing rows.
//
// Outstanding invites are joined in so the operator can see, BEFORE minting,
// that a live code for this listing is already in someone's hands: a second
// code is not an error, but only the first redemption wins and the loser hits
// a 409 dead end. Codes themselves are deliberately NOT passed to the client
// here — a live invite code is a bearer grant, and this page has no reason to
// show one it did not just mint.
//
// Server component: the /admin layout already gates the route, but we
// re-check the role here anyway (defense in depth, same as /admin/accounts —
// a future layout edit must not silently expose the ownership map).

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, inviteState, listInvites } from "@/lib/auth";
import { getClaimsConsoleRows } from "@/lib/claims/console-data";
import { listWorklistItems } from "@/lib/stores/worklist-store";
import { PageHeader } from "@/components/ui";
import { ClaimsManager, type OpenClaimView, type OutstandingInviteView } from "./manager";

export const metadata: Metadata = {
  title: "Claims console",
  description:
    "Which listings are claimed by their owners, and invites for the rest.",
};
export const dynamic = "force-dynamic";

export default async function AdminClaimsPage() {
  const user = await getSessionUser();
  if (user?.role !== "admin") redirect("/portal");

  const [rows, openItems, invites] = await Promise.all([
    getClaimsConsoleRows(),
    listWorklistItems({ type: "claim_request", state: ["open", "in_progress"] }),
    listInvites(),
  ]);

  const claims: OpenClaimView[] = openItems.map((item) => ({
    id: item.id,
    subjectStore: item.subjectStore,
    subjectId: item.subjectId,
    subjectLabel: item.subjectLabel,
    createdAt: item.createdAt.toISOString(),
    payload: item.payload,
  }));

  // bare linked id → live codes still out there. Keyed by id, not by
  // store/id, because org linked_ids and invite linked_ids are bare ids.
  const outstanding: Record<string, OutstandingInviteView> = {};
  for (const invite of invites) {
    if (inviteState(invite) !== "active") continue;
    for (const id of invite.linkedIds) {
      const soonest = outstanding[id]?.expiresAt;
      const expiresAt = invite.expiresAt.toISOString();
      outstanding[id] = {
        count: (outstanding[id]?.count ?? 0) + 1,
        expiresAt: soonest && soonest < expiresAt ? soonest : expiresAt,
      };
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Chamber admin"
        title="Claims console"
        intro="Every listing across restaurants, lodging, nonprofits, and the directory — who has claimed theirs, and one-tap invites for the owners who haven't. Verification is a phone call to the listed number; the invite link does the rest."
      />
      <ClaimsManager rows={rows} claims={claims} outstandingInvites={outstanding} />
    </>
  );
}
