import type { Metadata } from "next";
import { DirectoryEditor } from "./directory-editor";
import { LodgingEditor } from "./lodging-editor";
import { ListingForm } from "./listing-form";
import { requireBusinessRecord } from "./record";

// The default pane. For a restaurant that is the Listing tab; for lodging and
// directory listings it is the whole editor, since those have no tabs.
//
// The heading, intro, back link and tabs all live in layout.tsx — this file
// renders only the pane, which is what lets the other two tabs exist without
// repeating any of it.

export const metadata: Metadata = { title: "Edit listing" };
export const dynamic = "force-dynamic";

// Hand-declared params, NOT the generated PageProps/LayoutProps globals.
// Those are written into .next/types by a BUILD, and CI runs `npm run
// typecheck` ten steps before `npm run build` — so they do not exist when
// tsc runs and every file using them fails with TS2304. It passed locally
// only because a build had already happened. The rest of the repo
// hand-declares (directory/[id], hunt/[slug], itineraries/[slug]); match it.
export default async function EditListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { record } = await requireBusinessRecord(id);

  if (record.kind === "restaurant") {
    return <ListingForm initial={record.restaurant} />;
  }
  if (record.kind === "lodging") {
    return <LodgingEditor initial={record.lodging} />;
  }
  return <DirectoryEditor initial={record.record} isDraft={record.isDraft} />;
}
