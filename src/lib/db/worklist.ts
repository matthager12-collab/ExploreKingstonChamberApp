// Data layer for the E08 worklist_item queue.
//
// Why this lives under src/lib/db/ and not src/lib/stores/: only src/lib/db/**
// may import the Postgres client (dependency-cruiser `db-client-only-via-db-layer`
// + the eslint no-restricted-imports twin). src/lib/stores/worklist-store.ts is
// the domain API on top of this, exactly as the content stores delegate to
// records.ts via json-store.ts.
//
// This module, records.ts, and auth-store.ts are the ONLY writers of the
// append-only `audit` table. Every worklist mutation and its audit row go in
// ONE transaction — a moderation decision that committed without its trail
// would be worse than one that failed outright.
//
// Dedupe contract: the DB's partial unique index
// worklist_item_active_subject_uniq allows at most one open/in_progress item
// per (type, subject_store, subject_id). createWorklistItem upserts against
// it — a second report on the same record merges into the open item, and the
// staleness sweep is idempotent for free.

import "server-only";

import { and, asc, count, eq, inArray, isNull, lt } from "drizzle-orm";

import {
  validateWorklistPayload,
  WORKLIST_RESOLUTIONS,
  WORKLIST_STATES,
  WORKLIST_TYPES,
  WorklistValidationError,
  type WorklistState,
  type WorklistType,
} from "@/lib/schemas/worklist";

import { getDb, type Db } from "./client";
import { audit, worklistItem, type WorklistItemRow } from "./schema";

export type { WorklistItemRow };

/** Any Drizzle handle — the shared client or an open transaction. */
type Handle = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** States that count as "active" for the one-item-per-subject rule. */
const ACTIVE_STATES: readonly WorklistState[] = ["open", "in_progress"];

/** Worklist lifecycle events on the shared audit trail. audit.action is free
 *  text (no check constraint), so E08 extends the vocabulary like E06 did. */
export type WorklistAuditAction =
  | "worklist-create"
  | "worklist-update"
  | "worklist-claim"
  | "worklist-due"
  | "worklist-resolve"
  | "worklist-dismiss";

/** Who performed a worklist mutation. `system` = the staleness sweep or other
 *  unattended producers (audit.source has no check constraint; the record
 *  table's source vocabulary does not apply here). */
export type WorklistWriteMeta = {
  actor?: string;
  source?: "admin" | "portal" | "public" | "system";
};

/** The item fields allowed into an audit row. Payload rides along whole: it
 *  holds proposed records and report messages — content, not secrets — and
 *  the audit trail is exactly where a rejected proposal should survive. */
export function auditableWorklistItem(row: WorklistItemRow): Record<string, unknown> {
  return {
    id: row.id,
    type: row.type,
    subjectStore: row.subjectStore,
    subjectId: row.subjectId,
    subjectLabel: row.subjectLabel,
    state: row.state,
    assigneeUserId: row.assigneeUserId,
    dueAt: row.dueAt?.toISOString() ?? null,
    payload: row.payload,
    resolution: row.resolution,
    resolutionNote: row.resolutionNote,
    createdBy: row.createdBy,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedBy: row.resolvedBy,
  };
}

async function appendWorklistAudit(
  h: Handle,
  entry: {
    actor: string;
    action: WorklistAuditAction;
    recordId: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    source: string;
  },
): Promise<void> {
  await h.insert(audit).values({
    actor: entry.actor,
    action: entry.action,
    store: "worklist",
    recordId: entry.recordId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    source: entry.source,
  });
}

export type CreateWorklistInput = {
  type: WorklistType;
  subjectStore: string;
  subjectId: string;
  subjectLabel: string;
  payload: Record<string, unknown>;
  /** User id of the creator; omit for anonymous public or system producers. */
  createdBy?: string;
  dueAt?: Date;
  assigneeUserId?: string;
};

export type CreateWorklistResult = {
  item: WorklistItemRow;
  /** false = an active item already existed and this call merged into it —
   *  the sweep uses this to report create-vs-skip counts. */
  created: boolean;
};

/** How a second submission folds into an already-active item, per type:
 *  - report_inaccurate: append the new messages, count = total messages;
 *  - staleness: pure no-op (the sweep re-finds the same overdue record);
 *  - moderation (and the E11/E16 fixture types): the newest payload replaces
 *    the old — a member who edits twice before review means the second
 *    version; the superseded proposal survives in the audit row.  */
function mergePayloads(
  type: WorklistType,
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> | null {
  if (type === "staleness") return null;
  if (type === "report_inaccurate") {
    const prior = Array.isArray(existing.messages) ? existing.messages : [];
    const added = Array.isArray(incoming.messages) ? incoming.messages : [];
    const messages = [...prior, ...added];
    return { messages, count: messages.length };
  }
  return incoming;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    ((err as { code?: string }).code === "23505" ||
      String((err as { message?: string }).message ?? "").includes(
        "worklist_item_active_subject_uniq",
      ))
  );
}

/** Create a worklist item, or merge into the subject's active item of the
 *  same type. Payloads (incoming AND merged) are schema-validated; throws
 *  WorklistValidationError on shape failures. */
export async function createWorklistItem(
  input: CreateWorklistInput,
  meta?: WorklistWriteMeta,
): Promise<CreateWorklistResult> {
  const payload = validateWorklistPayload(input.type, input.payload);
  const db = getDb();
  const actor = meta?.actor ?? "system";
  const source = meta?.source ?? "system";

  const attempt = (): Promise<CreateWorklistResult> =>
    db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(worklistItem)
        .where(
          and(
            eq(worklistItem.type, input.type),
            eq(worklistItem.subjectStore, input.subjectStore),
            eq(worklistItem.subjectId, input.subjectId),
            inArray(worklistItem.state, [...ACTIVE_STATES]),
          ),
        )
        .for("update");

      if (existing) {
        const merged = mergePayloads(input.type, existing.payload, payload);
        if (merged === null) return { item: existing, created: false };
        const valid = validateWorklistPayload(input.type, merged);
        const [row] = await tx
          .update(worklistItem)
          .set({
            payload: valid,
            subjectLabel: input.subjectLabel,
            updatedAt: new Date(),
          })
          .where(eq(worklistItem.id, existing.id))
          .returning();
        await appendWorklistAudit(tx, {
          actor,
          action: "worklist-update",
          recordId: row.id,
          before: auditableWorklistItem(existing),
          after: auditableWorklistItem(row),
          source,
        });
        return { item: row, created: false };
      }

      const [row] = await tx
        .insert(worklistItem)
        .values({
          type: input.type,
          subjectStore: input.subjectStore,
          subjectId: input.subjectId,
          subjectLabel: input.subjectLabel,
          payload,
          createdBy: input.createdBy ?? null,
          dueAt: input.dueAt ?? null,
          assigneeUserId: input.assigneeUserId ?? null,
        })
        .returning();
      await appendWorklistAudit(tx, {
        actor,
        action: "worklist-create",
        recordId: row.id,
        after: auditableWorklistItem(row),
        source,
      });
      return { item: row, created: true };
    });

  try {
    return await attempt();
  } catch (err) {
    // Two concurrent creates can both miss the FOR UPDATE select and race the
    // partial unique index; the loser retries once and lands on the merge path.
    if (isUniqueViolation(err)) return attempt();
    throw err;
  }
}

export type WorklistFilters = {
  type?: WorklistType;
  state?: WorklistState | WorklistState[];
  assigneeUserId?: string;
  unassignedOnly?: boolean;
  overdueOnly?: boolean;
  subjectStore?: string;
};

/** Queue list, ordered due-first (nulls last), then oldest-created first. */
export async function listWorklistItems(
  filters: WorklistFilters = {},
): Promise<WorklistItemRow[]> {
  const conds = [];
  if (filters.type) conds.push(eq(worklistItem.type, filters.type));
  if (filters.state) {
    conds.push(
      Array.isArray(filters.state)
        ? inArray(worklistItem.state, filters.state)
        : eq(worklistItem.state, filters.state),
    );
  }
  if (filters.assigneeUserId) conds.push(eq(worklistItem.assigneeUserId, filters.assigneeUserId));
  if (filters.unassignedOnly) conds.push(isNull(worklistItem.assigneeUserId));
  if (filters.subjectStore) conds.push(eq(worklistItem.subjectStore, filters.subjectStore));
  if (filters.overdueOnly) {
    conds.push(lt(worklistItem.dueAt, new Date()));
    if (!filters.state) conds.push(inArray(worklistItem.state, [...ACTIVE_STATES]));
  }
  const db = getDb();
  const base = db.select().from(worklistItem);
  const query = conds.length ? base.where(and(...conds)) : base;
  return query.orderBy(asc(worklistItem.dueAt), asc(worklistItem.createdAt));
}

export async function getWorklistItem(id: string): Promise<WorklistItemRow | undefined> {
  const [row] = await getDb().select().from(worklistItem).where(eq(worklistItem.id, id));
  return row;
}

/** Per type × state counts for the queue badges, zero-filled. */
export async function getWorklistCounts(): Promise<
  Record<WorklistType, Record<WorklistState, number>>
> {
  const rows = await getDb()
    .select({ type: worklistItem.type, state: worklistItem.state, n: count() })
    .from(worklistItem)
    .groupBy(worklistItem.type, worklistItem.state);
  const out = Object.fromEntries(
    WORKLIST_TYPES.map((t) => [
      t,
      Object.fromEntries(WORKLIST_STATES.map((s) => [s, 0])) as Record<WorklistState, number>,
    ]),
  ) as Record<WorklistType, Record<WorklistState, number>>;
  for (const r of rows) out[r.type][r.state] = Number(r.n);
  return out;
}

/** Shared shape for the single-item mutations below: load-active, mutate,
 *  audit, all in one transaction. Returns null when the item does not exist
 *  or is not in an accepted prior state (routes translate to 404/409). */
async function mutateItem(
  id: string,
  acceptStates: readonly WorklistState[],
  action: WorklistAuditAction,
  set: (row: WorklistItemRow) => Partial<typeof worklistItem.$inferInsert>,
  meta?: WorklistWriteMeta,
): Promise<WorklistItemRow | null> {
  const db = getDb();
  const actor = meta?.actor ?? "system";
  const source = meta?.source ?? "system";
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(worklistItem)
      .where(eq(worklistItem.id, id))
      .for("update");
    if (!existing || !acceptStates.includes(existing.state)) return null;
    const [row] = await tx
      .update(worklistItem)
      .set({ ...set(existing), updatedAt: new Date() })
      .where(eq(worklistItem.id, id))
      .returning();
    await appendWorklistAudit(tx, {
      actor,
      action,
      recordId: row.id,
      before: auditableWorklistItem(existing),
      after: auditableWorklistItem(row),
      source,
    });
    return row;
  });
}

/** Claim an item: assign it and move open → in_progress. */
export async function claimItem(
  id: string,
  userId: string,
  meta?: WorklistWriteMeta,
): Promise<WorklistItemRow | null> {
  return mutateItem(
    id,
    ACTIVE_STATES,
    "worklist-claim",
    () => ({ assigneeUserId: userId, state: "in_progress" as WorklistState }),
    meta,
  );
}

/** Set or clear an item's due date. */
export async function setDue(
  id: string,
  dueAt: Date | null,
  meta?: WorklistWriteMeta,
): Promise<WorklistItemRow | null> {
  return mutateItem(id, ACTIVE_STATES, "worklist-due", () => ({ dueAt }), meta);
}

/** Resolve an active item. The resolution must belong to the item type's
 *  closed vocabulary (WORKLIST_RESOLUTIONS); throws WorklistValidationError
 *  otherwise. */
export async function resolveItem(
  id: string,
  opts: { resolution: string; note?: string; resolvedBy: string },
  meta?: WorklistWriteMeta,
): Promise<WorklistItemRow | null> {
  const existing = await getWorklistItem(id);
  if (!existing) return null;
  const allowed: readonly string[] = WORKLIST_RESOLUTIONS[existing.type];
  if (!allowed.includes(opts.resolution)) {
    throw new WorklistValidationError(existing.type, [
      {
        code: "custom",
        message: `resolution must be one of: ${allowed.join(", ")}`,
        path: ["resolution"],
        input: opts.resolution,
      },
    ]);
  }
  return mutateItem(
    id,
    ACTIVE_STATES,
    "worklist-resolve",
    () => ({
      state: "resolved" as WorklistState,
      resolution: opts.resolution,
      resolutionNote: opts.note ?? null,
      resolvedAt: new Date(),
      resolvedBy: opts.resolvedBy,
    }),
    meta,
  );
}

/** Dismiss an active item without a typed resolution (spam, duplicate, moot). */
export async function dismissItem(
  id: string,
  opts: { note?: string; resolvedBy: string },
  meta?: WorklistWriteMeta,
): Promise<WorklistItemRow | null> {
  return mutateItem(
    id,
    ACTIVE_STATES,
    "worklist-dismiss",
    () => ({
      state: "dismissed" as WorklistState,
      resolutionNote: opts.note ?? null,
      resolvedAt: new Date(),
      resolvedBy: opts.resolvedBy,
    }),
    meta,
  );
}
