import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// E05: the store layer is Postgres-only — these route tests run against an
// in-memory PGlite migrated with the checked-in db/migrations.
import { createTestDb, type TestDb } from "../../../../tests/setup/pglite-db";
import { POST as portalEventsPost } from "@/app/api/portal/events/route";
import { GET as feedsGet } from "@/app/api/feeds/events/route";

vi.mock("@/lib/auth", () => ({
  // E06 SessionUser shape: linked ids moved onto the org and surface as
  // editableIds; the old per-id edit check became can(user, "edit-record", …).
  getSessionUser: vi.fn(async () => ({
    id: "u1",
    role: "admin",
    orgId: null,
    editableIds: [],
    entitlements: {},
    name: "Test",
    email: "t@t.t",
  })),
  can: vi.fn(() => true),
}));

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

// The feed serves UPCOMING events only (route.ts filters on end ?? start >=
// now), so the fixture date has to stay in the future or the assertion has
// nothing to match. A hardcoded date made this a time bomb — it was
// 2026-08-01T15:00 and started failing on main the afternoon of 2026-08-01.
// July 1 of next year is always inside PDT (UTC-7), which is what keeps the
// naive-15:00 → 22:00Z conversion the point of the test.
const YEAR = new Date().getUTCFullYear() + 1;
const NAIVE_START = `${YEAR}-07-01T15:00`;
const EXPECTED_DTSTART = `DTSTART:${YEAR}0701T220000Z`;

describe("GET /api/feeds/events timezone correctness", () => {
  it("serializes a naive-start event's DTSTART as the correct UTC instant", async () => {
    await portalEventsPost(
      new NextRequest("http://localhost/api/portal/events", {
        method: "POST",
        body: JSON.stringify({
          ownerId: "owner-1",
          title: "Late Summer Market",
          start: NAIVE_START,
          category: "market",
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await feedsGet(
      new NextRequest("http://localhost/api/feeds/events?format=ics"),
    );
    const ics = await res.text();
    expect(ics).toContain(EXPECTED_DTSTART);
  });
});
