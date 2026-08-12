// E08 admin worklist — the Chamber's one review queue: moderation holds,
// staleness re-verification, visitor reports, and (once E16/E11 produce
// them) sync conflicts and privacy requests. Server component behind the
// /admin layout gate; the API route re-checks admin itself.

import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/ui";
import { getSubjectRecord } from "@/lib/moderation";
import {
  getWorklistCounts,
  listWorklistItems,
  type WorklistItemRow,
} from "@/lib/stores/worklist-store";
import { WorklistManager, type WorklistItemView } from "./manager";

export const metadata: Metadata = {
  title: "Worklist",
  description: "Review member submissions, visitor reports, and stale-data checks.",
};
export const dynamic = "force-dynamic";

async function toView(item: WorklistItemRow): Promise<WorklistItemView> {
  return {
    id: item.id,
    type: item.type,
    subjectStore: item.subjectStore,
    subjectId: item.subjectId,
    subjectLabel: item.subjectLabel,
    state: item.state,
    assigneeUserId: item.assigneeUserId,
    dueAt: item.dueAt?.toISOString() ?? null,
    payload: item.payload,
    resolution: item.resolution,
    resolutionNote: item.resolutionNote,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    createdBy: item.createdBy,
    resolvedAt: item.resolvedAt?.toISOString() ?? null,
    resolvedBy: item.resolvedBy,
    subject: (await getSubjectRecord(item.subjectStore, item.subjectId)) ?? null,
  };
}

export default async function AdminWorklistPage() {
  const [active, counts] = await Promise.all([
    listWorklistItems({ state: ["open", "in_progress"] }),
    getWorklistCounts(),
  ]);
  const items = await Promise.all(active.map(toView));

  return (
    <>
      <PageHeader
        eyebrow="Chamber admin"
        title="Worklist"
        intro="Everything waiting on a human: member submissions to review, visitor reports, and content due for a re-check. Nothing a member submits goes live until it's approved here."
      />
      <Section title="Queue">
        <WorklistManager initialItems={items} initialCounts={counts} />
      </Section>
    </>
  );
}
