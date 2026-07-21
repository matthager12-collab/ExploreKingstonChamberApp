// E11 retention purge — data-layer half. The orchestrator
// (src/lib/privacy/retention.ts) decides WHAT the policy manifest means;
// this module owns the SQL. Lives in src/lib/db/** (client fence).
//
// GEO-PING ROLLUP INVARIANT: rollups are computed over COMPLETE Pacific
// months only, and always from the month's FULL raw event set — never a
// partial batch — because distinct-session counts cannot be merged
// additively across batches without double-counting. A month is processed
// when (a) it is calendar-complete in America/Los_Angeles and (b) at least
// one of its geo-pings has aged past the retention cutoff; the WHOLE month
// is then rolled up (k-floor applied at write: below-floor areas merge into
// the month's below-threshold row) and ALL of its geo-pings deleted, in one
// transaction. Some events die younger than the window — early deletion is
// privacy-positive and the rollup preserves the aggregate. The upsert is
// idempotent (crash between insert and delete → re-run recomputes the same
// rows from the still-present raw events and overwrites).

import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "./client";
import { analyticsAreaRollup } from "./schema";

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? []) as T[];
}

function mutated(res: unknown): number {
  const r = res as { rowCount?: number; affectedRows?: number };
  return r.rowCount ?? r.affectedRows ?? 0;
}

const PACIFIC_MONTH_SQL = sql.raw(
  `to_char(ts AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM')`,
);

/** Current Pacific "YYYY-MM" — months >= this are incomplete, never rolled. */
export function pacificMonth(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
  })
    .format(now)
    .slice(0, 7);
}

/** Complete Pacific months holding at least one geo-ping older than the
 *  cutoff — the months the purge will roll up and delete. */
export async function expiredGeoPingMonths(cutoffIso: string, now: Date): Promise<string[]> {
  const current = pacificMonth(now);
  const res = await getDb().execute(
    sql`SELECT DISTINCT ${PACIFIC_MONTH_SQL} AS month
        FROM analytics_event
        WHERE event ->> 'type' = 'geo-ping' AND ts < ${cutoffIso}::timestamptz
        ORDER BY month`,
  );
  return rows<{ month: string }>(res)
    .map((r) => r.month)
    .filter((m) => m < current);
}

/** Count geo-pings in the given complete months (dry-run reporting). */
export async function countGeoPingsInMonths(months: string[]): Promise<number> {
  if (months.length === 0) return 0;
  const list = sql.join(
    months.map((m) => sql`${m}`),
    sql`, `,
  );
  const res = await getDb().execute(
    sql`SELECT count(*)::int AS n FROM analytics_event
        WHERE event ->> 'type' = 'geo-ping' AND ${PACIFIC_MONTH_SQL} IN (${list})`,
  );
  return rows<{ n: number }>(res)[0]?.n ?? 0;
}

/**
 * Roll up ONE complete Pacific month of geo-pings and delete its raw events,
 * transactionally. K-floor at write: areas with fewer than `k` distinct
 * sessions merge into `belowBucket` (pings summed, sessions = distinct union
 * across the merged areas). Returns the rollup rows written + events deleted.
 */
export async function rollupAndDeleteMonth(
  month: string,
  k: number,
  belowBucket: string,
): Promise<{ rollupRows: number; deletedEvents: number }> {
  const db = getDb();
  let rollupRows = 0;
  let deletedEvents = 0;

  await db.transaction(async (tx) => {
    const evRes = await tx.execute(
      sql`SELECT event ->> 'area' AS area, event ->> 'sessionId' AS session_id
          FROM analytics_event
          WHERE event ->> 'type' = 'geo-ping' AND ${PACIFIC_MONTH_SQL} = ${month}`,
    );
    const events = rows<{ area: string | null; session_id: string | null }>(evRes);
    if (events.length === 0) return;

    const byArea = new Map<string, { pings: number; sessions: Set<string> }>();
    for (const e of events) {
      const area = e.area ?? "outside-uga";
      const entry = byArea.get(area) ?? { pings: 0, sessions: new Set<string>() };
      entry.pings++;
      if (e.session_id) entry.sessions.add(e.session_id);
      byArea.set(area, entry);
    }

    // K-floor at write time (the whole point of rolling up at the source:
    // a purged month can never leak a small cell later).
    const kept: { area: string; pings: number; sessions: number }[] = [];
    const belowPings = { pings: 0, sessions: new Set<string>() };
    let hadBelow = false;
    for (const [area, entry] of byArea) {
      if (entry.sessions.size >= k) {
        kept.push({ area, pings: entry.pings, sessions: entry.sessions.size });
      } else {
        hadBelow = true;
        belowPings.pings += entry.pings;
        entry.sessions.forEach((s) => belowPings.sessions.add(s));
      }
    }
    if (hadBelow) {
      kept.push({
        area: belowBucket,
        pings: belowPings.pings,
        sessions: belowPings.sessions.size,
      });
    }

    for (const row of kept) {
      await tx
        .insert(analyticsAreaRollup)
        .values({ month, area: row.area, pings: row.pings, sessions: row.sessions })
        .onConflictDoUpdate({
          target: [analyticsAreaRollup.month, analyticsAreaRollup.area],
          set: { pings: row.pings, sessions: row.sessions },
        });
    }
    rollupRows = kept.length;

    const delRes = await tx.execute(
      sql`DELETE FROM analytics_event
          WHERE event ->> 'type' = 'geo-ping' AND ${PACIFIC_MONTH_SQL} = ${month}`,
    );
    deletedEvents = mutated(delRes);
  });

  return { rollupRows, deletedEvents };
}

const NON_GEO_TYPES = ["pageview", "outbound", "consent"] as const;

function nonGeoTypeList() {
  return sql.join(
    NON_GEO_TYPES.map((t) => sql`${t}`),
    sql`, `,
  );
}

/** Count pageview/outbound/consent events older than the cutoff. */
export async function countNonGeoEventsBefore(cutoffIso: string): Promise<number> {
  const res = await getDb().execute(
    sql`SELECT count(*)::int AS n FROM analytics_event
        WHERE event ->> 'type' IN (${nonGeoTypeList()}) AND ts < ${cutoffIso}::timestamptz`,
  );
  return rows<{ n: number }>(res)[0]?.n ?? 0;
}

/** Delete pageview/outbound/consent events older than the cutoff. */
export async function deleteNonGeoEventsBefore(cutoffIso: string): Promise<number> {
  const res = await getDb().execute(
    sql`DELETE FROM analytics_event
        WHERE event ->> 'type' IN (${nonGeoTypeList()}) AND ts < ${cutoffIso}::timestamptz`,
  );
  return mutated(res);
}

export async function countSurveyResponsesBefore(cutoffIso: string): Promise<number> {
  const res = await getDb().execute(
    sql`SELECT count(*)::int AS n FROM survey_response WHERE ts < ${cutoffIso}::timestamptz`,
  );
  return rows<{ n: number }>(res)[0]?.n ?? 0;
}

export async function deleteSurveyResponsesBefore(cutoffIso: string): Promise<number> {
  const res = await getDb().execute(
    sql`DELETE FROM survey_response WHERE ts < ${cutoffIso}::timestamptz`,
  );
  return mutated(res);
}

/** Rollup rows, ordered — E18's read path and the tests use this. */
export async function readAreaRollups(): Promise<
  { month: string; area: string; pings: number; sessions: number }[]
> {
  const db = getDb();
  return db
    .select()
    .from(analyticsAreaRollup)
    .orderBy(analyticsAreaRollup.month, analyticsAreaRollup.area);
}
