// Single source of truth for the Postgres schema (E05 substrate).
//
// Migrations are GENERATED from this file via `npm run db:generate`
// (drizzle-kit) into db/migrations/ and applied programmatically at server
// start (src/instrumentation.ts) — never edit checked-in migration files by
// hand; change this file and generate a new migration.
//
// `record` supersedes the old generic `overlay` table: same
// (store, id, doc, deleted) core the merge layer rides on, plus the
// cross-cutting governance columns every record carries from now on.
// The three append tables mirror the old db/schema.sql shapes verbatim —
// analytics/survey/ferry rows migrate as-is (E11 owns any shape changes).

import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** Lifecycle states a structured record can be in. Everything is 'live'
 *  this epic (behavior-preserving); E08 starts writing 'pending' from
 *  submission surfaces. */
export const RECORD_STATUSES = [
  "draft",
  "pending",
  "live",
  "rejected",
  "hidden",
] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

/** Where a record came from. 'sync' + external_id are the AMS seam (E16). */
export const RECORD_SOURCES = [
  "seed",
  "import",
  "admin",
  "portal",
  "public",
  "sync",
] as const;
export type RecordSource = (typeof RECORD_SOURCES)[number];

/** Every structured record in the app: keyed by (store, id), document in
 *  `doc` (stored WITHOUT the `_deleted` marker — the tombstone lives in the
 *  `deleted` column, exactly like the old overlay contract). */
export const record = pgTable(
  "record",
  {
    store: text("store").notNull(),
    id: text("id").notNull(),
    doc: jsonb("doc").$type<Record<string, unknown>>().notNull(),
    deleted: boolean("deleted").notNull().default(false),
    status: text("status").$type<RecordStatus>().notNull().default("live"),
    source: text("source").$type<RecordSource>().notNull().default("admin"),
    externalId: text("external_id"),
    ownerOrgId: text("owner_org_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: text("updated_by"),
  },
  (t) => [
    primaryKey({ columns: [t.store, t.id] }),
    index("record_store_status_idx").on(t.store, t.status),
    check(
      "record_status_check",
      sql`${t.status} IN ('draft', 'pending', 'live', 'rejected', 'hidden')`,
    ),
    check(
      "record_source_check",
      sql`${t.source} IN ('seed', 'import', 'admin', 'portal', 'public', 'sync')`,
    ),
  ],
);

/** Append-only audit trail: one row per create/update/delete/import of a
 *  structured record. A DB trigger (see the custom migration) rejects UPDATE
 *  and DELETE — rows can only ever be inserted. E09 builds the UI on top. */
export const audit = pgTable("audit", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  /** email of the acting user, or 'system' / 'public' / 'import:data-dir'. */
  actor: text("actor").notNull(),
  /** 'create' | 'update' | 'delete' | 'import' */
  action: text("action").notNull(),
  store: text("store").notNull(),
  recordId: text("record_id").notNull(),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  source: text("source").notNull(),
});

/** Records the importer refused to write because they failed schema
 *  validation — kept whole here (with the zod issues) so nothing is silently
 *  dropped. Operators resolve via the runbook's quarantine workflow. */
export const quarantine = pgTable(
  "quarantine",
  {
    store: text("store"),
    id: text("id"),
    doc: jsonb("doc").$type<Record<string, unknown>>(),
    errors: jsonb("errors").notNull(),
    quarantinedAt: timestamp("quarantined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.store, t.id] })],
);

// ---------------------------------------------------------------------------
// Append-only logs — shapes identical to the retired db/schema.sql. These are
// logs, not records: writes bypass the writeRecord choke point and no audit
// rows are emitted for them.
// ---------------------------------------------------------------------------

/** Pageviews, outbound clicks, opt-in geo-pings (src/lib/analytics-store.ts). */
export const analyticsEvent = pgTable("analytics_event", {
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  event: jsonb("event").notNull(),
});

/** Anonymous LTAC survey responses (src/lib/survey-store.ts). */
export const surveyResponse = pgTable("survey_response", {
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  response: jsonb("response").notNull(),
});

/** Edmonds–Kingston sailing-fullness snapshots — irreplaceable dataset (WSF
 *  never archives terminalsailingspace); migrated verbatim, count-verified. */
export const ferryObservation = pgTable("ferry_observation", {
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  obs: jsonb("obs").notNull(),
});
