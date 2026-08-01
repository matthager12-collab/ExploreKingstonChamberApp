// E17 import substrate: the persistent memory of the listings importer.
// Operational metadata in the same posture as worklist_item — these are not
// content records, never live in `record`, and their writes bypass the
// writeRecord choke point (the import_run row IS the audit of a run; every
// record-level write still goes through writeRecord and gets audit rows).
//
// Re-exported from ./schema (the aggregation point) exactly like auth-schema
// and worklist-schema, so drizzle-kit and client.ts both see it.

import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** One row per resolved (source, external_id) → local record mapping — the
 *  dedupe decision, remembered. Once a Qwick row is matched (or created),
 *  re-runs resolve it here first and never re-guess. Source-generic on
 *  purpose ('qwick' today) so the E16 GrowthZone-migration importer may
 *  reuse the shape (wiring is E16's, not E17's). */
export const listingAlias = pgTable(
  "listing_alias",
  {
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    /** Store name of the local record ("restaurants", "directory", ...) —
     *  same vocabulary as record.store / STORE_SCHEMAS keys. */
    subjectStore: text("subject_store").notNull(),
    subjectId: text("subject_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [uniqueIndex("listing_alias_source_external_uniq").on(t.source, t.externalId)],
);

export type ListingAliasRow = typeof listingAlias.$inferSelect;

/** One row per importer run (dry-run or apply): counts + the full bucketed
 *  plan, so the preview/confirm UI and the paper trail need no re-planning. */
export const importRun = pgTable("import_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(),
  mode: text("mode").$type<"dry_run" | "apply">().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  runBy: text("run_by").notNull(),
  /** Counts per bucket: { created, updated, unchanged, matched, quarantined,
   *  deletedUpstream } — the shape planQwickImport's stats() returns. */
  stats: jsonb("stats").$type<Record<string, number>>().notNull(),
  /** The full plan: per-bucket row lists with per-field diffs. */
  report: jsonb("report").$type<Record<string, unknown>>().notNull(),
});

export type ImportRunRow = typeof importRun.$inferSelect;
