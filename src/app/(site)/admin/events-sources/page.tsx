// /admin/events-sources — the E12 unified-calendar control room: the
// ship-dark flag, per-source ingest toggles + last-run reports, "Sync now",
// the dedupe review (not-a-duplicate verdicts), and the trusted-org
// auto-publish flags.
//
// Server component: the /admin layout already gates this route, but we
// re-check the role here anyway (defense in depth, sibling-page convention).

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, listOrganizations } from "@/lib/auth";
import { getUnifiedReview } from "@/lib/events/unified";
import { getCalendarSources } from "@/lib/stores/calendar-sources-store";
import { listEventOverrides } from "@/lib/stores/event-overrides-store";
import {
  getUnifiedCalendarEnabled,
  getUnifiedCalendarSetting,
} from "@/lib/stores/unified-calendar-store";
import { PageHeader } from "@/components/ui";
import { EventsSourcesManager } from "./manager";

export const metadata: Metadata = { title: "Events sources" };
export const dynamic = "force-dynamic";

export default async function EventsSourcesPage() {
  const user = await getSessionUser();
  if (user?.role !== "admin") redirect("/portal");

  const [enabled, setting, sources, overrides, review, orgs] = await Promise.all([
    getUnifiedCalendarEnabled(),
    getUnifiedCalendarSetting(),
    getCalendarSources(),
    listEventOverrides(),
    getUnifiedReview(),
    listOrganizations(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Chamber admin"
        title="Events sources & unified calendar"
        intro="Control which community calendars feed the unified events list, review possible duplicates, and decide when the merged calendar goes live to visitors."
      />
      <EventsSourcesManager
        initial={{
          flag: { enabled, setting },
          sources,
          overrides,
          mergedCount: review.merged.length,
          clusters: review.clusters,
          orgs: orgs.map((o) => ({
            id: o.id,
            name: o.name,
            kind: o.kind,
            trustedAutoPublish: o.trustedAutoPublish,
          })),
        }}
      />
    </>
  );
}
