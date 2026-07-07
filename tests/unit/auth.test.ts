// Characterization test for src/lib/auth.ts (SDD §14 items 2 & 6).
// Encodes what the auth crypto helpers do TODAY: scrypt password hashing,
// verification of malformed stored strings, and the stateless HMAC session
// token (round-trip, expiry, tamper/cross-secret rejection), plus the canEdit
// authorization matrix.
//
// auth.ts imports next/headers at module scope; mock it so the import does not
// fail outside a request context.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { afterEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/lib/auth";
import {
  canEdit,
  hashPassword,
  makeSessionToken,
  parseSessionToken,
  verifyPassword,
} from "@/lib/auth";

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

afterEach(() => {
  vi.useRealTimers();
});
