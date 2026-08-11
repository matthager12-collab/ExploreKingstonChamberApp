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
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

// E06 auth tables (users/orgs/invites) live in their own file. Re-exported
// here because this module is the schema aggregation point: client.ts does
// `import * as schema from "./schema"` and drizzle.config.ts generates from
// this path, so a re-export is what makes those tables real to both.
export * from "./auth-schema";

// E08 worklist queue (moderation / staleness / reports / sync / privacy).
export * from "./worklist-schema";

// E17 importer substrate (listing_alias dedupe memory + import_run reports).
export * from "./import-schema";

// E17 claim-signup slice (roster-email matching + pending code verification).
export * from "./claim-schema";
export * from "./volunteer-signup-schema";

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
    /** E08 staleness engine: when a human last confirmed this record is still
     *  accurate, and how many days before it is due again. Null interval =
     *  the store's STALENESS_DEFAULTS entry (or exempt, e.g. events). */
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    verifyIntervalDays: integer("verify_interval_days"),
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
export const audit = pgTable(
  "audit",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    /** email of the acting user, or 'system' / 'public' / 'import:data-dir'. */
    actor: text("actor").notNull(),
    /** 'create' | 'update' | 'delete' | 'import' | 'restore' (E09), plus
     *  'status-change' / 'verify' (E08) and the auth lifecycle events
     *  (auth-store.ts). Only full-snapshot actions are restorable — see
     *  src/lib/audit/restore-registry.ts. */
    action: text("action").notNull(),
    store: text("store").notNull(),
    recordId: text("record_id").notNull(),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    source: text("source").notNull(),
  },
  (t) => [
    // E09: the table grows forever (≥12-month retention floor), so the two
    // read paths must be indexed — per-record history (store, record_id, id:
    // the trailing id serves the ORDER BY id DESC page straight off the
    // index) and time-filtered global browsing (ts). Cursor paging rides id.
    index("audit_store_record_idx").on(t.store, t.recordId, t.id),
    index("audit_ts_idx").on(t.ts),
  ],
);

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

/**
 * "I'm going" tallies for LTAC reporting.
 *
 * A COUNT per (event, ZIP) — never a row per visitor. There is no session id,
 * no coordinate, no user agent, no timestamp of an individual tap: nothing
 * here can be traced to a person because nothing here is ABOUT a person. That
 * is the whole design, and it is why this table needs no delete-by-identifier
 * path (see noIdentifierStore in src/lib/privacy/pii-inventory.ts).
 *
 * The ZIP is SELF-REPORTED and optional — an empty string means the visitor
 * tapped without answering, which still counts toward attendance. It is not
 * derived from a coordinate or an IP: browser geolocation reports where
 * someone is standing, and IP geolocation is wrong at ZIP level
 * (src/lib/analytics-store.ts), while LTAC needs where they travelled FROM.
 * Asking is the only method that answers the question being asked.
 *
 * `updatedAt` is the retention clock for the whole tally, not a record of when
 * any one person tapped.
 */
export const eventGoing = pgTable(
  "event_going",
  {
    eventId: text("event_id").notNull(),
    /** 5-digit ZIP, or "" when the visitor skipped the question. */
    zip: text("zip").notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.zip] }),
    index("event_going_event_idx").on(t.eventId),
  ],
);

/** Edmonds–Kingston sailing-fullness snapshots — irreplaceable dataset (WSF
 *  never archives terminalsailingspace); migrated verbatim, count-verified. */
export const ferryObservation = pgTable("ferry_observation", {
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  obs: jsonb("obs").notNull(),
});

/** In-app "Give feedback" side-tab submissions: a 1–5 star rating, one open
 *  text answer, and the in-app path it was sent from
 *  (src/lib/feedback-store.ts).
 *
 *  Same log posture as the three above — no audit rows, no writeRecord — but
 *  NOT structurally anonymous the way survey_response is: the comment is free
 *  text a visitor can type anything into, including their own name or phone
 *  number. That is why it carries a 12-month window in RETENTION_POLICY (the
 *  shortest of any store here) rather than the survey's 36, and why the route
 *  never accepts a contact field. See docs/PRIVACY.md. */
export const feedbackResponse = pgTable("feedback_response", {
  /** Surrogate key — the ONLY thing in this table that uniquely addresses a
   *  row. The three logs above have no key because nothing ever deletes ONE of
   *  their rows; this one does, because the privacy notice promises a visitor
   *  their comment can be removed on request.
   *
   *  `ts` cannot serve that purpose: `DEFAULT now()` is
   *  transaction_timestamp(), so two rows written in the same instant are
   *  genuinely indistinguishable by it — and an admin deleting one comment
   *  would silently take the other visitor's with it. That is a data-loss bug
   *  wearing a privacy feature's clothes, so the key is explicit. */
  id: bigserial("id", { mode: "number" }).primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  response: jsonb("response").notNull(),
});

// ---------------------------------------------------------------------------
// E11 privacy tables.
// ---------------------------------------------------------------------------

/** Monthly area rollups the retention purge distills raw geo-pings into —
 *  E18's LTAC read surface (the (month, area, pings, sessions) shape is a
 *  contract). K-FLOORED AT WRITE TIME: a row with sessions < K_FLOOR is never
 *  written; those merge into the month's below-threshold row — so a purged
 *  month can never leak a small cell later. `month` is the Pacific-time
 *  "YYYY-MM" (matches summarize()'s pacificDay bucketing). */
export const analyticsAreaRollup = pgTable(
  "analytics_area_rollup",
  {
    month: text("month").notNull(),
    area: text("area").notNull(),
    pings: integer("pings").notNull(),
    sessions: integer("sessions").notNull(),
  },
  (t) => [primaryKey({ columns: [t.month, t.area] })],
);

/** Legal-hold markers (E11, FR-A92): a held (store, record_id) is excluded
 *  from BOTH retention purges and consumer-deletion fulfillment; the refusal
 *  is logged instead (the MHMDA-delete vs records-retention reconciliation).
 *  Generic on purpose — E16 membership records and E30 applications inherit
 *  this table rather than growing per-table columns (re-charter Delta 3). */
export const legalHold = pgTable(
  "legal_hold",
  {
    store: text("store").notNull(),
    recordId: text("record_id").notNull(),
    reason: text("reason").notNull(),
    setBy: text("set_by").notNull(),
    setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.store, t.recordId] })],
);

// ---------------------------------------------------------------------------
// E13 offline/PWA tables.
// ---------------------------------------------------------------------------

/** Idempotency claims for the offline outbox (E13). Operational metadata in the
 *  same posture as worklist_item and the append-only logs: writes bypass the
 *  writeRecord choke point and emit NO audit rows — a dedupe claim is not a
 *  record edit and an audit row per replayed POST would be pure noise.
 *  Keys are random UUIDs minted client-side; they are never derived from or
 *  joined to any user identifier (MHMDA floor), so this table holds no personal
 *  data and needs no PII_STORES entry. Rows are swept after 30 days by an
 *  opportunistic prune in src/lib/db/idempotency.ts (documented in docs/PWA.md,
 *  deliberately NOT in RETENTION_POLICY — that manifest is an ask-first human
 *  floor rendered on /privacy). Transient dedupe state with zero restore value:
 *  not part of the backup bundle. */
export const idempotencyKeys = pgTable("idempotency_keys", {
  key: varchar("key", { length: 64 }).primaryKey(),
  scope: text("scope").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
