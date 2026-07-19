// worklist store (E08): one generic queue table behind five consumers.
// Contract under test — createWorklistItem upserts against the partial unique
// index (one ACTIVE item per type+subject; merge semantics per type), every
// mutation writes exactly one audit row in the same transaction, resolutions
// come from the per-type closed vocabulary, and the DB CHECKs mirror the
// schema-module vocabularies.

import { and, asc, eq, gt, max } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { audit, worklistItem } from "@/lib/db/schema";
import { WorklistValidationError } from "@/lib/schemas/worklist";
import {
  claimItem,
  createWorklistItem,
  dismissItem,
  getWorklistCounts,
  getWorklistItem,
  listWorklistItems,
  resolveItem,
  setDue,
} from "@/lib/stores/worklist-store";
import {
  moderationPayload,
  privacyRequestItem,
  reportInaccuratePayload,
  stalenessPayload,
  syncConflictItem,
} from "../fixtures/worklist-fixtures";
import { createTestDb, type TestDb } from "../setup/pglite-db";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

// Audit rows are append-only (the immutability trigger is part of the schema
// under test), so per-test isolation uses a high-water mark, not deletion.
let auditMark = 0;
beforeEach(async () => {
  await tdb.db.delete(worklistItem);
  const [row] = await tdb.db.select({ m: max(audit.id) }).from(audit);
  auditMark = row?.m ?? 0;
});

async function worklistAuditRows() {
  return tdb.db
    .select()
    .from(audit)
    .where(and(eq(audit.store, "worklist"), gt(audit.id, auditMark)))
    .orderBy(asc(audit.id));
}

const meta = { actor: "mat@example.test", source: "admin" as const };

function reportInput(over: Record<string, unknown> = {}) {
  return {
    type: "report_inaccurate" as const,
    subjectStore: "restaurants",
    subjectId: "cafe",
    subjectLabel: "The Cafe",
    payload: reportInaccuratePayload(),
    ...over,
  };
}

describe("createWorklistItem", () => {
  it("creates an open item and writes one worklist-create audit row", async () => {
    const { item, created } = await createWorklistItem(reportInput(), meta);
    expect(created).toBe(true);
    expect(item.state).toBe("open");
    expect(item.createdBy).toBeNull();

    const rows = await worklistAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "worklist-create",
      store: "worklist",
      recordId: item.id,
      actor: "mat@example.test",
      source: "admin",
      before: null,
    });
    expect(rows[0].after).toMatchObject({ type: "report_inaccurate", subjectId: "cafe" });
  });

  it("a second report on the same record MERGES: still one open item, messages appended, count bumped", async () => {
    const first = await createWorklistItem(reportInput(), meta);
    const second = await createWorklistItem(
      reportInput({
        payload: reportInaccuratePayload({
          messages: [{ message: "phone disconnected", at: "2026-07-19T11:00:00Z" }],
        }),
      }),
      meta,
    );

    expect(second.created).toBe(false);
    expect(second.item.id).toBe(first.item.id);
    expect(second.item.payload.count).toBe(2);
    expect((second.item.payload.messages as unknown[]).length).toBe(2);

    const open = await listWorklistItems({ type: "report_inaccurate", state: "open" });
    expect(open).toHaveLength(1);

    const rows = await worklistAuditRows();
    expect(rows.map((r) => r.action)).toEqual(["worklist-create", "worklist-update"]);
  });

  it("staleness re-create is a pure no-op: created=false, payload untouched, NO extra audit row", async () => {
    const input = {
      type: "staleness" as const,
      subjectStore: "restaurants",
      subjectId: "cafe",
      subjectLabel: "The Cafe",
      payload: stalenessPayload(),
    };
    const first = await createWorklistItem(input, meta);
    const second = await createWorklistItem(input, meta);
    expect(second.created).toBe(false);
    expect(second.item.id).toBe(first.item.id);
    expect(await worklistAuditRows()).toHaveLength(1);
  });

  it("a moderation re-submission replaces the payload — the member's second edit wins, the first survives in audit", async () => {
    const input = (blurb: string) => ({
      type: "moderation" as const,
      subjectStore: "restaurants",
      subjectId: "cafe",
      subjectLabel: "The Cafe",
      payload: moderationPayload({ proposed: { id: "cafe", description: blurb } }),
      createdBy: "user-1",
    });
    await createWorklistItem(input("v1"), meta);
    const { item } = await createWorklistItem(input("v2"), meta);
    expect((item.payload.proposed as { description: string }).description).toBe("v2");

    const rows = await worklistAuditRows();
    expect(
      ((rows[1].before as { payload: { proposed: { description: string } } }).payload.proposed)
        .description,
    ).toBe("v1");
  });

  it("a RESOLVED item does not block a new open item for the same subject (partial index)", async () => {
    const { item } = await createWorklistItem(reportInput(), meta);
    await resolveItem(item.id, { resolution: "fixed", resolvedBy: "admin-1" }, meta);
    const again = await createWorklistItem(reportInput(), meta);
    expect(again.created).toBe(true);
    expect(again.item.id).not.toBe(item.id);
  });

  it("accepts the E16 sync_conflict and E11 privacy_request fixture shapes (no producers yet)", async () => {
    const sync = await createWorklistItem(syncConflictItem(), meta);
    const privacy = await createWorklistItem(privacyRequestItem(), meta);
    expect(sync.created).toBe(true);
    expect(privacy.created).toBe(true);
    expect(await getWorklistItem(sync.item.id)).toMatchObject({ type: "sync_conflict" });
    expect(await getWorklistItem(privacy.item.id)).toMatchObject({ type: "privacy_request" });
  });

  it("an invalid payload throws WorklistValidationError and writes NOTHING", async () => {
    await expect(
      createWorklistItem(reportInput({ payload: { messages: [], count: 0 } }), meta),
    ).rejects.toThrow(WorklistValidationError);
    expect(await listWorklistItems()).toHaveLength(0);
    expect(await worklistAuditRows()).toHaveLength(0);
  });
});

describe("DB CHECK parity with the schema-module vocabularies", () => {
  it("raw inserts with an unknown type or state are rejected by the table CHECKs", async () => {
    const base = {
      subjectStore: "restaurants",
      subjectId: "x",
      subjectLabel: "X",
      payload: {},
    };
    // Drizzle wraps the PG error; the violated constraint name is on `cause`.
    await expect(
      tdb.db
        .insert(worklistItem)
        .values({ ...base, type: "espionage" as never }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/worklist_item_type_check/) },
    });
    await expect(
      tdb.db
        .insert(worklistItem)
        .values({ ...base, type: "moderation", state: "paused" as never }),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/worklist_item_state_check/) },
    });
  });
});

describe("item mutations", () => {
  it("claim assigns and moves open → in_progress; claiming a resolved item returns null", async () => {
    const { item } = await createWorklistItem(reportInput(), meta);
    const claimed = await claimItem(item.id, "admin-1", meta);
    expect(claimed).toMatchObject({ state: "in_progress", assigneeUserId: "admin-1" });

    await resolveItem(item.id, { resolution: "fixed", resolvedBy: "admin-1" }, meta);
    expect(await claimItem(item.id, "admin-2", meta)).toBeNull();
  });

  it("resolve stamps resolution/note/resolvedAt/resolvedBy and audits worklist-resolve", async () => {
    const { item } = await createWorklistItem(reportInput(), meta);
    const before = Date.now();
    const resolved = await resolveItem(
      item.id,
      { resolution: "fixed", note: "updated the hours", resolvedBy: "admin-1" },
      meta,
    );
    expect(resolved).toMatchObject({
      state: "resolved",
      resolution: "fixed",
      resolutionNote: "updated the hours",
      resolvedBy: "admin-1",
    });
    expect(resolved!.resolvedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);

    const rows = await worklistAuditRows();
    expect(rows.at(-1)).toMatchObject({ action: "worklist-resolve", recordId: item.id });
  });

  it("a resolution outside the item type's vocabulary throws; the item stays open", async () => {
    const { item } = await createWorklistItem(reportInput(), meta);
    await expect(
      resolveItem(item.id, { resolution: "approved", resolvedBy: "admin-1" }, meta),
    ).rejects.toThrow(WorklistValidationError);
    expect((await getWorklistItem(item.id))!.state).toBe("open");
  });

  it("dismiss closes without a typed resolution", async () => {
    const { item } = await createWorklistItem(reportInput(), meta);
    const dismissed = await dismissItem(item.id, { note: "spam", resolvedBy: "admin-1" }, meta);
    expect(dismissed).toMatchObject({
      state: "dismissed",
      resolution: null,
      resolutionNote: "spam",
    });
    const rows = await worklistAuditRows();
    expect(rows.at(-1)!.action).toBe("worklist-dismiss");
  });

  it("mutating a nonexistent id returns null", async () => {
    expect(await claimItem("00000000-0000-0000-0000-000000000000", "a", meta)).toBeNull();
    expect(await setDue("00000000-0000-0000-0000-000000000000", new Date(), meta)).toBeNull();
  });
});

describe("listWorklistItems + counts", () => {
  it("filters by type/state/assignee/unassigned/subjectStore and orders due-first then created", async () => {
    const a = await createWorklistItem(reportInput({ subjectId: "a", subjectLabel: "A" }), meta);
    const b = await createWorklistItem(reportInput({ subjectId: "b", subjectLabel: "B" }), meta);
    const c = await createWorklistItem(syncConflictItem(), meta);

    // b gets an (already past) due date → sorts before the null-due a.
    await setDue(b.item.id, new Date(Date.now() - 60_000), meta);
    await claimItem(c.item.id, "admin-1", meta);

    const all = await listWorklistItems();
    expect(all.map((i) => i.subjectId)).toEqual(["b", "a", "the-grub-hut"]);

    expect(await listWorklistItems({ type: "report_inaccurate" })).toHaveLength(2);
    expect(await listWorklistItems({ state: "in_progress" })).toHaveLength(1);
    expect(await listWorklistItems({ assigneeUserId: "admin-1" })).toHaveLength(1);
    expect(await listWorklistItems({ unassignedOnly: true })).toHaveLength(2);
    expect(await listWorklistItems({ subjectStore: "restaurants" })).toHaveLength(3);
    expect(await listWorklistItems({ overdueOnly: true }).then((r) => r.map((i) => i.id))).toEqual([
      b.item.id,
    ]);
    void a;
  });

  it("getWorklistCounts returns a zero-filled type × state grid", async () => {
    await createWorklistItem(reportInput(), meta);
    const { item } = await createWorklistItem(syncConflictItem(), meta);
    await resolveItem(item.id, { resolution: "kept_local", resolvedBy: "admin-1" }, meta);

    const counts = await getWorklistCounts();
    expect(counts.report_inaccurate.open).toBe(1);
    expect(counts.sync_conflict.resolved).toBe(1);
    expect(counts.sync_conflict.open).toBe(0);
    expect(counts.moderation.open).toBe(0);
    expect(counts.privacy_request.dismissed).toBe(0);
  });
});
