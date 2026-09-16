import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HoursForm } from "../hours-form";
import { requireBusinessRecord } from "../record";

// Hours is a restaurant-only tab. Reaching /hours on a lodging or directory
// listing is a 404 rather than a redirect: the URL genuinely does not exist for
// that record, and silently bouncing to the Listing tab would leave someone who
// followed an emailed link wondering whether they had the wrong business.

export const metadata: Metadata = { title: "Hours" };
export const dynamic = "force-dynamic";

// Hand-declared params, NOT the generated PageProps/LayoutProps globals.
// Those are written into .next/types by a BUILD, and CI runs `npm run
// typecheck` ten steps before `npm run build` — so they do not exist when
// tsc runs and every file using them fails with TS2304. It passed locally
// only because a build had already happened. The rest of the repo
// hand-declares (directory/[id], hunt/[slug], itineraries/[slug]); match it.
export default async function BusinessHoursPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { record } = await requireBusinessRecord(id);
  if (record.kind !== "restaurant") notFound();

  return <HoursForm initial={record.restaurant} />;
}
