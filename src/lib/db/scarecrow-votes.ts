// Scarecrow Crawl votes — the db layer.
//
// Consumers import src/lib/stores/scarecrow-store.ts, never this file:
// src/lib/db is the only place allowed to touch the Drizzle client, and the
// store module is the domain API over it (same split as event-going.ts /
// event-going-store.ts). lint:boundaries enforces it.
//
// A row per vote, not a counter — unlike event_going, because each vote can
// carry a photo the Chamber has to review one at a time, and a counter has
// nowhere to hang one. The row still holds NO identifier: no session id, no
// IP, no cookie, no coordinate. Repeat votes are suppressed on the device;
// the count is an interest signal, not a ballot box. Say so where it is shown.

import "server-only";

import { count, desc, eq, lt, sql } from "drizzle-orm";

import { getDb } from "./client";
import { scarecrowVote } from "./schema";

export interface ScarecrowVoteRow {
  id: string;
  scarecrowId: string;
  photoPath: string | null;
  /** null = no photo; false = photo, permission withheld; true = may be used. */
  photoSocialOk: boolean | null;
  createdAt: Date;
}

/** Record one vote. The caller has already validated the scarecrow id against
 *  the seed list and stored the photo bytes (when there are any). */
export async function insertVote(input: {
  id: string;
  scarecrowId: string;
  photoPath?: string;
  photoSocialOk?: boolean;
}): Promise<void> {
  await getDb().insert(scarecrowVote).values({
    id: input.id,
    scarecrowId: input.scarecrowId,
    photoPath: input.photoPath ?? null,
    // Only a vote that carried a photo can carry an answer about it.
    photoSocialOk: input.photoPath ? (input.photoSocialOk ?? false) : null,
  });
}

/** Votes per scarecrow id. Ids with no votes are ABSENT rather than 0 — the
 *  caller renders what it likes for them, and "nobody yet" should not arrive
 *  looking like a measured zero. */
export async function getVoteCounts(): Promise<Record<string, number>> {
  const rows = await getDb()
    .select({
      scarecrowId: scarecrowVote.scarecrowId,
      total: sql<number>`count(*)::int`,
    })
    .from(scarecrowVote)
    .groupBy(scarecrowVote.scarecrowId);
  return Object.fromEntries(rows.map((r) => [r.scarecrowId, r.total]));
}

/** Total votes cast, for the admin header. */
export async function countVotes(): Promise<number> {
  const [row] = await getDb().select({ n: count() }).from(scarecrowVote);
  return row?.n ?? 0;
}

/** Newest votes, photo or not. The photo-carrying subset is what the console
 *  shows; this is the whole row set, for checks and for a future export. */
export async function listVotes(limit = 60): Promise<ScarecrowVoteRow[]> {
  const rows = await getDb()
    .select()
    .from(scarecrowVote)
    .orderBy(desc(scarecrowVote.createdAt))
    .limit(limit);
  return rows.map(toRow);
}

/** Newest votes that carry a photo — the Chamber's review list. */
export async function listVotesWithPhotos(limit = 60): Promise<ScarecrowVoteRow[]> {
  const rows = await getDb()
    .select()
    .from(scarecrowVote)
    .where(sql`${scarecrowVote.photoPath} is not null`)
    .orderBy(desc(scarecrowVote.createdAt))
    .limit(limit);
  return rows.map(toRow);
}

/** One vote by id — how the admin photo route finds the path to stream.
 *  Nothing else may name a stored file; the path never arrives from a query. */
export async function getVoteById(id: string): Promise<ScarecrowVoteRow | undefined> {
  const [row] = await getDb().select().from(scarecrowVote).where(eq(scarecrowVote.id, id)).limit(1);
  return row ? toRow(row) : undefined;
}

/** Drop one vote, returning the photo path the caller must now delete. The row
 *  goes whatever happens to the bytes: a rejected photo that stays countable
 *  would leave the Chamber's decision half-applied. */
export async function deleteVote(id: string): Promise<{ deleted: boolean; photoPath: string | null }> {
  const [row] = await getDb()
    .delete(scarecrowVote)
    .where(eq(scarecrowVote.id, id))
    .returning({ photoPath: scarecrowVote.photoPath });
  return { deleted: row !== undefined, photoPath: row?.photoPath ?? null };
}

/** How many votes are past the retention window (the dry-run number). */
export async function countVotesBefore(cutoff: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(scarecrowVote)
    .where(lt(scarecrowVote.createdAt, new Date(cutoff)));
  return row?.n ?? 0;
}

/** Delete EVERY vote, handing back the photo paths so the caller can delete
 *  the bytes too. The Chamber's "clear the test votes" button, and nothing
 *  else — it is gated, confirmed and audited at the boundary. */
export async function deleteAllVotes(): Promise<DeletedVotes> {
  const rows = await getDb().delete(scarecrowVote).returning({ photoPath: scarecrowVote.photoPath });
  return countDeleted(rows);
}

/** Rows removed, and the photos among them that still need deleting. The two
 *  numbers differ — most votes carry no photo — so a caller reporting "deleted
 *  N" must not count paths. */
export interface DeletedVotes {
  deleted: number;
  photoPaths: string[];
}

function countDeleted(rows: { photoPath: string | null }[]): DeletedVotes {
  return {
    deleted: rows.length,
    photoPaths: rows
      .map((r) => r.photoPath)
      .filter((p): p is string => typeof p === "string" && p !== ""),
  };
}

/** Retention purge: delete expired votes, handing back the photo paths so the
 *  caller can delete the bytes too. Rows and photos die together. */
export async function deleteVotesBefore(cutoff: string): Promise<DeletedVotes> {
  const rows = await getDb()
    .delete(scarecrowVote)
    .where(lt(scarecrowVote.createdAt, new Date(cutoff)))
    .returning({ photoPath: scarecrowVote.photoPath });
  return countDeleted(rows);
}

function toRow(row: typeof scarecrowVote.$inferSelect): ScarecrowVoteRow {
  return {
    id: row.id,
    scarecrowId: row.scarecrowId,
    photoPath: row.photoPath,
    photoSocialOk: row.photoSocialOk,
    createdAt: row.createdAt,
  };
}
