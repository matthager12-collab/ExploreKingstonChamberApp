// E08 staleness sweep: overdue live records become worklist items, re-runs
// are no-ops (the partial unique index), resolving `verified` stamps
// last_verified_at and takes the record out of the next sweep. The sweep
// route fails CLOSED: no admin session and no matching WORKLIST_SWEEP_TOKEN
// (or the env var unset entirely) → 401.

import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { record, worklistItem } from "@/lib/db/schema";
import { listVerifyDue, markRecordVerified, writeRecord } from "@/lib/db/records";
import { restaurants as restaurantSeed } from "@/lib/data/restaurants";
import { STALENESS_DEFAULTS, listWorklistItems, resolveItem } from "@/lib/stores/worklist-store";
import { createTestDb, type TestDb } from "../setup/pglite-db";

/** Seed-derived doc: restaurants validate under the STRICT domain schema
 *  since the #30 swap, so minimal stubs no longer pass the write-gate. */
function restaurantDoc(id: string, name: string) {
  return { ...restaurantSeed[0], id, name };
}

const authState = vi.hoisted(() => ({
  user: null as null | { id: string; role: string; email: string },
  /** What listUsers() returns — the sweep maps an event's ownerId (an org)
   *  onto the account that should answer for it. */
  users: [] as { id: string; orgId: string | null }[],
}));

vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(async () => authState.user),
  requireAdmin: vi.fn(async () =>
    authState.user?.role === "admin"
      ? null
      : Response.json({ error: "Sign in first" }, { status: 401 }),
  ),
  listUsers: vi.fn(async () => authState.users),
}));

import { POST as sweepPOST } from "@/app/api/admin/worklist/sweep/route";

function sweep(headers?: Record<string, string>) {
  return sweepPOST(
    new NextRequest("http://localhost/api/admin/worklist/sweep", {
      method: "POST",
      headers,
    }),
  );
}

async function backdate(store: string, id: string, daysAgo: number) {
  await tdb.db
    .update(record)
    .set({ updatedAt: new Date(Date.now() - daysAgo * 86_400_000) })
    .where(and(eq(record.store, store), eq(record.id, id)));
}

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
  // Two overdue live restaurants (interval 90d, last write 120d ago), one
  // fresh one, one overdue-but-pending, and one overdue event (a store with
  // no STALENESS_DEFAULTS entry — must never be swept).
  await writeRecord("restaurants", restaurantDoc("stale-a", "Stale A"), { status: "live" });
  await writeRecord("restaurants", restaurantDoc("stale-b", "Stale B"), { status: "live" });
  await writeRecord("restaurants", restaurantDoc("fresh-c", "Fresh C"), { status: "live" });
  await writeRecord("restaurants", restaurantDoc("stale-pending", "Stale Pending"), {
    status: "pending",
  });
  await writeRecord(
    "events",
    { id: "old-event", title: "Old Event", start: "2020-01-01T10:00:00-08:00" },
    { status: "live" },
  );
  await backdate("restaurants", "stale-a", 120);
  await backdate("restaurants", "stale-b", 120);
  await backdate("restaurants", "stale-pending", 120);
  await backdate("events", "old-event", 400);
});
afterAll(async () => {
  await tdb.close();
});
afterEach(() => {
  delete process.env.WORKLIST_SWEEP_TOKEN;
  authState.user = null;
});

describe("sweep auth — fail closed", () => {
  it("401 with no session and no token env var (token path disabled entirely)", async () => {
    const res = await sweep({ authorization: "Bearer anything" });
    expect(res.status).toBe(401);
  });

  it("401 with a wrong token; 200 with the right one and no session", async () => {
    process.env.WORKLIST_SWEEP_TOKEN = "sweep-secret";
    expect((await sweep({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await sweep({ authorization: "Bearer sweep-secret" })).status).toBe(200);
  });
});

describe("sweep behavior", () => {
  it("first run creates exactly the overdue-live items; second run creates none", async () => {
    authState.user = { id: "admin-1", role: "admin", email: "admin@example.test" };

    // The auth test above already swept once — reset expectations from state:
    // stale-a and stale-b are the only eligible subjects, so however we got
    // here there is exactly one open item per overdue subject.
    const open = await listWorklistItems({ type: "staleness", state: "open" });
    expect(open.map((i) => i.subjectId).sort()).toEqual(["stale-a", "stale-b"]);

    const second = await sweep();
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body).toMatchObject({ ok: true, scanned: 2, created: 0, alreadyOpen: 2 });

    const openAfter = await listWorklistItems({ type: "staleness", state: "open" });
    expect(openAfter).toHaveLength(2);
  });

  it("the pending record and the one-off event were never swept", async () => {
    const all = await listWorklistItems({ type: "staleness" });
    expect(all.map((i) => i.subjectId)).not.toContain("stale-pending");
    // `events` IS a participating store now (repeating series go stale while
    // still on the calendar), but a single-occurrence event expires on its own
    // and is skipped at the sweep — same outcome as before, different reason.
    expect(STALENESS_DEFAULTS.events).toBe(90);
    expect(all.map((i) => i.subjectId)).not.toContain("old-event");
  });

  it("verified resolution stamps last_verified_at and removes the record from the next sweep", async () => {
    authState.user = { id: "admin-1", role: "admin", email: "admin@example.test" };
    const item = (await listWorklistItems({ type: "staleness", state: "open" })).find(
      (i) => i.subjectId === "stale-a",
    );
    expect(item).toBeDefined();

    const before = Date.now();
    // The slice-4 admin route drives these two calls; the contract is here.
    const stamped = await markRecordVerified("restaurants", "stale-a", {
      actor: "admin@example.test",
      source: "admin",
    });
    expect(stamped).toBe(true);
    await resolveItem(
      item!.id,
      { resolution: "verified", resolvedBy: "admin-1" },
      { actor: "admin@example.test", source: "admin" },
    );

    const [row] = await tdb.db
      .select()
      .from(record)
      .where(and(eq(record.store, "restaurants"), eq(record.id, "stale-a")));
    expect(row.lastVerifiedAt).not.toBeNull();
    expect(Math.abs(row.lastVerifiedAt!.getTime() - before)).toBeLessThan(10_000);

    const res = await sweep();
    const body = await res.json();
    expect(body.scanned).toBe(1); // only stale-b remains due
    const open = await listWorklistItems({ type: "staleness", state: "open" });
    expect(open.map((i) => i.subjectId)).toEqual(["stale-b"]);
  });

  it("a record's own verify_interval_days overrides the store default", async () => {
    await writeRecord("restaurants", restaurantDoc("quick-turn", "Quick Turn"), {
      status: "live",
    });
    await backdate("restaurants", "quick-turn", 10);
    await tdb.db
      .update(record)
      .set({ verifyIntervalDays: 7 })
      .where(and(eq(record.store, "restaurants"), eq(record.id, "quick-turn")));

    const due = await listVerifyDue(STALENESS_DEFAULTS);
    const ids = due.map((d) => d.id);
    expect(ids).toContain("quick-turn"); // 10d old > its own 7d interval
    expect(due.find((d) => d.id === "quick-turn")?.intervalDays).toBe(7);
  });

  it("markRecordVerified returns false for a record with no overlay row (seed-only)", async () => {
    expect(await markRecordVerified("restaurants", "never-written-id")).toBe(false);
  });
});

// A repeating event is the case the events store was added to the sweep for:
// it never expires on its own, so nothing else would ever ask whether the
// weekly market is still running at the time the calendar claims.
describe("repeating events — the quarterly owner check", () => {
  beforeAll(async () => {
    await writeRecord(
      "events",
      {
        id: "weekly-market",
        title: "Kingston Public Market",
        start: "2026-05-02T09:00:00-07:00",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
        ownerId: "org-1",
      },
      { status: "live" },
    );
    await writeRecord(
      "events",
      {
        id: "ownerless-series",
        title: "Chamber Coffee Hour",
        start: "2026-05-05T08:00:00-07:00",
        rrule: "FREQ=MONTHLY;BYDAY=1TU",
      },
      { status: "live" },
    );
    await backdate("events", "weekly-market", 120);
    await backdate("events", "ownerless-series", 120);
  });

  it("assigns an owned series to the owner's account with a deadline", async () => {
    authState.user = { id: "admin-1", role: "admin", email: "admin@example.test" };
    authState.users = [{ id: "owner-1", orgId: "org-1" }];

    const body = await (await sweep()).json();
    expect(body.assignedToOwner).toBeGreaterThanOrEqual(1);

    const [item] = await listWorklistItems({
      type: "staleness",
      subjectStore: "events",
      assigneeUserId: "owner-1",
    });
    expect(item).toBeDefined();
    expect(item.subjectId).toBe("weekly-market");
    // 14 days out, give or take the seconds this test took to run.
    const days = (item.dueAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
  });

  it("leaves an ownerless series unassigned — straight to the Chamber", async () => {
    const items = await listWorklistItems({
      type: "staleness",
      subjectStore: "events",
    });
    const ownerless = items.find((i) => i.subjectId === "ownerless-series");
    expect(ownerless).toBeDefined();
    expect(ownerless!.assigneeUserId).toBeNull();
    // No owner means no one to wait on, so no deadline to escalate against.
    expect(ownerless!.dueAt).toBeNull();
  });

  it("hands the task back to the Chamber once the deadline passes", async () => {
    authState.user = { id: "admin-1", role: "admin", email: "admin@example.test" };
    const [assigned] = await listWorklistItems({
      type: "staleness",
      subjectStore: "events",
      assigneeUserId: "owner-1",
    });
    expect(assigned).toBeDefined();

    // The owner did nothing for 15 days.
    await tdb.db
      .update(worklistItem)
      .set({ dueAt: new Date(Date.now() - 86_400_000) })
      .where(eq(worklistItem.id, assigned.id));

    const body = await (await sweep()).json();
    expect(body.escalated).toBe(1);

    const after = await listWorklistItems({
      type: "staleness",
      subjectStore: "events",
    });
    const moved = after.find((i) => i.subjectId === "weekly-market");
    // Same item, now nobody's — which is what puts it in the Chamber's
    // unassigned queue. Doing nothing must not park a task forever.
    expect(moved!.id).toBe(assigned.id);
    expect(moved!.assigneeUserId).toBeNull();
    expect(moved!.state).toBe("open");
  });
});
