// Typed access to the three append-only log tables (E05). These are logs,
// not records: they bypass the writeRecord choke point and write no audit
// rows — same posture as before, minus the dual backend. Lives inside
// src/lib/db/** because only the data layer may touch the DB client (eslint
// no-restricted-imports + dependency-cruiser enforce it); the store modules
// (analytics-store, survey-store, ferry-observations) call these helpers.

import "server-only";

import { asc, count, desc, eq, gte, sql } from "drizzle-orm";

import { getDb } from "./client";
import {
  analyticsEvent,
  feedbackResponse,
  ferryObservation,
  surveyResponse,
} from "./schema";

/**
 * Rows a DELETE/UPDATE actually touched.
 *
 * node-postgres reports `rowCount`; PGlite (the unit-test substrate) reports
 * `affectedRows` and leaves `rowCount` undefined. Reading only `rowCount`
 * therefore returns 0 under test for a statement that really did delete a row
 * — a false negative that makes a working delete look broken, and would make
 * "we deleted your comment" unverifiable in the suite. Same shape as the
 * helper in privacy-retention.ts, which is why every purge there is trustworthy.
 */
function mutatedRows(res: unknown): number {
  const r = res as { rowCount?: number; affectedRows?: number };
  return r.rowCount ?? r.affectedRows ?? 0;
}

/** Rows off a raw `execute`. Same shape as the helper in privacy-retention.ts. */
function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? []) as T[];
}

export async function appendAnalyticsEvent(event: unknown): Promise<void> {
  await getDb().insert(analyticsEvent).values({ event });
}

/**
 * Read logged analytics events, oldest first. `sinceIso` (optional) bounds the
 * scan to rows appended at/after that instant — the analytics BASELINE
 * (src/lib/stores/analytics-baseline-store.ts) passes the Chamber's chosen
 * "count from here" watermark so a pre-launch log full of our own building
 * never has to be read, let alone summed. Omitting it reads the full log (the
 * behavior every caller had before the baseline existed).
 *
 * Filtered in SQL, not in the summarizer, for the same reason
 * readFerryObservations takes this parameter: the rows excluded by a baseline
 * are exactly the rows that accumulated while nobody was watching, so they are
 * the ones you least want to pay to transfer and parse on every dashboard load.
 */
export async function readAnalyticsEvents<T>(sinceIso?: string): Promise<T[]> {
  const base = getDb().select({ event: analyticsEvent.event }).from(analyticsEvent);
  const rows = await (
    sinceIso ? base.where(gte(analyticsEvent.ts, new Date(sinceIso))) : base
  ).orderBy(asc(analyticsEvent.ts));
  return rows.map((r) => r.event as T);
}

export async function appendSurveyResponse(response: unknown): Promise<void> {
  await getDb().insert(surveyResponse).values({ response });
}

/**
 * Read logged survey responses, oldest first. `sinceIso` (optional) bounds the
 * scan the same way readAnalyticsEvents does, and for the same reason: the
 * admin dashboard renders survey counts beside pageview counts under one
 * "counting window" heading, so they have to honour the same window. A survey
 * total that quietly ignored the baseline would sit next to a reset pageview
 * total under a sentence claiming both came from the same date.
 */
export async function readSurveyResponses<T>(sinceIso?: string): Promise<T[]> {
  const base = getDb().select({ response: surveyResponse.response }).from(surveyResponse);
  const rows = await (
    sinceIso ? base.where(gte(surveyResponse.ts, new Date(sinceIso))) : base
  ).orderBy(asc(surveyResponse.ts));
  return rows.map((r) => r.response as T);
}

export async function appendFeedbackResponse(response: unknown): Promise<void> {
  await getDb().insert(feedbackResponse).values({ response });
}

/**
 * Read logged feedback submissions, NEWEST FIRST — the opposite order of the
 * three readers around it, deliberately. Those feed aggregate summaries where
 * order is irrelevant; this one feeds a list of free text a human actually
 * reads, and the useful end of that list is the recent end.
 *
 * `sinceIso` bounds the scan the same way readSurveyResponses does. The admin
 * page threads the analytics baseline through it so the feedback count sits
 * under the same "counting window" sentence as every other figure on the
 * dashboard it links to.
 */
export async function readFeedbackResponses<T>(sinceIso?: string): Promise<T[]> {
  const base = getDb().select({ response: feedbackResponse.response }).from(feedbackResponse);
  const rows = await (
    sinceIso ? base.where(gte(feedbackResponse.ts, new Date(sinceIso))) : base
    // By id, matching readFeedbackResponseRows: ts is transaction_timestamp()
    // and ties are unordered, so ordering by it would reshuffle equal-timestamp
    // rows between reloads.
  ).orderBy(desc(feedbackResponse.id));
  return rows.map((r) => r.response as T);
}

/**
 * Feedback rows WITH the surrogate id that addresses them, newest first.
 *
 * The plain reader above drops the id because a summary doesn't need it. This
 * one keeps it because the admin delete control has to name ONE row, and `id`
 * is the only field that can (see the note on the column in schema.ts — `ts`
 * is transaction_timestamp() and genuinely collides).
 *
 * Ordered by id, not ts, for the same reason: with colliding timestamps, ORDER
 * BY ts has no defined order among them, so "newest first" would shuffle
 * between reloads and paging could show the same row twice while skipping
 * another. id is monotonic per insert, so it is both stable and correct.
 */
export async function readFeedbackResponseRows<T>(
  sinceIso?: string,
): Promise<{ id: number; response: T }[]> {
  const base = getDb()
    .select({ id: feedbackResponse.id, response: feedbackResponse.response })
    .from(feedbackResponse);
  const rows = await (
    sinceIso ? base.where(gte(feedbackResponse.ts, new Date(sinceIso))) : base
  ).orderBy(desc(feedbackResponse.id));
  return rows.map((r) => ({ id: r.id, response: r.response as T }));
}

/**
 * Delete the single feedback row with this id, and report how many rows went.
 * Fulfils a visitor's deletion request against a store with no identifier to
 * look THEM up by (see docs/PRIVACY.md) — the admin finds the row by the
 * wording the visitor quotes, then deletes it by id.
 *
 * The count is returned rather than swallowed so the caller can tell "deleted
 * it" from "it was already gone" — a difference that matters when you are
 * answering the person who asked.
 */
export async function deleteFeedbackResponseById(id: number): Promise<number> {
  const res = await getDb()
    .delete(feedbackResponse)
    .where(eq(feedbackResponse.id, id));
  return mutatedRows(res);
}

/**
 * Feedback rows carrying this address, newest first.
 *
 * The other half of DEC-002: `feedback_response` stopped being a no-identifier
 * store when the widget started offering an optional address, and a store with
 * an identifier owes the person behind it a working access and deletion path.
 *
 * Case-insensitive because the address is whatever a visitor typed. The route
 * lowercases on the way in, so this mostly matters for rows written by an
 * older client or by hand.
 *
 * `= lower(...)` and not `like`: the parameter is a requester-supplied string,
 * and under `like` a `%` in it would match every row in the table. That is a
 * privacy incident wearing a convenience feature's clothes.
 */
export async function findFeedbackByEmail<T>(email: string): Promise<{ id: number; response: T }[]> {
  const res = await getDb().execute(
    sql`SELECT id, response FROM feedback_response
        WHERE lower(response->>'email') = lower(${email})
        ORDER BY id DESC`,
  );
  return rowsOf<{ id: number; response: T }>(res);
}

/**
 * Hard-delete every feedback row carrying this address, and report how many
 * went.
 *
 * A hard delete, not an anonymisation, matching deleteFeedbackResponsesBefore
 * in privacy-retention.ts and for the same reason: the comment text IS the
 * sensitive part here, so a scrubbed shell of the row would keep the risk and
 * lose the point.
 */
export async function deleteFeedbackByEmail(email: string): Promise<number> {
  const res = await getDb().execute(
    sql`DELETE FROM feedback_response
        WHERE lower(response->>'email') = lower(${email})`,
  );
  return mutatedRows(res);
}

export async function appendFerryObservation(obs: unknown): Promise<void> {
  await getDb().insert(ferryObservation).values({ obs });
}

/**
 * Read logged ferry observations, oldest first. `sinceIso` (optional) bounds
 * the scan to rows appended at/after that instant — retention pruning only
 * runs every ~48 writes, so the table can overshoot the 90-day window when
 * crons stall; the busyness aggregator passes its retention cutoff so it never
 * pays for rows pruning will delete anyway. Omitting it reads the full log
 * (the accuracy backtest's behavior, unchanged).
 */
export async function readFerryObservations<T>(sinceIso?: string): Promise<T[]> {
  const base = getDb().select({ obs: ferryObservation.obs }).from(ferryObservation);
  const rows = await (sinceIso ? base.where(gte(ferryObservation.ts, new Date(sinceIso))) : base).orderBy(
    asc(ferryObservation.ts),
  );
  return rows.map((r) => r.obs as T);
}

/** The payload `ts` of the newest ferry observation — data-freshness of the
 *  observe cron, for the ops dashboard. Uses obs->>'ts' (the snapshot instant),
 *  which sorts chronologically as ISO-8601 text; max() over an empty table is
 *  NULL, so this returns null before the cron has ever run. A targeted MAX
 *  query, not a full-log scan. */
export async function latestFerryObservationTs(): Promise<string | null> {
  const [row] = await getDb()
    .select({ ts: sql<string | null>`max(${ferryObservation.obs} ->> 'ts')` })
    .from(ferryObservation);
  return row?.ts ?? null;
}

/** Row counts for the three append tables — the importer's run-once guard
 *  and per-table report need them. */
export async function countAppendRows(): Promise<{
  analytics_event: number;
  survey_response: number;
  ferry_observation: number;
}> {
  const db = getDb();
  const [a] = await db.select({ n: count() }).from(analyticsEvent);
  const [s] = await db.select({ n: count() }).from(surveyResponse);
  const [f] = await db.select({ n: count() }).from(ferryObservation);
  return { analytics_event: a.n, survey_response: s.n, ferry_observation: f.n };
}

/** Retention pruning for ferry observations (the store's existing policy —
 *  delete rows older than the cutoff; returns deleted-row count). */
export async function pruneFerryObservationsBefore(cutoffIso: string): Promise<number> {
  const res = await getDb().execute(
    sql`DELETE FROM ferry_observation WHERE ts < ${cutoffIso}::timestamptz`,
  );
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}
