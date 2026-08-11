// E08 worklist substrate: ONE generic queue table that powers five consumers —
// moderation of member/public submissions, AMS sync conflicts (producer E16),
// staleness re-verification, report-inaccurate feedback, and privacy requests
// (producer E11). Queue rows are operational metadata, NOT content records:
// they live in their own table, never in `record`, and their payloads are
// validated by src/lib/schemas/worklist.ts (not STORE_SCHEMAS).
//
// Re-exported from ./schema (the aggregation point) exactly like auth-schema,
// so drizzle-kit and client.ts both see it.

import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Type-only on purpose: the runtime consts (WORKLIST_TYPES / WORKLIST_STATES)
// live in src/lib/schemas/worklist.ts with the payload schemas, and a type-only
// import is erased at compile so drizzle-kit's schema loader never has to
// resolve app-alias imports. The CHECK constraints below repeat the literals —
// the schema tests assert the two lists stay identical.
import type { WorklistState, WorklistType } from "../schemas/worklist";

export const worklistItem = pgTable(
  "worklist_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").$type<WorklistType>().notNull(),
    /** Store name of the subject record ("restaurants", "events", ...) —
     *  same vocabulary as record.store / STORE_SCHEMAS keys. */
    subjectStore: text("subject_store").notNull(),
    subjectId: text("subject_id").notNull(),
    /** Denormalized human name for the queue list — the subject record may be
     *  pending/deleted, so the list must not need a join to render. */
    subjectLabel: text("subject_label").notNull(),
    state: text("state").$type<WorklistState>().notNull().default("open"),
    assigneeUserId: text("assignee_user_id"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    /** Per-type shape, validated by src/lib/schemas/worklist.ts. For
     *  moderation edits this holds the full proposed record — the live
     *  content record is NEVER touched until approval. */
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    resolution: text("resolution"),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** User id of the creator; null = anonymous public or system sweep. */
    createdBy: text("created_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
  },
  (t) => [
    // One ACTIVE item per (type, subject): a second report merges into the
    // open item, and the staleness sweep is idempotent for free.
    uniqueIndex("worklist_item_active_subject_uniq")
      .on(t.type, t.subjectStore, t.subjectId)
      .where(sql`${t.state} IN ('open', 'in_progress')`),
    index("worklist_item_state_type_idx").on(t.state, t.type),
    check(
      "worklist_item_type_check",
      sql`${t.type} IN ('moderation', 'sync_conflict', 'staleness', 'report_inaccurate', 'privacy_request', 'claim_request', 'claim_signup')`,
    ),
    check(
      "worklist_item_state_check",
      sql`${t.state} IN ('open', 'in_progress', 'resolved', 'dismissed')`,
    ),
  ],
);

export type WorklistItemRow = typeof worklistItem.$inferSelect;
