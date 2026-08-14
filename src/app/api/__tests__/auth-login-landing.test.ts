import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Same in-memory PGlite harness the other auth route tests use — auth is
// Postgres-only (E05), so the real store runs here rather than a mock.
import { createTestDb, type TestDb } from "../../../../tests/setup/pglite-db";
import { createFirstAdmin, createInvite, redeemInvite } from "@/lib/auth";
import { POST } from "@/app/api/auth/login/route";

// The pure role→console table is covered exhaustively in
// tests/unit/auth-landing.test.ts. What THIS test buys, and the unit test
// cannot, is that the route actually puts it on the wire: a sign-in response
// that forgets `redirectTo` still returns 200 with a valid session cookie, so
// the failure mode is silent — everyone simply lands on the portal again, which
// is precisely the behaviour this change set out to remove.

let tdb: TestDb;

const PASSWORD = "password123";

beforeAll(async () => {
  tdb = await createTestDb();
  await createFirstAdmin({
    email: "admin@example.com",
    name: "Chamber Admin",
    password: PASSWORD,
  });
  // A moderator needs no org and no email binding, which makes it the cheapest
  // non-admin account to stand up — and it is also the role most likely to be
  // routed into /admin by mistake later, since its tools are destined to live
  // there.
  const invite = await createInvite({ role: "moderator" }, "test");
  await redeemInvite(invite.code, {
    email: "moderator@example.com",
    name: "Mod",
    password: PASSWORD,
  });
});

afterAll(async () => {
  await tdb.close();
});

/** Distinct IPs per call: the route rate-limits by client IP and by email. */
function login(ip: string, email: string) {
  return POST(
    new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: PASSWORD }),
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
    }),
  );
}

describe("POST /api/auth/login — role-based landing", () => {
  it("sends a Chamber admin to the console", async () => {
    const res = await login("203.0.113.10", "admin@example.com");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      role: "admin",
      redirectTo: "/admin",
    });
  });

  it("sends a non-admin to the member portal", async () => {
    const res = await login("203.0.113.11", "moderator@example.com");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      role: "moderator",
      redirectTo: "/portal",
    });
  });

  it("still issues a session cookie alongside the destination", async () => {
    // Guards the obvious regression in wiring a second field into this
    // response: the cookie is what the redirect is worth anything without.
    const res = await login("203.0.113.12", "admin@example.com");
    expect(res.headers.get("set-cookie")).toBeTruthy();
  });

  it("tells a failed sign-in nothing about where it would have landed", async () => {
    // `redirectTo` is derived from a role, so it is a (weak) statement about
    // the account. A 401 must not carry one — it would separate "wrong
    // password for a real admin" from "no such account", which the uniform
    // error message in this route exists to prevent.
    const res = await POST(
      new NextRequest("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "admin@example.com", password: "wrong-password" }),
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.13" },
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).not.toHaveProperty("redirectTo");
  });
});
