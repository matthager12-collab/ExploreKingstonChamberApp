// E08 staleness sweep: overdue live records become worklist items, re-runs
// are no-ops (the partial unique index), resolving `verified` stamps
// last_verified_at and takes the record out of the next sweep. The sweep
// route fails CLOSED: no admin session and no matching WORKLIST_SWEEP_TOKEN
// (or the env var unset entirely) → 401.

import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { record } from "@/lib/db/schema";
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
}));

vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(async () => authState.user),
  requireAdmin: vi.fn(async () =>
    authState.user?.role === "admin"
      ? null
      : Response.json({ error: "Sign in first" }, { status: 401 }),
  ),
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

  it("the pending record and the non-participating store were never swept", async () => {
    const all = await listWorklistItems({ type: "staleness" });
    expect(all.map((i) => i.subjectId)).not.toContain("stale-pending");
    expect(all.map((i) => i.subjectId)).not.toContain("old-event");
    expect(STALENESS_DEFAULTS.events).toBeUndefined();
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
