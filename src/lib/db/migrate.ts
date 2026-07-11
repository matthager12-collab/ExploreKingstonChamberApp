// Boot-time migration runner (E05). Replaces the old lazy ensureSchema():
// checked-in migrations under db/migrations/ are the ONLY thing that creates
// or alters tables. Called from src/instrumentation.ts register() before the
// server takes traffic; the Dockerfile COPYs db/migrations into the standalone
// image (Next's file tracer does not bundle runtime-read .sql files).

import "server-only";

import path from "node:path";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { getDb } from "./client";

let applied: Promise<void> | null = null;

/** Apply pending migrations exactly once per process. No-op when
 *  DATABASE_URL is unset (CI build, unit tests, a dev without a DB yet).
 *  A failure rejects — and should: serving traffic against a half-migrated
 *  schema is worse than failing the boot, and Render keeps routing to the
 *  previous release until /api/health goes 200. */
export function runMigrations(): Promise<void> {
  if (!process.env.DATABASE_URL) return Promise.resolve();
  if (!applied) {
    applied = migrate(getDb(), {
      migrationsFolder: path.join(process.cwd(), "db", "migrations"),
    });
    // If it failed, let a later call retry instead of caching the rejection
    // (matters in dev where the server restarts in-process).
    applied.catch(() => {
      applied = null;
    });
  }
  return applied;
}
