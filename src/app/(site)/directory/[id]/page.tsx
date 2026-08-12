// /directory/[id] — one business's public profile (directory-public slice,
// phase 2). The "clickable business profile" the map pins link to in
// phase 3.
//
// LIVE listings only (public getter; drafts 404 like ids that never
// existed). Renders: name, category, member badge, description, address
// (directions link), phone, website — and, on unclaimed listings, the claim
// call-to-action feeding the claim-signup flow. Dues never appear; the
// member badge is the only membership fact this page knows.
//
// force-dynamic rather than ISR: the claimed-or-not read (the ownership
// union) decides whether the claim CTA shows, and a claim landing seconds
// ago should hide it immediately — the same posture as /claim/[id].

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getClaimableBusiness } from "@/lib/claims/self-signup";
import { isActiveMemberStatus, listMemberMeta } from "@/lib/db/member-meta";
import { getDirectoryListing } from "@/lib/stores/directory-store";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";
import { Badge, PageHeader, Section } from "@/components/ui";

export const dynamic = "force-dynamic";

// Same labels the browser, workbench, and portal use.
const CATEGORY_LABEL: Record<string, string> = {
  eat: "Eat & Drink",
  stay: "Stay",
  shop: "Shop",
  services: "Services",
  activities: "Activities",
  community: "Community",
  other: "Directory",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const listing = await getDirectoryListing(id);
  return { title: listing ? `${listing.name} · Business directory` : "Business directory" };
}

function mapsSearchUrl(name: string, address?: string): string {
  const query = address ? `${name}, ${address}` : `${name}, Kingston, WA`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export default async function DirectoryProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const listing = await getDirectoryListing(id);
  if (!listing) notFound();

  const [meta, claimable, copy] = await Promise.all([
    listMemberMeta("directory"),
    getClaimableBusiness(id),
    getCopyOverrides(),
  ]);
  const isMember = isActiveMemberStatus(
    meta.find((m) => m.subjectId === id)?.memberStatus,
  );
  const claimed = claimable?.claimed ?? true; // unknown reads as claimed: no CTA

  const actionCls =
    "inline-block rounded-full bg-sound px-4 py-1.5 text-sm font-semibold text-white hover:bg-sound-deep";
  const quietActionCls =
    "inline-block rounded-full border border-sand bg-white px-4 py-1.5 text-sm font-medium text-ink hover:border-tide";

  return (
    <>
      <PageHeader
        eyebrow={CATEGORY_LABEL[listing.category] ?? "Directory"}
        title={listing.name}
        intro={listing.description || undefined}
      />
      <Section>
        <div className="max-w-2xl space-y-4">
          {isMember && <Badge tone="green">{copyText(copy, "directoryPage.memberBadge")}</Badge>}

          <dl className="space-y-2 text-sm">
            {listing.address && (
              <div>
                <dt className="font-medium text-ink">Address</dt>
                <dd className="text-ink-soft">{listing.address}</dd>
              </div>
            )}
            {listing.phone && (
              <div>
                <dt className="font-medium text-ink">Phone</dt>
                <dd>
                  <a
                    href={`tel:${listing.phone.replace(/[^\d+]/g, "")}`}
                    className="text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
                  >
                    {listing.phone}
                  </a>
                </dd>
              </div>
            )}
          </dl>

          <div className="flex flex-wrap gap-2">
            <a
              href={mapsSearchUrl(listing.name, listing.address)}
              target="_blank"
              rel="noreferrer"
              className={actionCls}
            >
              {copyText(copy, "directoryPage.profile.directions")}
            </a>
            {listing.website && (
              <a href={listing.website} target="_blank" rel="noreferrer" className={quietActionCls}>
                {copyText(copy, "directoryPage.profile.website")}
              </a>
            )}
          </div>

          {!claimed && (
            <p className="text-sm">
              <Link
                href={`/claim/${listing.id}`}
                className="font-medium text-ink-soft underline underline-offset-2 hover:text-ink"
              >
                {copyText(copy, "directoryPage.profile.claimLink")}
              </Link>
            </p>
          )}

          <p className="text-sm">
            <Link
              href="/directory"
              className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
            >
              {copyText(copy, "directoryPage.profile.back")}
            </Link>
          </p>
        </div>
      </Section>
    </>
  );
}
