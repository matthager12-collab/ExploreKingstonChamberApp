// Typed access to the three append-only log tables (E05). These are logs,
// not records: they bypass the writeRecord choke point and write no audit
// rows — same posture as before, minus the dual backend. Lives inside
// src/lib/db/** because only the data layer may touch the DB client (eslint
// no-restricted-imports + dependency-cruiser enforce it); the store modules
// (analytics-store, survey-store, ferry-observations) call these helpers.

import "server-only";

import { asc, sql } from "drizzle-orm";

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

/** Retention pruning for ferry observations (the store's existing policy —
 *  delete rows older than the cutoff; returns deleted-row count). */
export async function pruneFerryObservationsBefore(cutoffIso: string): Promise<number> {
  const res = await getDb().execute(
    sql`DELETE FROM ferry_observation WHERE ts < ${cutoffIso}::timestamptz`,
  );
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}
