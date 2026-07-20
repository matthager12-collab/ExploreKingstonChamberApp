// A 3-state DB status probe for the ops dashboard (E10 §5). Lives inside
// src/lib/db/** because only the data layer may import the client (eslint
// no-restricted-imports + dependency-cruiser) — the ops page imports THIS, not
// getDb.
//
// Deliberately separate from dbHealthy() (records.ts), which the /api/health
// readiness gate owns: that one is memoized ~60s and collapses "unconfigured"
// into false. The ops page needs the three-way OK / DOWN / UNKNOWN split and its
// own short timeout so a hung Neon never stalls the page render.
import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "./client";

export type DbProbe = "ok" | "down" | "unknown";

/**
 * "unknown" when DATABASE_URL is unset (getDb() would throw); "ok" on a SELECT 1
 * that resolves within `timeoutMs`; "down" on any error or timeout. Never throws.
 * The timeout bounds how long the page WAITS — it does not cancel the underlying
 * query, which is fine for a status tile.
 */
export async function probeDb(timeoutMs = 3000): Promise<DbProbe> {
  if (!process.env.DATABASE_URL) return "unknown";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getDb().execute(sql`SELECT 1`),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("db probe timeout")), timeoutMs);
      }),
    ]);
    return "ok";
  } catch {
    return "down";
  } finally {
    if (timer) clearTimeout(timer);
  }
}
