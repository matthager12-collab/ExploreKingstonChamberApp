// /admin/race — the Chamber's view of the 5K roster synced from Zeffy:
// counts, who still needs a look, check-in, and the pickup sheet.
//
// Server component: the /admin layout gates this route, and the role is
// re-checked here (defense in depth). Every mutation goes through an
// admin-gated API route that checks again.

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth";
import { race } from "@/lib/data/race";
import { getCheckinLink, lastRaceSyncRun, listRegistrants } from "@/lib/db/race-registrants";
import { zeffyConfig } from "@/lib/race/zeffy-client";

import { RaceManager } from "./manager";

export const metadata: Metadata = { title: "5K registrations" };
export const dynamic = "force-dynamic";

export default async function AdminRacePage() {
  const user = await getSessionUser();
  if (user?.role !== "admin") redirect("/portal");

  const [rows, lastRun, link] = await Promise.all([
    listRegistrants(),
    lastRaceSyncRun(),
    getCheckinLink(race.id),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Chamber admin"
        title={race.shortName}
        intro="Every runner who registered on Zeffy. Sync pulls the latest; the webhook keeps it current between syncs."
      />
      <RaceManager
        configured={zeffyConfig() !== null}
        hasWaiverQuestion={race.questions.waiver !== null}
        lastRun={
          lastRun
            ? { startedAt: lastRun.startedAt.toISOString(), runBy: lastRun.runBy, stats: lastRun.stats }
            : null
        }
        link={
          link
            ? {
                version: link.version,
                expiresAt: link.expiresAt.toISOString(),
                revoked: link.revokedAt !== null,
              }
            : null
        }
        rows={rows.map((r) => ({
          id: r.id,
          firstName: r.firstName,
          lastName: r.lastName,
          email: r.email,
          rateTitle: r.rateTitle,
          shirtNote: r.shirtNote,
          waiverSigned: r.waiverSigned,
          status: r.status,
          needsReviewReason: r.needsReviewReason,
          checkedInAt: r.checkedInAt?.toISOString() ?? null,
          registeredAt: r.registeredAt.toISOString(),
        }))}
      />
    </>
  );
}
