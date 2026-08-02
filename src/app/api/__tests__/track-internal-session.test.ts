// Chamber staff sessions are marked internal at the ingest boundary.
//
// The other half of the mechanism (the client device flag) is covered by the
// table-driven suite in track-route.test.ts. This file covers the half that
// needs a signed-in user, and pins three things that are easy to regress:
//
//   1. WHICH roles are "us". Moving a role across that line moves every number
//      the Chamber reports, so the split is asserted role by role rather than
//      left to a constant nobody re-reads.
//   2. That an anonymous request never touches the database. This endpoint runs
//      on every pageview of a public site; the cookie pre-check is the only
//      thing standing between that and a user lookup per visitor.
//   3. That a failure to classify degrades to "visitor", never to a lost event.

import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { readAnalyticsEvents } from "@/lib/db/append";
import { createTestDb, type TestDb } from "../../../../tests/setup/pglite-db";

const getSessionUser = vi.fn(async (): Promise<{ role: string } | null> => null);

vi.mock("@/lib/auth", () => ({
  SESSION_COOKIE: "vk-session",
  getSessionUser: (...args: unknown[]) =>
    (getSessionUser as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
  requireAdmin: vi.fn(async () => null),
  can: vi.fn(() => false),
}));

const { POST } = await import("@/app/api/track/route");

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});
beforeEach(() => {
  getSessionUser.mockReset();
  getSessionUser.mockResolvedValue(null);
});

/** POST a pageview, optionally carrying a session cookie. Each call uses its
 *  own IP so the rate limiter never colors a result. */
async function pageview(opts: { ip: string; sessionId: string; cookie?: string }) {
  const headers: Record<string, string> = {
    "content-type": "text/plain",
    "x-forwarded-for": opts.ip,
  };
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await POST(
    new NextRequest("http://localhost/api/track", {
      method: "POST",
      body: JSON.stringify({ type: "pageview", path: "/eat", sessionId: opts.sessionId }),
      headers,
    }),
  );
  expect(res.status).toBe(200);
  const all = await readAnalyticsEvents<Record<string, unknown>>();
  return all.filter((e) => e.sessionId === opts.sessionId);
}

const SIGNED_IN = "vk-session=any-token-value";

describe("which signed-in roles count as ours", () => {
  // Chamber-side accounts. Their clicks are work.
  it.each(["admin", "moderator", "viewer"])("marks a signed-in %s as internal", async (role) => {
    getSessionUser.mockResolvedValue({ role });
    const rows = await pageview({
      ip: `198.51.100.${50 + role.length}`,
      sessionId: `staff-${role}`,
      cookie: SIGNED_IN,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].source, `${role} was not marked internal`).toBe("internal");
  });

  // The ~174 member businesses and nonprofits. They are locals with their own
  // reason to open the app and half of what a business launch launches to —
  // excluding them would make member engagement permanently invisible.
  it.each(["org-editor", "member-business"])(
    "counts a signed-in %s as a real visitor",
    async (role) => {
      getSessionUser.mockResolvedValue({ role });
      const rows = await pageview({
        ip: `198.51.100.${70 + role.length}`,
        sessionId: `member-${role}`,
        cookie: SIGNED_IN,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].source, `${role} was wrongly excluded from visitor counts`).toBeUndefined();
    },
  );
});

describe("the anonymous fast path", () => {
  it("never looks up a user when there is no session cookie", async () => {
    // The whole endpoint runs on every pageview of a public site. If this ever
    // regresses, every anonymous visit starts costing a database round trip.
    const rows = await pageview({ ip: "198.51.100.90", sessionId: "anon-1" });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBeUndefined();
    expect(getSessionUser, "an anonymous beacon hit the database").not.toHaveBeenCalled();
  });

  it("does look one up when a cookie is present", async () => {
    // The mirror of the test above: proves the assertion there is about the
    // cookie pre-check and not about the mock never being wired up.
    await pageview({ ip: "198.51.100.91", sessionId: "cookie-1", cookie: SIGNED_IN });
    expect(getSessionUser).toHaveBeenCalled();
  });
});

describe("classification failures never cost an event", () => {
  it("stores the event as a visitor when the session lookup throws", async () => {
    // Missing AUTH_SECRET, a database blip, anything. A slightly inflated
    // number beats a dropped pageview and a beacon that 500s at a visitor.
    getSessionUser.mockRejectedValue(new Error("AUTH_SECRET missing from the environment"));
    const rows = await pageview({
      ip: "198.51.100.92",
      sessionId: "throws-1",
      cookie: SIGNED_IN,
    });
    expect(rows, "the event was lost when classification failed").toHaveLength(1);
    expect(rows[0].source).toBeUndefined();
  });

  it("counts a signed-out-but-stale cookie holder as a visitor", async () => {
    // getSessionUser returns null for a revoked, disabled or expired session.
    // Nobody is behind it, so there is nobody to exclude.
    getSessionUser.mockResolvedValue(null);
    const rows = await pageview({
      ip: "198.51.100.93",
      sessionId: "stale-1",
      cookie: SIGNED_IN,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBeUndefined();
  });
});
