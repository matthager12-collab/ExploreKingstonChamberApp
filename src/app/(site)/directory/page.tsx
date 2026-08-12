// /directory — the public business directory (directory-public slice,
// phase 2; the R2 "app becomes the public directory" surface).
//
// LIVE listings only: the public getter's E08 gate does the filtering, so
// drafts (unpublished members, dropped members never published) are simply
// absent. Order comes from rankDirectoryListings — active members first,
// dues descending, alphabetical — computed server-side; the client component
// receives only the projection below. Dues amounts never leave the server;
// the browser learns member-or-not, nothing else.
//
// ISR (revalidate 60): same freshness contract as /eat — a publish or a
// rank change appears within a minute.

import type { Metadata } from "next";
import { rankDirectoryListings } from "@/lib/directory/rank";
import { listMemberMeta } from "@/lib/db/member-meta";
import { getDirectoryListings } from "@/lib/stores/directory-store";
import { copyText, getCopyOverrides } from "@/lib/stores/site-store";
import { PageHeader, Section } from "@/components/ui";
import { DirectoryBrowser, type DirectoryRow } from "./directory-browser";

export const metadata: Metadata = {
  title: "Business directory",
  description:
    "Local businesses across Kingston, Washington — the Greater Kingston Chamber of Commerce directory.",
};
export const revalidate = 60;

/** One-line teaser for the card grid; the profile page has the full text.
 *  Truncates by CODE POINT, not UTF-16 unit — a bare .slice() can cut an
 *  emoji in half and render a broken glyph before the ellipsis. */
function blurb(description: string): string {
  const text = description.trim();
  const points = [...text];
  if (points.length <= 140) return text;
  return `${points.slice(0, 139).join("").trimEnd()}…`;
}

export default async function DirectoryPage() {
  const [listings, meta, copy] = await Promise.all([
    getDirectoryListings(),
    listMemberMeta("directory"),
    getCopyOverrides(),
  ]);

  const rows: DirectoryRow[] = rankDirectoryListings(listings, meta).map(
    ({ listing, isMember }) => ({
      id: listing.id,
      name: listing.name,
      category: listing.category,
      blurb: blurb(listing.description),
      isMember,
    }),
  );

  return (
    <>
      <PageHeader
        eyebrow={copyText(copy, "directoryPage.header.eyebrow")}
        title={copyText(copy, "directoryPage.header.title")}
        intro={copyText(copy, "directoryPage.header.intro")}
      />
      <Section>
        <DirectoryBrowser rows={rows} />
        <p className="mt-6 text-sm text-ink-soft">
          {copyText(copy, "directoryPage.claimNote")}
        </p>
      </Section>
    </>
  );
}
