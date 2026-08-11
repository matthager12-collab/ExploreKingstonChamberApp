// /claim/[id] — one imported business, with the claim form (E17 claim-signup
// slice). Same minimal projection as the index: name, category, claimed —
// nothing else from a draft is rendered.
//
// The ONLY page that passes signedIn to <ClaimSignup/> — it is force-dynamic
// and already reads the session, so a signed-in owner gets the one-button
// request variant instead of re-typing name/email/password.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getClaimableBusiness } from "@/lib/claims/self-signup";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";
import { ClaimSignup } from "@/components/claim-signup";
import { PageHeader, Section } from "@/components/ui";

export const metadata: Metadata = { title: "Claim your business" };
export const dynamic = "force-dynamic";

// Same labels the admin workbench and business portal use.
const CATEGORY_LABEL: Record<string, string> = {
  eat: "Eat & Drink",
  stay: "Stay",
  shop: "Shop",
  services: "Services",
  activities: "Activities",
  community: "Community",
  other: "Directory",
};

export default async function ClaimDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [business, user, copy] = await Promise.all([
    getClaimableBusiness(id),
    getSessionUser(),
    getCopyOverrides(),
  ]);
  if (!business) notFound();

  return (
    <>
      <PageHeader
        eyebrow={CATEGORY_LABEL[business.category] ?? "Directory"}
        title={business.name}
        intro={
          business.claimed
            ? copyText(copy, "claimPage.detail.claimed")
            : copyText(copy, "claimPage.detail.intro")
        }
      />
      <Section>
        {business.claimed ? null : (
          <div className="max-w-md">
            <ClaimSignup
              store="directory"
              id={business.id}
              subject={business.name}
              signedIn={Boolean(user)}
            />
          </div>
        )}
      </Section>
    </>
  );
}
