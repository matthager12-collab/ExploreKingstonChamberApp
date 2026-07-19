// Request-bound session handling (E06): turn the vk-session cookie into an
// authenticated subject, and gate route handlers on it.
//
// This is the only auth module that touches next/headers. The primitives it
// builds on are pure (./tokens) so scripts, the proxy, and plain-Node tests can
// use them without a request scope.
//
// The gates here are THE authoritative check. src/proxy.ts also verifies the
// token at the request boundary, but a signature is all it can see — it cannot
// know whether the account was disabled, demoted, or had its sessions revoked
// thirty seconds ago. Those facts need the database, so every route still
// calls one of these.

import "server-only";

import { cookies } from "next/headers";

import { findOrgById, findUserById, type UserRow } from "@/lib/db/auth-store";
import type { Role } from "@/lib/db/schema";
import { can, gate, type Action, type AuthSubject, type Resource } from "./authz";
import { makeSessionToken, sessionCookie, verifySessionToken } from "./tokens";

/** The signed-in user for a request: never carries password material, and
 *  carries the org's linked ids so can() can stay synchronous. */
export interface SessionUser extends AuthSubject {
  orgName: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET missing from the environment");
  return s;
}

/** Mint a token for a user at their CURRENT session version. */
export function tokenFor(user: Pick<UserRow, "id" | "sessionVersion">): string {
  return makeSessionToken(user.id, user.sessionVersion, secret());
}

/** Build the subject can() consumes, joining the org for its linked ids. */
async function toSessionUser(user: UserRow): Promise<SessionUser> {
  const org = user.orgId ? await findOrgById(user.orgId) : undefined;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    orgId: user.orgId,
    orgName: org?.name ?? null,
    // Staff roles get [] — their authority comes from the role, not a list.
    editableIds: org?.linkedIds ?? [],
    entitlements: org?.entitlements ?? {},
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

/**
 * The logged-in user for the current request, or null.
 *
 * Rejects, in order: no cookie; bad signature / expired / pre-E06 token with
 * no `sv`; unknown user; DISABLED user; and `sv` mismatch (the session was
 * revoked by a password change, admin reset, disable, or role change).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(sessionCookie.name)?.value;
  if (!token) return null;
  const claims = verifySessionToken(token, secret());
  if (!claims) return null;

  const user = await findUserById(claims.uid);
  if (!user) return null;
  if (user.disabled) return null;
  // The revocation check. Every bump of session_version orphans every token
  // minted before it.
  if (user.sessionVersion !== claims.sv) return null;

  return toSessionUser(user);
}

// ---------- route gates ----------

/** Signed in (any role)? Returns null to proceed, else a 401. */
export async function requireUser(): Promise<
  { user: SessionUser; response: null } | { user: null; response: Response }
> {
  const user = await getSessionUser();
  const response = gate(user, true);
  return response ? { user: null, response } : { user: user as SessionUser, response: null };
}

/**
 * Role gate for route handlers. Returns null when the caller holds one of the
 * given roles, otherwise the Response to return: 401 unauthenticated, 403
 * signed-in-but-wrong-role.
 *
 * Route handlers bypass the /admin layout and src/proxy.ts cannot see roles,
 * so any role-restricted endpoint must call this itself.
 */
export async function requireRole(...roles: Role[]): Promise<Response | null> {
  const user = await getSessionUser();
  return gate(user, user !== null && roles.includes(user.role));
}

/** v1 alias, preserved so existing admin routes keep working unmodified. */
export async function requireAdmin(): Promise<Response | null> {
  return requireRole("admin");
}

/**
 * Gate on a capability rather than a role — the preferred form for anything
 * resource-scoped, because it routes through the same can() the tests cover.
 */
export async function requireCan(
  action: Action,
  resource?: Resource,
): Promise<Response | null> {
  const user = await getSessionUser();
  return gate(user, user !== null && can(user, action, resource));
}

// ---------- cookie plumbing ----------

/** Attach a fresh session cookie to a response. Used on login AND after any
 *  self-service change that bumps session_version — otherwise the user logs
 *  themselves out by changing their own password. */
export function setSessionCookie(
  response: Response,
  user: Pick<UserRow, "id" | "sessionVersion">,
): Response {
  const o = sessionCookie.options;
  response.headers.append(
    "Set-Cookie",
    [
      `${sessionCookie.name}=${tokenFor(user)}`,
      `Path=${o.path}`,
      `Max-Age=${o.maxAge}`,
      `SameSite=${o.sameSite === "lax" ? "Lax" : o.sameSite}`,
      "HttpOnly",
      ...(o.secure ? ["Secure"] : []),
    ].join("; "),
  );
  return response;
}

export function clearSessionCookie(response: Response): Response {
  const o = sessionCookie.options;
  response.headers.append(
    "Set-Cookie",
    [
      `${sessionCookie.name}=`,
      `Path=${o.path}`,
      "Max-Age=0",
      `SameSite=${o.sameSite === "lax" ? "Lax" : o.sameSite}`,
      "HttpOnly",
      ...(o.secure ? ["Secure"] : []),
    ].join("; "),
  );
  return response;
}
