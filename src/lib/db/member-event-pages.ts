// Member event pages store (db layer — drizzle handles live only under
// src/lib/db; src/lib/stores/member-event-page-store.ts is the app-facing
// delegate). See member-event-page-schema.ts and docs/adr/ADR-0009.

import { randomBytes } from "node:crypto";
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";

import { draftDedupeKey } from "@/lib/events/member-page-dedupe";
import { getDb } from "./client";
import { memberEventDraft, memberEventPage } from "./member-event-page-schema";

export type MemberEventPageRow = typeof memberEventPage.$inferSelect;
export type MemberEventDraftRow = typeof memberEventDraft.$inferSelect;

export interface NewDraft {
  title: string;
  start: string;
  end?: string;
  venue?: string;
  description: string;
  category: string;
}

export async function getEventPage(ownerId: string): Promise<MemberEventPageRow | null> {
  const rows = await getDb()
    .select()
    .from(memberEventPage)
    .where(eq(memberEventPage.ownerId, ownerId))
    .limit(1);
  return rows[0] ?? null;
}

/** Save (or replace) the owner's page url. A changed url resets the check
 *  state; drafts are kept either way. */
export async function saveEventPage(ownerId: string, url: string): Promise<void> {
  await getDb()
    .insert(memberEventPage)
    .values({ ownerId, url })
    .onConflictDoUpdate({
      target: memberEventPage.ownerId,
      set: { url, lastCheckedAt: null, lastError: null, updatedAt: new Date() },
    });
}

/** Clearing the page deletes the row and KEEPS the drafts. */
export async function clearEventPage(ownerId: string): Promise<void> {
  await getDb().delete(memberEventPage).where(eq(memberEventPage.ownerId, ownerId));
}

export async function listNewDrafts(ownerId: string): Promise<MemberEventDraftRow[]> {
  return getDb()
    .select()
    .from(memberEventDraft)
    .where(and(eq(memberEventDraft.ownerId, ownerId), eq(memberEventDraft.status, "new")))
    .orderBy(asc(memberEventDraft.start));
}

/** ON CONFLICT DO NOTHING on (owner_id, dedupe_key): returns how many rows
 *  were really added. A dismissed/published draft is never revived. */
export async function insertDrafts(ownerId: string, drafts: NewDraft[]): Promise<number> {
  let added = 0;
  for (const d of drafts) {
    const rows = await getDb()
      .insert(memberEventDraft)
      .values({
        id: randomBytes(9).toString("hex"),
        ownerId,
        dedupeKey: draftDedupeKey(d.start),
        status: "new",
        title: d.title,
        start: d.start,
        end: d.end ?? null,
        venue: d.venue ?? null,
        description: d.description,
        category: d.category,
      })
      .onConflictDoNothing({ target: [memberEventDraft.ownerId, memberEventDraft.dedupeKey] })
      .returning({ id: memberEventDraft.id });
    added += rows.length;
  }
  return added;
}

/** Moves a draft that belongs to ownerId AND is still 'new'. False otherwise. */
export async function setDraftStatus(
  ownerId: string,
  draftId: string,
  status: "published" | "dismissed",
): Promise<boolean> {
  const rows = await getDb()
    .update(memberEventDraft)
    .set({ status })
    .where(
      and(
        eq(memberEventDraft.id, draftId),
        eq(memberEventDraft.ownerId, ownerId),
        eq(memberEventDraft.status, "new"),
      ),
    )
    .returning({ id: memberEventDraft.id });
  return rows.length > 0;
}

export async function recordCheck(ownerId: string, error: string | null): Promise<void> {
  await getDb()
    .update(memberEventPage)
    .set({ lastCheckedAt: new Date(), lastError: error })
    .where(eq(memberEventPage.ownerId, ownerId));
}

/** Atomically claims the check slot: sets last_checked_at = now only if the
 *  page was never checked or last checked before `olderThan`. One statement,
 *  so two concurrent presses cannot both win. */
export async function claimCheck(ownerId: string, olderThan: Date): Promise<boolean> {
  const rows = await getDb()
    .update(memberEventPage)
    .set({ lastCheckedAt: new Date() })
    .where(
      and(
        eq(memberEventPage.ownerId, ownerId),
        or(isNull(memberEventPage.lastCheckedAt), lt(memberEventPage.lastCheckedAt, olderThan)),
      ),
    )
    .returning({ ownerId: memberEventPage.ownerId });
  return rows.length > 0;
}

export async function listPagesDue(olderThan: Date): Promise<MemberEventPageRow[]> {
  return getDb()
    .select()
    .from(memberEventPage)
    .where(or(isNull(memberEventPage.lastCheckedAt), lt(memberEventPage.lastCheckedAt, olderThan)))
    // Oldest first (never-checked pages lead): a capped run always serves the longest-waiting pages.
    .orderBy(sql`${memberEventPage.lastCheckedAt} asc nulls first`);
}
