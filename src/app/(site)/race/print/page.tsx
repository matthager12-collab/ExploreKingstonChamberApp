// /race/print — the packet-pickup sheet, on paper. Lives under the site
// group (whose header and footer are print:hidden) rather than /admin, whose
// rail would print. Admin-only: the visibility gate satisfies the section
// guard, and the role check below is what actually keeps the roster private.

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PrintButton } from "@/components/print-button";
import { getSessionUser } from "@/lib/auth";
import { race } from "@/lib/data/race";
import { listRegistrants } from "@/lib/db/race-registrants";
import { assertPageVisible } from "@/lib/page-visibility";

export const metadata: Metadata = {
  title: "Pickup sheet",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function RacePrintPage() {
  await assertPageVisible("/race");
  const user = await getSessionUser();
  if (user?.role !== "admin") redirect("/portal");

  const rows = (await listRegistrants()).filter((r) => r.status === "active");
  const hasWaiver = race.questions.waiver !== null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 print:max-w-none print:px-0">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-sound-deep">{race.shortName} — packet pickup</h1>
          <p className="text-sm text-ink">
            {race.whenLabel} · {rows.length} registered · printed {new Date().toLocaleDateString("en-US")}
          </p>
        </div>
        <PrintButton />
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-sound-deep text-left">
            <th className="py-1 pr-2">✓</th>
            <th className="py-1 pr-2">Runner</th>
            <th className="py-1 pr-2">Ticket</th>
            <th className="py-1 pr-2">Shirt</th>
            {hasWaiver && <th className="py-1 pr-2">Waiver</th>}
            <th className="py-1">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-sand align-top">
              <td className="py-1 pr-2">
                <span className="inline-block h-4 w-4 border border-ink" aria-hidden="true" />
              </td>
              <td className="py-1 pr-2 font-medium">
                {r.lastName ?? ""}, {r.firstName ?? ""}
              </td>
              <td className="py-1 pr-2">{r.rateTitle}</td>
              <td className="py-1 pr-2">{r.shirtNote ?? ""}</td>
              {hasWaiver && <td className="py-1 pr-2">{r.waiverSigned ? "yes" : "NO"}</td>}
              <td className="py-1">
                {r.needsReviewReason === "no-contact-id" && "ask who this ticket is for"}
                {r.needsReviewReason === "partial-refund" && "partial refund — check"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
