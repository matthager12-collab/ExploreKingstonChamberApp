// Database seam for the Vercel deployment.
//
// Local dev writes to the filesystem (see data-dir.ts); production writes to
// Neon Postgres. Every store module branches on hasDb(): when DATABASE_URL is
// set (prod / a configured dev), it uses the SQL path below; otherwise it uses
// the original .data/ filesystem code. Nothing above the store modules changes.
//
// Driver: @neondatabase/serverless neon() — an HTTP tagged-template client
// that is stateless per query (no TCP pool to leak across serverless
// invocations). Use the POOLED DATABASE_URL (host contains "-pooler").
//
// LEGACY (E05): this module and its lazy ensureSchema() are being retired —
// the schema's source of truth is now src/lib/db/schema.ts + generated
// db/migrations/ applied at boot. Kept until the store layer cutover lands;
// do not add new callers.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/** True when a Postgres database is configured (prod). */
export function hasDb(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

let client: NeonQueryFunction<false, false> | null = null;

/** The shared neon() SQL client. Throws if DATABASE_URL is unset — callers
 *  must gate on hasDb() first. */
export function db(): NeonQueryFunction<false, false> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — db() called without hasDb() guard");
  }
  if (!client) client = neon(process.env.DATABASE_URL);
  return client;
}

// The three tables that back every store. One generic overlay table serves all
// portal-editable collections (custom-wins-by-id over the git seed arrays) plus
// auth; two append tables hold the analytics and survey logs. (The old
// db/schema.sql twin of this list is deleted — E05 migrations own DDL now.)
// The neon() HTTP driver runs ONE statement
// per call, so each CREATE runs separately (all idempotent via IF NOT EXISTS).
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS overlay (
     store   text NOT NULL,
     id      text NOT NULL,
     doc     jsonb NOT NULL,
     deleted boolean NOT NULL DEFAULT false,
     PRIMARY KEY (store, id)
   )`,
  `CREATE TABLE IF NOT EXISTS analytics_event (
     ts    timestamptz NOT NULL DEFAULT now(),
     event jsonb NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS survey_response (
     ts       timestamptz NOT NULL DEFAULT now(),
     response jsonb NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS ferry_observation (
     ts  timestamptz NOT NULL DEFAULT now(),
     obs jsonb NOT NULL
   )`,
];

let schemaReady: Promise<void> | null = null;

/** Idempotently create the tables. Memoized per process so it runs at most
 *  once per warm instance. Safe to call before any query. */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    const sql = db();
    schemaReady = (async () => {
      for (const stmt of SCHEMA_STATEMENTS) await sql.query(stmt);
    })();
    // If setup fails, let the next call retry rather than caching the rejection.
    schemaReady.catch(() => {
      schemaReady = null;
    });
  }
  return schemaReady;
}
