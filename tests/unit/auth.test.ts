// Characterization test for src/lib/auth.ts (SDD §14 items 2 & 6).
// Encodes what the auth module does TODAY: scrypt password hashing,
// verification of malformed stored strings, the stateless HMAC session
// token (round-trip, expiry, tamper/cross-secret rejection), the canEdit
// authorization matrix — plus the E05 Postgres-only user/invite stores
// ("auth-users" / "auth-invites"), exercised over PGlite.
//
// auth.ts imports next/headers at module scope; mock it so the import does not
// fail outside a request context.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { User } from "@/lib/auth";
import {
  adminResetPassword,
  canEdit,
  changeOwnPassword,
  createInvite,
  createUser,
  findUserByEmail,
  hasAnyUsers,
  hashPassword,
  listInvites,
  makeSessionToken,
  parseSessionToken,
  redeemInvite,
  updateOwnProfile,
  verifyPassword,
} from "@/lib/auth";
import { audit, record } from "@/lib/db/schema";
import { createTestDb, type TestDb } from "../setup/pglite-db";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(() => tdb.close());

// A User object literal helper — we build these directly and never touch the
// user store (canEdit is a pure function of the passed User + id).
function makeUser(overrides: Partial<User>): User {
  return {
    id: "u1",
    email: "u1@example.com",
    name: "User One",
    role: "business",
    linkedIds: [],
    passwordHash: "scrypt$deadbeef$cafe",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("hashPassword / verifyPassword", () => {
  it("verifies a password against its own hash", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects a wrong password against a valid hash", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(verifyPassword("wrong password", hash)).toBe(false);
  });

  it("produces a salted scrypt hash (distinct salts, distinct hashes)", () => {
    const a = hashPassword("same");
    const b = hashPassword("same");
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(a).not.toBe(b); // random salt per call
    // both still verify
    expect(verifyPassword("same", a)).toBe(true);
    expect(verifyPassword("same", b)).toBe(true);
  });

  // Malformed stored strings must all return false and never throw.
  it.each([
    ["empty string", ""],
    ["no delimiters", "plain"],
    ["empty salt and hash", "scrypt$$"],
    ["wrong scheme", "bcrypt$a$b"],
    ["invalid hex salt/hash", "scrypt$zz$zz"],
  ])("returns false without throwing for %s", (_label, stored) => {
    expect(() => verifyPassword("anything", stored)).not.toThrow();
    expect(verifyPassword("anything", stored)).toBe(false);
  });
});

describe("makeSessionToken / parseSessionToken", () => {
  it("round-trips the user id", () => {
    expect(parseSessionToken(makeSessionToken("u1"))).toBe("u1");
  });

  it("returns null once the token has expired (past SESSION_DAYS = 30 days)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const token = makeSessionToken("u1");
      // Still valid immediately after minting.
      expect(parseSessionToken(token)).toBe("u1");
      // Advance past the 30-day session window (+ a day for margin).
      vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000);
      expect(parseSessionToken(token)).toBe(null);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns null when the payload segment is tampered", () => {
    const token = makeSessionToken("u1");
    const [payload, sig] = token.split(".");
    // Flip one char in the payload; pick a replacement that differs.
    const flipped = (payload[0] === "A" ? "B" : "A") + payload.slice(1);
    expect(parseSessionToken(`${flipped}.${sig}`)).toBe(null);
  });

  it("returns null when the signature is truncated", () => {
    const token = makeSessionToken("u1");
    const [payload, sig] = token.split(".");
    expect(parseSessionToken(`${payload}.${sig.slice(0, -2)}`)).toBe(null);
  });

  it("returns null for a token with no '.' separator", () => {
    expect(parseSessionToken("notoken")).toBe(null);
  });

  it("returns null when signed under a different AUTH_SECRET (cross-secret)", () => {
    // secret() re-reads process.env.AUTH_SECRET on every sign() call, so we can
    // swap the secret between minting and parsing.
    const original = process.env.AUTH_SECRET;
    try {
      process.env.AUTH_SECRET = "secret-A";
      const token = makeSessionToken("u1");
      process.env.AUTH_SECRET = "secret-B";
      expect(parseSessionToken(token)).toBe(null);
      // Restore secret-A and confirm the same token parses again — the token
      // itself is well-formed; only the verifying secret matters.
      process.env.AUTH_SECRET = "secret-A";
      expect(parseSessionToken(token)).toBe("u1");
    } finally {
      process.env.AUTH_SECRET = original;
    }
  });
});

describe("canEdit authorization matrix", () => {
  it("admins may edit any id regardless of linkedIds", () => {
    const admin = makeUser({ role: "admin", linkedIds: [] });
    expect(canEdit(admin, "r1")).toBe(true);
    expect(canEdit(admin, "anything-else")).toBe(true);
  });

  it("a business account may edit its linked id but not others", () => {
    const biz = makeUser({ role: "business", linkedIds: ["r1"] });
    expect(canEdit(biz, "r1")).toBe(true);
    expect(canEdit(biz, "r2")).toBe(false);
  });

  it("a nonprofit account may edit its linked id but not others", () => {
    const np = makeUser({ role: "nonprofit", linkedIds: ["r1"] });
    expect(canEdit(np, "r1")).toBe(true);
    expect(canEdit(np, "r2")).toBe(false);
  });

  it("a non-admin with empty linkedIds may edit nothing", () => {
    const biz = makeUser({ role: "business", linkedIds: [] });
    expect(canEdit(biz, "r1")).toBe(false);
  });
});

// ---------- Postgres-only user/invite stores (E05, over PGlite) ----------
//
// These tests run in file order against ONE shared PGlite instance, so the
// empty-database assertion comes first and later tests use distinct emails.

describe("user store (auth-users, Postgres-only)", () => {
  it("hasAnyUsers is false on an empty database (bootstrap gate)", async () => {
    expect(await hasAnyUsers()).toBe(false);
  });

  it("createUser persists to the 'auth-users' record store and hashes the password", async () => {
    const user = await createUser({
      email: "first@example.test",
      name: "First Admin",
      role: "admin",
      linkedIds: [],
      password: "hunter2hunter2",
    });
    expect(user.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("hunter2hunter2", user.passwordHash)).toBe(true);
    expect(await hasAnyUsers()).toBe(true);

    // The row landed in the overlay table under the auth-users store key.
    const rows = await tdb.db.select().from(record).where(eq(record.store, "auth-users"));
    expect(rows.map((r) => r.id)).toContain(user.id);
    const row = rows.find((r) => r.id === user.id)!;
    expect((row.doc as unknown as User).email).toBe("first@example.test");
    // Bootstrap flow without a session: public source, actor = new account.
    expect(row.source).toBe("public");
    expect(row.updatedBy).toBe("first@example.test");
  });

  it("audit rows never contain the password hash (choke-point redaction)", async () => {
    const rows = await tdb.db.select().from(audit).where(eq(audit.store, "auth-users"));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const after = r.after as Record<string, unknown> | null;
      if (after && "passwordHash" in after) {
        expect(after.passwordHash).toBe("[redacted]");
      }
      expect(JSON.stringify(r.after ?? {})).not.toContain("scrypt$");
      expect(JSON.stringify(r.before ?? {})).not.toContain("scrypt$");
    }
  });

  it("rejects a duplicate email case-insensitively", async () => {
    await expect(
      createUser({
        email: "FIRST@example.test",
        name: "Dup",
        role: "business",
        linkedIds: [],
        password: "password123",
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("findUserByEmail is case-insensitive", async () => {
    const found = await findUserByEmail("First@Example.Test");
    expect(found?.name).toBe("First Admin");
    expect(await findUserByEmail("nobody@example.test")).toBeUndefined();
  });

  it("changeOwnPassword requires the correct current password and a long-enough new one", async () => {
    const user = await createUser({
      email: "pw@example.test",
      name: "PW User",
      role: "business",
      linkedIds: ["r1"],
      password: "old-password",
    });
    await expect(changeOwnPassword(user.id, "old-password", "short")).rejects.toThrow(/8\+/);
    await expect(changeOwnPassword(user.id, "wrong", "new-password-1")).rejects.toThrow(
      /incorrect/,
    );
    await expect(changeOwnPassword("no-such-id", "x", "new-password-1")).rejects.toThrow(
      /not found/,
    );
    await changeOwnPassword(user.id, "old-password", "new-password-1");
    const reread = await findUserByEmail("pw@example.test");
    expect(verifyPassword("new-password-1", reread!.passwordHash)).toBe(true);
    expect(verifyPassword("old-password", reread!.passwordHash)).toBe(false);
  });

  it("adminResetPassword sets a temp password and returns it once", async () => {
    const user = await findUserByEmail("pw@example.test");
    const temp = await adminResetPassword(user!.id);
    const reread = await findUserByEmail("pw@example.test");
    expect(verifyPassword(temp, reread!.passwordHash)).toBe(true);
    await expect(adminResetPassword("no-such-id")).rejects.toThrow(/not found/);
  });

  it("updateOwnProfile updates name/email and keeps emails unique", async () => {
    const user = await createUser({
      email: "profile@example.test",
      name: "Old Name",
      role: "nonprofit",
      linkedIds: ["c1"],
      password: "password123",
    });
    // Colliding with an existing account's email is rejected.
    await expect(updateOwnProfile(user.id, { email: "first@example.test" })).rejects.toThrow(
      /already uses/,
    );
    const updated = await updateOwnProfile(user.id, {
      name: "New Name",
      email: "renamed@example.test",
    });
    expect(updated.name).toBe("New Name");
    expect(updated.email).toBe("renamed@example.test");
    // Persisted (same id, new email), old email gone.
    expect((await findUserByEmail("renamed@example.test"))?.id).toBe(user.id);
    expect(await findUserByEmail("profile@example.test")).toBeUndefined();
    // Untouched fields survive the round-trip.
    expect(updated.role).toBe("nonprofit");
    expect(updated.linkedIds).toEqual(["c1"]);
  });
});

describe("invite store (auth-invites, Postgres-only)", () => {
  it("createInvite persists keyed by code (mirrored into the row id)", async () => {
    const invite = await createInvite({ role: "business", linkedIds: ["r9"], note: "test" });
    expect((await listInvites()).some((i) => i.code === invite.code)).toBe(true);

    const rows = await tdb.db.select().from(record).where(eq(record.store, "auth-invites"));
    const row = rows.find((r) => r.id === invite.code);
    expect(row).toBeDefined();
    expect((row!.doc as { code: string }).code).toBe(invite.code);
  });

  it("redeemInvite creates a user with the invite's role/linkedIds and burns the code", async () => {
    const invite = await createInvite({ role: "nonprofit", linkedIds: ["c7"] });
    const user = await redeemInvite(invite.code, {
      email: "invited@example.test",
      name: "Invited",
      password: "password123",
    });
    expect(user.role).toBe("nonprofit");
    expect(user.linkedIds).toEqual(["c7"]);

    // The invite is marked used…
    const stored = (await listInvites()).find((i) => i.code === invite.code);
    expect(stored?.usedBy).toBe(user.id);
    // …so a second redemption fails.
    await expect(
      redeemInvite(invite.code, {
        email: "second@example.test",
        name: "Second",
        password: "password123",
      }),
    ).rejects.toThrow(/Invalid or already-used/);
  });

  it("rejects an unknown invite code", async () => {
    await expect(
      redeemInvite("does-not-exist", {
        email: "x@example.test",
        name: "X",
        password: "password123",
      }),
    ).rejects.toThrow(/Invalid or already-used/);
  });
});

afterEach(() => {
  vi.useRealTimers();
});
