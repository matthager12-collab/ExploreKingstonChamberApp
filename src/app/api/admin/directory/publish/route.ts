// POST /api/admin/directory/publish — the R2 "app becomes the public
// directory" act (directory-public slice, Mat's decision 2026-08-12):
// flip every DRAFT directory listing whose member_meta says ACTIVE to
// status 'live', one audited write each through the record choke point.
//
// Deliberately narrow:
//   - drafts only — pending (member-submitted, awaiting moderation), hidden,
//     and rejected records are other workflows' business;
//   - active members only — dropped members' listings stay draft (they never
//     unpublish if already live, per the additive-only invariant; they just
//     never get published BY this action), courtesy/pending-approval members
//     wait for a per-listing admin decision in the workbench;
//   - listings with NO member_meta row are skipped and counted, not
//     published — publishing an unknown is a decision, not a default.
//
// Idempotent: re-running publishes whatever newly qualifies and touches
// nothing else. dryRun:true returns the counts without writing.
//
// Route handlers bypass layouts, so this self-gates with requireAdmin().

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import { setRecordStatus } from "@/lib/db/records";
import { isActiveMemberStatus, listMemberMeta } from "@/lib/db/member-meta";
import { getDirectoryListingsAdmin } from "@/lib/stores/directory-store";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const actor = (await getSessionUser())!;

  let dryRun = false;
  try {
    const body = (await request.json()) as { dryRun?: unknown };
    dryRun = body.dryRun === true;
  } catch {
    // empty body = real run
  }

  const [listings, meta] = await Promise.all([
    getDirectoryListingsAdmin(),
    listMemberMeta("directory"),
  ]);
  const metaById = new Map(meta.map((m) => [m.subjectId, m]));

  const counts = {
    published: 0,
    alreadyLive: 0,
    notDraft: 0,
    noMemberMeta: 0,
    notActiveMember: 0,
  };
  const published: string[] = [];

  for (const listing of listings) {
    if (listing.status === "live") {
      counts.alreadyLive += 1;
      continue;
    }
    if (listing.status !== "draft") {
      counts.notDraft += 1;
      continue;
    }
    const m = metaById.get(listing.id);
    if (!m) {
      counts.noMemberMeta += 1;
      continue;
    }
    if (!isActiveMemberStatus(m.memberStatus)) {
      counts.notActiveMember += 1;
      continue;
    }
    if (!dryRun) {
      const flipped = await setRecordStatus("directory", listing.id, "live", {
        actor: actor.email,
        source: "admin",
      });
      if (!flipped) continue; // vanished between read and write — skip quietly
    }
    counts.published += 1;
    published.push(listing.id);
  }

  return NextResponse.json({ ok: true, dryRun, counts, published });
}
