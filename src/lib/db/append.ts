// Typed access to the three append-only log tables (E05). These are logs,
// not records: they bypass the writeRecord choke point and write no audit
// rows — same posture as before, minus the dual backend. Lives inside
// src/lib/db/** because only the data layer may touch the DB client (eslint
// no-restricted-imports + dependency-cruiser enforce it); the store modules
// (analytics-store, survey-store, ferry-observations) call these helpers.

import "server-only";

import { asc, count, sql } from "drizzle-orm";

import { getDb } from "./client";
import { analyticsEvent, ferryObservation, surveyResponse } from "./schema";

export async function appendAnalyticsEvent(event: unknown): Promise<void> {
  await getDb().insert(analyticsEvent).values({ event });
}

export async function readAnalyticsEvents<T>(): Promise<T[]> {
  const rows = await getDb()
    .select({ event: analyticsEvent.event })
    .from(analyticsEvent)
    .orderBy(asc(analyticsEvent.ts));
  return rows.map((r) => r.event as T);
}

export async function appendSurveyResponse(response: unknown): Promise<void> {
  await getDb().insert(surveyResponse).values({ response });
}

export async function readSurveyResponses<T>(): Promise<T[]> {
  const rows = await getDb()
    .select({ response: surveyResponse.response })
    .from(surveyResponse)
    .orderBy(asc(surveyResponse.ts));
  return rows.map((r) => r.response as T);
}

export async function appendFerryObservation(obs: unknown): Promise<void> {
  await getDb().insert(ferryObservation).values({ obs });
}

export async function readFerryObservations<T>(): Promise<T[]> {
  const rows = await getDb()
    .select({ obs: ferryObservation.obs })
    .from(ferryObservation)
    .orderBy(asc(ferryObservation.ts));
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
