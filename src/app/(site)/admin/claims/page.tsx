// /admin/claims — the Chamber-facing claims console (E17 charter step 6).
//
// One phone-first table across all four claimable domains (restaurants,
// lodging, charities, directory): claimed vs unclaimed, with the owning org
// named, plus per-row invite minting through the EXISTING invites API — this
// page adds no API of its own. Open claim_request worklist items surface at
// the top and deep-link to their listing rows.
//
// Server component: the /admin layout already gates the route, but we
// re-check the role here anyway (defense in depth, same as /admin/accounts —
// a future layout edit must not silently expose the ownership map).

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getClaimsConsoleRows } from "@/lib/claims/console-data";
import { listWorklistItems } from "@/lib/stores/worklist-store";
import { PageHeader } from "@/components/ui";
import { ClaimsManager, type OpenClaimView } from "./manager";

export const metadata: Metadata = {
  title: "Claims console",
  description:
    "Which listings are claimed by their owners, and invites for the rest.",
};
export const dynamic = "force-dynamic";

export default async function AdminClaimsPage() {
  const user = await getSessionUser();
  if (user?.role !== "admin") redirect("/portal");

  const [rows, openItems] = await Promise.all([
    getClaimsConsoleRows(),
    listWorklistItems({ type: "claim_request", state: ["open", "in_progress"] }),
  ]);

  const claims: OpenClaimView[] = openItems.map((item) => ({
    id: item.id,
    subjectStore: item.subjectStore,
    subjectId: item.subjectId,
    subjectLabel: item.subjectLabel,
    createdAt: item.createdAt.toISOString(),
    payload: item.payload,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Chamber admin"
        title="Claims console"
        intro="Every listing across restaurants, lodging, nonprofits, and the directory — who has claimed theirs, and one-tap invites for the owners who haven't. Verification is a phone call to the listed number; the invite link does the rest."
      />
      <ClaimsManager rows={rows} claims={claims} />
    </>
  );
}
