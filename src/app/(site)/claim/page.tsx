// /claim — the public "claim your business" index (E17 claim-signup slice).
//
// Lists every imported directory business — INCLUDING drafts, which is this
// page's deliberate carve-out from the no-draft-oracle rule: an imported
// draft is precisely what an owner needs to find and claim. What crosses the
// wire is the minimal projection (name / category / claimed) from
// listClaimableDirectory; draft descriptions and contact details stay
// unpublished until the owner or the Chamber publishes the listing.
//
// force-dynamic: claimed state must be current (a claim landing seconds ago
// should show as Claimed), and the header copy resolves per-request like
// every other copy-registry page.

import type { Metadata } from "next";
import { listClaimableDirectory } from "@/lib/claims/self-signup";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";
import { PageHeader, Section } from "@/components/ui";
import { ClaimBrowser } from "./claim-browser";

export const metadata: Metadata = { title: "Claim your business" };
export const dynamic = "force-dynamic";

export default async function ClaimPage() {
  const [businesses, copy] = await Promise.all([
    listClaimableDirectory(),
    getCopyOverrides(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow={copyText(copy, "claimPage.header.eyebrow")}
        title={copyText(copy, "claimPage.header.title")}
        intro={copyText(copy, "claimPage.header.intro")}
      />
      <Section>
        <ClaimBrowser businesses={businesses} />
      </Section>
    </>
  );
}
