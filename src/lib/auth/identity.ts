// Identity domain API (E06): users, orgs, and invites as business operations
// rather than table rows.
//
// Layering: this module owns the RULES (password length, invite expiry, email
// binding, the last-admin guard); src/lib/db/auth-store.ts owns the SQL. It
// imports no next/headers and no request scope, so scripts/migrate-auth-v2.mjs
// and the test suites can drive it directly.
//
// NOT YET WIRED: E06 step 1 is additive. The live app still runs on
// src/lib/auth.ts (the record-store model) until the data migration has run —
// deleting it before then would break login on a deployed main. The route
// swap happens in one coherent change once the new tables hold data.

import {
  appendAuthAudit,
  countEnabledAdmins,
  countUsers,
  deleteUser as deleteUserRow,
  findInvite,
  findOrgById,
  findUserByEmail as findUserRowByEmail,
  findUserById,
  insertInvite,
  insertOrg,
  insertUser,
  listInvites as listInviteRows,
  listOrgs,
  listUsers as listUserRows,
  redeemInviteTx,
  revokeInvite as revokeInviteRow,
  updateOrg,
  updateUser,
  type InviteRow,
  type OrgRow,
  type UserRow,
} from "@/lib/db/auth-store";
import { ORG_ROLES, type OrgKind, type Role } from "@/lib/db/schema";
import {
  generateId,
  generateInviteCode,
  generateTempPassword,
  hashPassword,
  verifyPassword,
} from "./tokens";

export type { InviteRow, OrgRow, UserRow };

/** Days a freshly minted invite stays redeemable. */
export const INVITE_TTL_DAYS = 14;
export const MIN_PASSWORD_LENGTH = 8;

/** Thrown for conditions the caller should surface to a human as a 400. */
export class AuthError extends Error {}

function isOrgRole(role: Role): boolean {
  return (ORG_ROLES as readonly string[]).includes(role);
}

/** A user as it may leave the server: password_hash removed BY CONSTRUCTION.
 *  Every serialization boundary uses this — never a raw UserRow. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  orgId: string | null;
  disabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    orgId: u.orgId,
    disabled: u.disabled,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

// ---------- reads ----------

export const listUsers = listUserRows;
export const listOrganizations = listOrgs;
export const getOrg = findOrgById;
export const getUser = findUserById;
export const findUserByEmail = findUserRowByEmail;

/** Bootstrap gate: /portal/setup only creates the first admin when this is false. */
export async function hasAnyUsers(): Promise<boolean> {
  return (await countUsers()) > 0;
}

// ---------- credentials ----------

/**
 * Verify an email + password pair. Returns the user only when the credentials
 * match AND the account is enabled.
 *
 * A disabled account and a wrong password are indistinguishable to the caller
 * on purpose — reporting "this account is disabled" would confirm the address
 * exists. The password is still verified for a disabled user so the response
 * time does not leak account state either.
 */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<UserRow | null> {
  const user = await findUserRowByEmail(email);
  if (!user) return null;
  const ok = verifyPassword(password, user.passwordHash);
  if (!ok || user.disabled) return null;
  return user;
}

/** Stamp a successful sign-in and audit it. */
export async function recordLogin(user: UserRow): Promise<UserRow> {
  return updateUser(
    user.id,
    { lastLoginAt: new Date() },
    { actor: user.email, action: "login", source: "public" },
  );
}

/** Takes only what it writes, so a SessionUser (which has no passwordHash)
 *  satisfies it as readily as a UserRow. */
export async function recordLogout(user: Pick<UserRow, "id" | "email">): Promise<void> {
  await appendAuthAudit({
    actor: user.email,
    action: "logout",
    store: "users",
    recordId: user.id,
    source: "portal",
  });
}

/**
 * Self-service password change. Bumps session_version, which invalidates every
 * outstanding token for this user — INCLUDING the caller's own cookie, so the
 * route MUST set a fresh one on the response (see docs/OPERATIONS.md).
 */
export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<UserRow> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(`New password must be ${MIN_PASSWORD_LENGTH}+ characters`);
  }
  const user = await findUserById(userId);
  if (!user) throw new AuthError("User not found");
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    throw new AuthError("Current password is incorrect");
  }
  return updateUser(
    userId,
    { passwordHash: hashPassword(newPassword) },
    { actor: user.email, action: "password-change", source: "portal" },
    { bumpSession: true },
  );
}

/**
 * Admin reset: sets a random temporary password, bumps session_version (so the
 * reset actually revokes a hijacked cookie — v1's did not), and returns the
 * temp ONCE. The temp password is never stored in plaintext and never audited;
 * only the fact of the reset is.
 */
export async function adminResetPassword(
  userId: string,
  actor: string,
): Promise<{ user: UserRow; tempPassword: string }> {
  const target = await findUserById(userId);
  if (!target) throw new AuthError("User not found");
  const tempPassword = generateTempPassword();
  const user = await updateUser(
    userId,
    { passwordHash: hashPassword(tempPassword) },
    { actor, action: "admin-reset", source: "admin" },
    { bumpSession: true },
  );
  return { user, tempPassword };
}

/** Self-service profile update. Email uniqueness is enforced by the DB index;
 *  the pre-check exists only to return a friendly message. */
export async function updateOwnProfile(
  userId: string,
  input: { name?: string; email?: string },
): Promise<UserRow> {
  const user = await findUserById(userId);
  if (!user) throw new AuthError("User not found");
  const email = input.email?.trim();
  if (email) {
    const clash = await findUserRowByEmail(email);
    if (clash && clash.id !== userId) {
      throw new AuthError("Another account already uses that email");
    }
  }
  return updateUser(
    userId,
    { name: input.name?.trim() || user.name, email: email || user.email },
    { actor: user.email, action: "profile-update", source: "portal" },
  );
}

// ---------- lifecycle ----------

/**
 * The last-admin guard. Refuses any change that would leave the Chamber with
 * zero enabled admins — disabling, deleting, or demoting the only one.
 *
 * Mechanical on purpose: it counts enabled admins rather than trusting the
 * caller to notice. Self-targeting is otherwise allowed (an admin may disable
 * themselves) — this is the single exception.
 */
async function assertNotLastAdmin(target: UserRow, change: "disable" | "delete" | "demote"): Promise<void> {
  if (target.role !== "admin" || target.disabled) return;
  const enabled = await countEnabledAdmins();
  if (enabled <= 1) {
    throw new AuthError(
      `Cannot ${change} the last enabled admin — promote another admin first.`,
    );
  }
}

export async function setUserDisabled(
  userId: string,
  disabled: boolean,
  actor: string,
): Promise<UserRow> {
  const target = await findUserById(userId);
  if (!target) throw new AuthError("User not found");
  if (disabled) await assertNotLastAdmin(target, "disable");
  return updateUser(
    userId,
    { disabled },
    { actor, action: disabled ? "disable" : "enable", source: "admin" },
    // Disabling revokes outstanding cookies immediately (FR-A09). Enabling
    // bumps too, so a token minted before a disable can never come back to life.
    { bumpSession: true },
  );
}

/**
 * Change a role. Moving between staff and org roles has to move org_id with
 * it, or the users_org_binding check rejects the write.
 */
export async function setUserRole(
  userId: string,
  role: Role,
  actor: string,
  orgId?: string | null,
): Promise<UserRow> {
  const target = await findUserById(userId);
  if (!target) throw new AuthError("User not found");
  if (target.role === "admin" && role !== "admin") {
    await assertNotLastAdmin(target, "demote");
  }
  let nextOrgId: string | null;
  if (isOrgRole(role)) {
    nextOrgId = orgId !== undefined ? orgId : target.orgId;
    if (!nextOrgId) {
      throw new AuthError(`The ${role} role needs an organization — pick one.`);
    }
    if (!(await findOrgById(nextOrgId))) throw new AuthError("Unknown organization");
  } else {
    // Staff roles carry no org.
    nextOrgId = null;
  }
  return updateUser(
    userId,
    { role, orgId: nextOrgId },
    { actor, action: "role-change", source: "admin" },
    // A demotion must not leave the old role's cookie valid.
    { bumpSession: true },
  );
}

/** Hard-delete. Audit rows survive with the actor id intact, by design. */
export async function deleteUser(userId: string, actor: string): Promise<void> {
  const target = await findUserById(userId);
  if (!target) throw new AuthError("User not found");
  await assertNotLastAdmin(target, "delete");
  await deleteUserRow(userId, { actor, action: "user-delete", source: "admin" });
}

// ---------- orgs ----------

export async function createOrg(
  input: { name: string; kind: OrgKind; linkedIds?: string[] },
  actor: string,
): Promise<OrgRow> {
  return insertOrg(
    {
      id: generateId(),
      name: input.name.trim(),
      kind: input.kind,
      linkedIds: input.linkedIds ?? [],
    },
    { actor, action: "org-create", source: "admin" },
  );
}

export async function updateOrgProfile(
  orgId: string,
  patch: { name?: string; linkedIds?: string[] },
  actor: string,
): Promise<OrgRow> {
  return updateOrg(orgId, patch, { actor, action: "org-update", source: "admin" });
}

// ---------- invites ----------

export const listInvites = listInviteRows;

/** Derived state for the admin list — v1 had only "used or not". */
export type InviteState = "active" | "used" | "revoked" | "expired";

export function inviteState(invite: InviteRow, now: Date = new Date()): InviteState {
  if (invite.usedBy) return "used";
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export interface NewInviteInput {
  role: Role;
  linkedIds?: string[];
  email?: string | null;
  note?: string | null;
  /** Join an existing org... */
  orgId?: string | null;
  /** ...or create one on redemption. Exactly one, for org roles. */
  newOrgName?: string | null;
  newOrgKind?: OrgKind | null;
  expiresAt?: Date;
}

/**
 * Mint an invite. The DB enforces the same invariants (admin-requires-email,
 * org join-XOR-create) — these checks exist to produce a readable message
 * instead of a constraint violation.
 */
export async function createInvite(
  input: NewInviteInput,
  actor: string,
): Promise<InviteRow> {
  const email = input.email?.trim() || null;
  if (input.role === "admin" && !email) {
    throw new AuthError(
      "An admin invite must be bound to an email address — an unbound admin code is a bearer grant.",
    );
  }
  const orgRole = isOrgRole(input.role);
  const orgId = input.orgId?.trim() || null;
  const newOrgName = input.newOrgName?.trim() || null;
  if (orgRole) {
    if (orgId && newOrgName) {
      throw new AuthError("Choose either an existing organization or a new one, not both.");
    }
    if (!orgId && !newOrgName) {
      throw new AuthError("Pick an existing organization or name a new one.");
    }
    if (newOrgName && !input.newOrgKind) {
      throw new AuthError("A new organization needs a kind (business or nonprofit).");
    }
    if (orgId && !(await findOrgById(orgId))) throw new AuthError("Unknown organization");
  } else if (orgId || newOrgName) {
    throw new AuthError(`The ${input.role} role is Chamber staff and takes no organization.`);
  }

  const expiresAt =
    input.expiresAt ?? new Date(Date.now() + INVITE_TTL_DAYS * 864e5);

  return insertInvite(
    {
      code: generateInviteCode(),
      role: input.role,
      orgId: orgRole ? orgId : null,
      newOrgName: orgRole ? newOrgName : null,
      newOrgKind: orgRole && newOrgName ? (input.newOrgKind ?? null) : null,
      linkedIds: input.linkedIds ?? [],
      email,
      note: input.note?.trim() || null,
      createdBy: actor,
      expiresAt,
    },
    { actor, action: "invite-mint", source: "admin" },
  );
}

export async function revokeInvite(code: string, actor: string): Promise<boolean> {
  const row = await revokeInviteRow(code, {
    actor,
    action: "invite-revoke",
    source: "admin",
  });
  return Boolean(row);
}

export const getInvite = findInvite;

/**
 * Redeem an invite and create the account.
 *
 * Every rejection returns the SAME message. Distinguishing expired from
 * revoked from already-used would turn the endpoint into an oracle for
 * probing which codes ever existed.
 */
export async function redeemInvite(
  code: string,
  account: { email: string; name: string; password: string },
): Promise<{ user: UserRow; org: OrgRow | null }> {
  const invalid = () => new AuthError("Invalid or expired invite code");
  if (account.password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(`Password must be ${MIN_PASSWORD_LENGTH}+ characters`);
  }
  const email = account.email.trim();

  return redeemInviteTx({
    code,
    actor: email || "system",
    // Re-checked against the row locked FOR UPDATE inside the transaction.
    validate: (invite) => {
      if (invite.usedBy) throw invalid();
      if (invite.revokedAt) throw invalid();
      if (invite.expiresAt.getTime() <= Date.now()) throw invalid();
      if (invite.email && invite.email.toLowerCase() !== email.toLowerCase()) {
        // Distinct message: the holder needs to know to use the invited
        // address. It reveals nothing they do not already have.
        throw new AuthError("This invite is bound to a different email address.");
      }
    },
    buildOrg: (invite) =>
      invite.newOrgName
        ? {
            id: generateId(),
            name: invite.newOrgName,
            kind: invite.newOrgKind ?? "business",
            linkedIds: invite.linkedIds,
          }
        : null,
    buildUser: (invite, orgId) => ({
      id: generateId(),
      email,
      name: account.name.trim(),
      role: invite.role,
      orgId,
      passwordHash: hashPassword(account.password),
    }),
  });
}

/**
 * Bootstrap the first admin. Callers (POST /api/auth/setup) still gate on
 * SETUP_TOKEN and on hasAnyUsers() — this only refuses to be the second.
 */
export async function createFirstAdmin(input: {
  email: string;
  name: string;
  password: string;
}): Promise<UserRow> {
  if (await hasAnyUsers()) throw new AuthError("Setup has already been completed");
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(`Password must be ${MIN_PASSWORD_LENGTH}+ characters`);
  }
  return insertUser(
    {
      id: generateId(),
      email: input.email.trim(),
      name: input.name.trim(),
      role: "admin",
      orgId: null,
      passwordHash: hashPassword(input.password),
    },
    { actor: input.email || "system", action: "user-create", source: "public" },
  );
}
