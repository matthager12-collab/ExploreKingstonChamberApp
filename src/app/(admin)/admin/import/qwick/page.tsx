// /admin/import/qwick — the no-terminal Qwick listings import (E17 step 5,
// NFR-A33). Paste or upload a saved export, preview the bucketed plan, then
// apply behind an explicit confirmation. Everything an apply writes lands as
// an invisible DRAFT in the directory domain — publishing stays a deliberate
// per-record decision on /admin/listings.
//
// Server component: the /admin layout already gates this route, but we
// re-check the role here anyway (defense in depth — a future layout edit must
// not silently expose the import surface). The API route re-checks again
// because route handlers bypass layouts entirely.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { listImportRuns } from "@/lib/import/qwick";
import { PageHeader } from "@/components/ui";
import { QwickImportManager } from "./manager";

export const metadata: Metadata = { title: "Qwick listings import" };
export const dynamic = "force-dynamic";

export default async function QwickImportPage() {
  const user = await getSessionUser();
  if (user?.role !== "admin") redirect("/portal");

  // History is server-rendered (no fetch-on-mount effect); the client half
  // re-reads GET /api/admin/import/qwick after each run it triggers. The full
  // bucketed report is deliberately not passed — the list shows summaries.
  const runs = (await listImportRuns(20)).map((r) => ({
    id: r.id,
    mode: r.mode,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    runBy: r.runBy,
    stats: r.stats,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Chamber admin"
        title="Qwick listings import"
        intro="Bring the legacy kiosk's business listings into the directory as invisible drafts. Always preview first; nothing an import writes is ever public until you publish it yourself."
      />
      <QwickImportManager initialRuns={runs} />
    </>
  );
}
