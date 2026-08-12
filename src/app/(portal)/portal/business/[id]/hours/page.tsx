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

export default async function BusinessHoursPage({
  params,
}: PageProps<"/portal/business/[id]/hours">) {
  const { id } = await params;
  const { record } = await requireBusinessRecord(id);
  if (record.kind !== "restaurant") notFound();

  return <HoursForm initial={record.restaurant} />;
}
