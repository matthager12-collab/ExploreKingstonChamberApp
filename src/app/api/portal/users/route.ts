// Admin-only account management (E06).
//
// GET  → every account with role, disabled, lastLoginAt, orgId (FR-A09's
//        account list). Password hashes never leave the server: the response
//        is built by toPublicUser(), which has no passwordHash field at all.
// POST → the lifecycle actions: reset-password, disable, enable, set-role,
//        delete.
//
// v1 had only listing + reset, and inlined its admin check twice. The gate is
// now the shared requireRole("admin") — 401 unauthenticated, 403 wrong role,
// identical to every other admin route.
//
// Every action that changes what an account may do bumps session_version, so
// it takes effect on the target's very next request rather than whenever their
// 30-day cookie happens to expire. That is FR-A09's same-day revocation, and
// it is why an ex-volunteer can now actually be removed.

import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  ROLES,
  adminResetPassword,
  deleteUser,
  getSessionUser,
  listUsers,
  requireRole,
  setUserDisabled,
  setUserRole,
  toPublicUser,
  type Role,
} from "@/lib/auth";

export async function GET() {
  const denied = await requireRole("admin");
  if (denied) return denied;
  const users = (await listUsers()).map(toPublicUser);
  return NextResponse.json({ users });
}

/**
 * POST { action, userId, ... }
 *
 * - reset-password → a fresh temporary password, returned in THIS response
 *   only. Just the scrypt hash is persisted; the plaintext is stored nowhere
 *   and never audited, so a lost temp means another reset. (Viewing an
 *   existing password is impossible by design — hashes are one-way.)
 * - disable / enable → flip access without destroying the account or the
 *   history it authored.
 * - set-role → move between the five roles; org roles need an organization.
 * - delete → hard-delete the row. Audit entries SURVIVE with the actor id
 *   intact, a dangling reference by design: the trail outlives the account.
 */
export async function POST(request: NextRequest) {
  const denied = await requireRole("admin");
  if (denied) return denied;
  // Safe after the gate: requireRole already proved there is a session.
  const actor = (await getSessionUser())!;

  let body: { action?: unknown; userId?: unknown; role?: unknown; orgId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (typeof body.userId !== "string" || !body.userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  const userId = body.userId;

  try {
    switch (body.action) {
      case "reset-password": {
        const { tempPassword } = await adminResetPassword(userId, actor.email);
        return NextResponse.json({ ok: true, tempPassword });
      }
      case "disable":
      case "enable": {
        const user = await setUserDisabled(userId, body.action === "disable", actor.email);
        return NextResponse.json({ ok: true, user: toPublicUser(user) });
      }
      case "set-role": {
        if (!ROLES.includes(body.role as Role)) {
          return NextResponse.json(
            { error: `role must be one of: ${ROLES.join(", ")}` },
            { status: 400 },
          );
        }
        const orgId = typeof body.orgId === "string" && body.orgId ? body.orgId : undefined;
        const user = await setUserRole(userId, body.role as Role, actor.email, orgId);
        return NextResponse.json({ ok: true, user: toPublicUser(user) });
      }
      case "delete": {
        await deleteUser(userId, actor.email);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "unsupported action" }, { status: 400 });
    }
  } catch (err) {
    // AuthError is the expected, explainable failure (last-admin guard, unknown
    // org, missing user) — surface its message. Anything else is a bug, and its
    // internals must not be echoed to the client.
    if (err instanceof AuthError) {
      const status = err.message === "User not found" ? 404 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("portal/users action failed", err);
    return NextResponse.json({ error: "could not complete that action" }, { status: 500 });
  }
}
