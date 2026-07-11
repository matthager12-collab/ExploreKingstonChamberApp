// The one place a Postgres connection is created (E05 substrate).
//
// Everything above the data layer talks to src/lib/db/records.ts; only
// src/lib/db/** may import this module (enforced by eslint
// no-restricted-imports + a dependency-cruiser rule). `server-only` poisons
// any accidental client-component import at build time.
//
// Driver: node-postgres Pool over the POOLED Neon DATABASE_URL (host contains
// "-pooler"). Render runs one long-lived Node process, so a small TCP pool —
// not the per-request HTTP client the old serverless seam used — is correct.
// DDL is owned by checked-in migrations (db/migrations/, applied at boot by
// src/instrumentation.ts); there is deliberately no lazy schema creation here.

import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

let cached: Db | null = null;

/** The shared Drizzle instance. Throws (with the env var named) when
 *  DATABASE_URL is unset — the substrate has no filesystem fallback. */
export function getDb(): Db {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set — structured data lives in Postgres (E05). " +
        "Local dev: point DATABASE_URL at a Neon dev branch or a local " +
        "`docker run postgres:16` (see docs/OPERATIONS.md §1).",
    );
  }
  if (!cached) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
    });
    cached = drizzle(pool, { schema });
  }
  return cached;
}
