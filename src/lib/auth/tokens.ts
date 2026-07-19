// Pure auth cryptography (E06): password hashing and session-token
// make/verify. No database, no next/headers, no request scope — every export
// here is a pure function of its arguments.
//
// Why this file is separate from session.ts: anything importing next/headers
// cannot be loaded in a plain-Node context. Before E06 that forced
// tests/server/global-setup.ts to hand-copy hashPassword (two scrypt
// implementations that had to stay in sync), and it would block src/proxy.ts,
// which must verify a token at the request boundary WITHOUT touching the DB or
// app state. Keeping the primitives pure serves all three callers.
//
// Ported from v1 byte-for-byte compatibly: same scrypt parameters, same
// `scrypt$salt$hash` storage format, same HMAC-SHA256 base64url token shape.
// Existing password hashes MUST keep verifying — there is no rehash migration.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "vk-session";
export const SESSION_DAYS = 30;

/** What a valid token carries. `sv` (session version) is new in E06: it is
 *  compared against the user's current session_version so a password change,
 *  admin reset, disable, or role change can invalidate outstanding cookies
 *  without server-side session storage. */
export interface SessionClaims {
  uid: string;
  sv: number;
}

// ---------- passwords ----------

/** scrypt with a fresh 16-byte salt, stored as `scrypt$<salt>$<hash>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

/** Constant-time verify against a stored `scrypt$salt$hash`. */
export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** A random temporary password for the admin shown-once reset (FR-18.3).
 *  ~12 URL-safe chars; never stored in plaintext, never audited. */
export function generateTempPassword(): string {
  return randomBytes(9).toString("base64url");
}

/** Invite codes: 12 random bytes, hex (24 chars). */
export function generateInviteCode(): string {
  return randomBytes(12).toString("hex");
}

/** Opaque ids for users and orgs (same 8-byte hex shape v1 used for users). */
export function generateId(): string {
  return randomBytes(8).toString("hex");
}

// ---------- session tokens ----------

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** `base64url({uid,sv,exp}).<hmac>` — v1's shape plus the `sv` claim. */
export function makeSessionToken(
  userId: string,
  sessionVersion: number,
  secret: string,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      uid: userId,
      sv: sessionVersion,
      exp: Date.now() + SESSION_DAYS * 864e5,
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Signature + expiry ONLY. Returns the claims, or null if the token is
 * malformed, tampered, signed under a different secret, expired, or predates
 * E06 (no `sv` claim).
 *
 * This deliberately does NOT decide whether the session is *good*: it cannot
 * see `disabled`, the user's current session_version, or their role. That
 * check needs the database and belongs to getSessionUser(). src/proxy.ts uses
 * this function alone, which is why it is defense-in-depth rather than the
 * authoritative gate.
 */
export function verifySessionToken(token: string, secret: string): SessionClaims | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      uid?: unknown;
      sv?: unknown;
      exp?: unknown;
    };
    if (typeof data.uid !== "string" || !data.uid) return null;
    // Pre-E06 tokens carry no `sv`. Rejecting them is what forces the
    // one-time re-login for everyone on the auth-v2 deploy (documented in
    // docs/OPERATIONS.md) — a token we cannot version is a token we cannot
    // revoke, so it must not be honored.
    if (typeof data.sv !== "number" || !Number.isInteger(data.sv)) return null;
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return { uid: data.uid, sv: data.sv };
  } catch {
    return null;
  }
}

/** Cookie attributes — unchanged from v1 (renaming the cookie is a non-goal). */
export const sessionCookie = {
  name: SESSION_COOKIE,
  options: {
    httpOnly: true,
    sameSite: "lax" as const,
    // A `secure` cookie is never sent over http://localhost, which would break
    // dev login — so it is production-only.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  },
};
