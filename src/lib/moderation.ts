// E08 moderation engine — the ONE module that encodes how member/public
// submissions move through the worklist queue and how admins resolve them.
//
// The launch-blocking invariant (M-16-01 / FR-A01 / FR-A98): nothing a
// non-admin submits may appear publicly without Chamber approval, and a
// member edit must NEVER unpublish or mutate the live record — the proposed
// revision rides in the worklist payload until approval (the trap the
// architecture audits flagged: a naive status='pending' write on edit would
// yank live listings off the site).
//
// Producer rules (member paths in the portal routes):
//  - NEW record        → holdNewRecord: stored with status='pending'
//                        (publicly invisible) + one open moderation item;
//  - EDIT of a LIVE    → holdEditProposal: live record untouched, proposed
//    (or seed) record    record in the item payload;
//  - EDIT of their own → updatePendingRecord: safe to update in place —
//    PENDING record      it was never public — and the open item follows;
//  - DELETE of a LIVE  → requestTakedown: removal needs review too;
//  - DELETE of their   → withdrawPendingRecord: tombstone it and dismiss
//    own PENDING record  the open item (nothing was ever public).
//
// Admin writes never come through here — admins are the moderators and their
// saves publish directly as 'live' (the E05 writeRecord default).

import "server-only";

import { setRecordStatus, type WithId, type WithStatus } from "@/lib/db/records";
import {
  createWorklistItem,
  dismissItem,
  listWorklistItems,
  resolveItem,
  type WorklistItemRow,
} from "@/lib/stores/worklist-store";
import { writeOverlayRecord } from "@/lib/stores/json-store";
import { getCharitiesAdmin, getVolunteerNeedsAdmin } from "@/lib/stores/charity-store";
import { getEventsAdmin } from "@/lib/stores/event-store";
import { getItinerariesAdmin } from "@/lib/stores/itinerary-store";
import { getLodgingAdmin, getWebcamsAdmin } from "@/lib/stores/listing-stores";
import { getRestaurantsAdmin } from "@/lib/stores/business-store";

/** The acting signed-in user (SessionUser satisfies this). */
export type Actor = { id: string; email: string };

/** Any-status readers for the content stores moderation can act on. Stores
 *  absent here (e.g. hunt-submissions) hold reviewable items whose approval
 *  changes no content record — the photo was never public and stays where it
 *  is; resolving the item IS the review. */
const ADMIN_GETTERS: Record<string, () => Promise<WithStatus<WithId>[]>> = {
  restaurants: getRestaurantsAdmin,
  events: getEventsAdmin,
  charities: getCharitiesAdmin,
  "volunteer-needs": getVolunteerNeedsAdmin,
  lodging: getLodgingAdmin,
  webcams: getWebcamsAdmin,
  itineraries: getItinerariesAdmin,
};

async function getSubjectRecord(
  store: string,
  id: string,
): Promise<WithStatus<WithId> | undefined> {
  const getter = ADMIN_GETTERS[store];
  if (!getter) return undefined;
  return (await getter()).find((r) => r.id === id);
}

async function findActiveModerationItem(
  store: string,
  id: string,
): Promise<WorklistItemRow | undefined> {
  const open = await listWorklistItems({
    type: "moderation",
    state: ["open", "in_progress"],
    subjectStore: store,
  });
  return open.find((i) => i.subjectId === id);
}

/* ------------------------------- producers ------------------------------- */

/** Member creates a record: store it as 'pending' (publicly invisible — the
 *  default getters are live-only) and open the review item. */
export async function holdNewRecord<T extends WithId>(
  store: string,
  rec: T,
  label: string,
  user: Actor,
): Promise<void> {
  await writeOverlayRecord(store, rec, {
    actor: user.email,
    source: "portal",
    status: "pending",
  });
  await createWorklistItem(
    {
      type: "moderation",
      subjectStore: store,
      subjectId: rec.id,
      subjectLabel: label,
      payload: { kind: "new", submitterUserId: user.id },
      createdBy: user.id,
    },
    { actor: user.email, source: "portal" },
  );
}

/** Member edits a LIVE (or seed) record: the live record keeps serving —
 *  the full proposed revision waits in the item payload until approval. */
export async function holdEditProposal<T extends WithId>(
  store: string,
  proposed: T,
  label: string,
  user: Actor,
): Promise<void> {
  await createWorklistItem(
    {
      type: "moderation",
      subjectStore: store,
      subjectId: proposed.id,
      subjectLabel: label,
      payload: { kind: "edit", proposed, submitterUserId: user.id },
      createdBy: user.id,
    },
    { actor: user.email, source: "portal" },
  );
}

/** Member updates their own still-PENDING record: it was never public, so an
 *  in-place update is safe; the open 'new' item merges and its label follows.
 *  Same mechanics as a fresh hold — the partial unique index turns the second
 *  call into a merge. */
export async function updatePendingRecord<T extends WithId>(
  store: string,
  rec: T,
  label: string,
  user: Actor,
): Promise<void> {
  await holdNewRecord(store, rec, label, user);
}

/** Member asks to remove a LIVE record: removal is a public-content change,
 *  so it holds for review like everything else. */
export async function requestTakedown(
  store: string,
  id: string,
  label: string,
  user: Actor,
): Promise<void> {
  await createWorklistItem(
    {
      type: "moderation",
      subjectStore: store,
      subjectId: id,
      subjectLabel: label,
      payload: { kind: "takedown", submitterUserId: user.id, note: "Removal requested by owner" },
      createdBy: user.id,
    },
    { actor: user.email, source: "portal" },
  );
}

/** Member withdraws their own still-PENDING submission: tombstone it and
 *  dismiss the open item — nothing was ever public, nothing to review. */
export async function withdrawPendingRecord(
  store: string,
  id: string,
  user: Actor,
): Promise<void> {
  await writeOverlayRecord(
    store,
    { id, _deleted: true },
    { actor: user.email, source: "portal", status: "pending" },
  );
  const item = await findActiveModerationItem(store, id);
  if (item) {
    await dismissItem(
      item.id,
      { note: "Withdrawn by submitter", resolvedBy: user.id },
      { actor: user.email, source: "portal" },
    );
  }
}

/* --------------------------- admin resolutions --------------------------- */

export class ModerationActionError extends Error {}

/** Approve a moderation item. Per payload.kind:
 *  - 'new':      flip the pending record to 'live';
 *  - 'edit':     write the proposed record through the store write-gate as
 *                'live' (re-validated at approval time — schemas may have
 *                tightened since submission; a failure rejects the write and
 *                surfaces the validation message, never force-writes);
 *  - 'takedown': execute the removal (tombstone).
 *  Subjects without a registered content store (hunt photos) change nothing —
 *  resolving the item is the review. */
export async function approveModerationItem(
  item: WorklistItemRow,
  admin: Actor,
): Promise<void> {
  const meta = { actor: admin.email, source: "admin" as const };
  const kind = (item.payload as { kind?: string }).kind;
  const store = item.subjectStore;

  if (ADMIN_GETTERS[store]) {
    if (kind === "new") {
      const flipped = await setRecordStatus(store, item.subjectId, "live", meta);
      if (!flipped) {
        throw new ModerationActionError(
          "The submitted record no longer exists — reject or dismiss this item instead.",
        );
      }
    } else if (kind === "edit") {
      const proposed = (item.payload as { proposed?: WithId }).proposed;
      if (!proposed?.id) {
        throw new ModerationActionError("This edit item carries no proposed record.");
      }
      // Store write-gate validates (RecordValidationError propagates to the
      // route as a 400 with the zod message) and publishes in one write.
      await writeOverlayRecord(store, proposed, { ...meta, status: "live" });
    } else if (kind === "takedown") {
      const current = await getSubjectRecord(store, item.subjectId);
      if (current) {
        await writeOverlayRecord(store, { id: item.subjectId, _deleted: true }, meta);
      }
    }
  }

  await resolveItem(
    item.id,
    { resolution: "approved", resolvedBy: admin.id },
    meta,
  );
}

/** Reject a moderation item: content stays exactly as it is — a pending
 *  'new' record stays pending (the member can revise and resubmit), a live
 *  record keeps serving. The note is required by the API layer. */
export async function rejectModerationItem(
  item: WorklistItemRow,
  note: string,
  admin: Actor,
): Promise<void> {
  await resolveItem(
    item.id,
    { resolution: "rejected", note, resolvedBy: admin.id },
    { actor: admin.email, source: "admin" },
  );
}

/** One-click admin takedown (M-16-01) of a LIVE record: pull it from every
 *  public surface now (status → 'pending'; seed-only records get overlaid
 *  with their own doc at 'pending') and leave the resolved item as the audit
 *  artifact. Re-publishing later is an admin save or an approve of the
 *  re-review. */
export async function takedownLiveRecord(
  store: string,
  id: string,
  admin: Actor,
  note?: string,
): Promise<{ label: string }> {
  const current = await getSubjectRecord(store, id);
  if (!current) throw new ModerationActionError("Record not found in that store.");
  const label =
    String(
      (current as Record<string, unknown>).name ??
        (current as Record<string, unknown>).title ??
        current.id,
    ) || current.id;
  const meta = { actor: admin.email, source: "admin" as const };

  const flipped = await setRecordStatus(store, id, "pending", meta);
  if (!flipped) {
    // Seed-only record: no overlay row to flip — overlay it at 'pending'.
    const { status: _status, ...doc } = current;
    await writeOverlayRecord(store, doc, { ...meta, status: "pending" });
  }

  const { item } = await createWorklistItem(
    {
      type: "moderation",
      subjectStore: store,
      subjectId: id,
      subjectLabel: label,
      payload: { kind: "takedown", note: note ?? "Taken down by Chamber admin" },
      createdBy: admin.id,
    },
    meta,
  );
  await resolveItem(item.id, { resolution: "taken_down", note, resolvedBy: admin.id }, meta);
  return { label };
}
