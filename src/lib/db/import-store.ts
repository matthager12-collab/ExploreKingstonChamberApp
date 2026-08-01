// Data-layer access for the E17 importer substrate (listing_alias +
// import_run). Lives under src/lib/db because ONLY the db layer may touch
// client.ts (dependency-cruiser rule db-client-only-via-db-layer) —
// src/lib/import/qwick.ts goes through these functions.

import { desc, eq } from "drizzle-orm";
import { getDb } from "./client";
import { importRun, listingAlias } from "./import-schema";

export type AliasInput = {
  source: string;
  externalId: string;
  subjectStore: string;
  subjectId: string;
  createdBy: string;
};

export async function listAliases(source: string) {
  const db = getDb();
  return db.select().from(listingAlias).where(eq(listingAlias.source, source));
}

/** Idempotent: a (source, external_id) that already exists is left alone —
 *  an alias is a decision record, never silently rewritten. */
export async function insertAlias(alias: AliasInput): Promise<void> {
  const db = getDb();
  await db.insert(listingAlias).values(alias).onConflictDoNothing();
}

export async function insertImportRunRow(row: {
  source: string;
  mode: "dry_run" | "apply";
  runBy: string;
  stats: Record<string, number>;
  report: Record<string, unknown>;
}): Promise<string> {
  const db = getDb();
  const [inserted] = await db
    .insert(importRun)
    .values({ ...row, finishedAt: new Date() })
    .returning({ id: importRun.id });
  return inserted.id;
}

export async function listImportRunRows(source: string, limit = 20) {
  const db = getDb();
  return db
    .select()
    .from(importRun)
    .where(eq(importRun.source, source))
    .orderBy(desc(importRun.startedAt))
    .limit(limit);
}
