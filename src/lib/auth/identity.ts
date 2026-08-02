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
  type AuthAuditEntry,
  type InviteRow,
  type OrgRow,
  type UserRow,
} from "@/lib/db/auth-store";
import { ORG_ROLES, type OrgKind, type Role } from "@/lib/db/schema";
import {
  backfillLinkedOwnership,
  findClaimedLinkedRecords,
  OwnershipConflictError,
} from "@/lib/ownership";
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

/** Where an org linked_ids change came from, for the audit row. Redemption
 *  writes "public" (pre-auth surface, same as the user/org rows the redeem
 *  transaction inserts); admin tooling writes "admin". */
type OrgWriteSource = AuthAuditEntry["source"];

/**
 * Set-UNION an org's linked_ids with `ids`. Order-stable (existing ids keep
 * their positions, new ones append) and duplicate-free; a no-op returns the
 * row untouched rather than writing an empty audit row.
 *
 * This is the GRANT half of a claim. can(user, "edit-record", id) decides
 * from linked_ids — NOT from record.owner_org_id — so an ownership stamp
 * without the matching grant is a 403 for the person who was just invited.
 */
export async function addOrgLinkedIds(
  orgId: string,
  ids: readonly string[],
  actor: string,
  source: OrgWriteSource = "admin",
): Promise<OrgRow> {
  const org = await findOrgById(orgId);
  if (!org) throw new AuthError("Unknown organization");
  const next = [...org.linkedIds];
  for (const id of ids) {
    if (!next.includes(id)) next.push(id);
  }
  if (next.length === org.linkedIds.length) return org;
  return updateOrg(orgId, { linkedIds: next }, { actor, action: "org-update", source });
}

/**
 * Set-DIFFERENCE an org's linked_ids — the grant half of a release. Removing
 * the id is what actually revokes the business's edit access; clearing
 * record.owner_org_id alone would leave them editing a listing the console
 * calls unclaimed.
 */
export async function removeOrgLinkedIds(
  orgId: string,
  ids: readonly string[],
  actor: string,
  source: OrgWriteSource = "admin",
): Promise<OrgRow | null> {
  const org = await findOrgById(orgId);
  if (!org) return null;
  const drop = new Set(ids);
  const next = org.linkedIds.filter((id) => !drop.has(id));
  if (next.length === org.linkedIds.length) return org;
  return updateOrg(orgId, { linkedIds: next }, { actor, action: "org-update", source });
}

/** E12: flip an org's trusted-auto-publish moderation bypass (FR-EVT-04).
 *  Admin-gated at every call site; audit-rowed like every org mutation. */
export async function setOrgTrustedAutoPublish(
  orgId: string,
  trusted: boolean,
  actor: string,
): Promise<OrgRow> {
  return updateOrg(
    orgId,
    { trustedAutoPublish: trusted },
    { actor, action: "org-update", source: "admin" },
  );
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

/** The store universe an invite's linked ids point into, derived from the
 *  role exactly the way mintInvite derives the new-org kind — so mint
 *  validation, the redeem re-check, and the ownership backfill all read the
 *  same stores for the same invite. */
function linkedKindFor(role: Role): OrgKind {
  return role === "member-business" ? "business" : "nonprofit";
}

/**
 * Redeem an invite and create the account.
 *
 * Every rejection returns the SAME message. Distinguishing expired from
 * revoked from already-used would turn the endpoint into an oracle for
 * probing which codes ever existed.
 *
 * E17 ownership: after the invite checks pass but BEFORE any row is created,
 * every linked record is re-checked against the UNION of both halves of a
 * claim (record.owner_org_id and any org's linked_ids) — a listing claimed
 * between mint and redeem refuses cleanly (OwnershipConflictError → 409)
 * with no user, no org, and no session. On success both halves are landed:
 * the org's linked_ids gain the invite's ids (the transaction only does that
 * for orgs it CREATES) and owner_org_id is backfilled onto every linked
 * record still unowned.
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

  const validate = (invite: InviteRow) => {
    if (invite.usedBy) throw invalid();
    if (invite.revokedAt) throw invalid();
    if (invite.expiresAt.getTime() <= Date.now()) throw invalid();
    if (invite.email && invite.email.toLowerCase() !== email.toLowerCase()) {
      // Distinct message: the holder needs to know to use the invited
      // address. It reveals nothing they do not already have.
      throw new AuthError("This invite is bound to a different email address.");
    }
  };

  // Advisory pre-read: run the SAME validity checks first (an expired or
  // burned code must answer identically whether or not its records are
  // claimed), then the ownership re-check. It runs outside the redemption
  // transaction — readRecordRows on the global handle inside an open tx
  // would deadlock PGlite's single connection — which is fine: the check
  // this closes is a claim that landed between mint and redeem, and nothing
  // below creates rows before it passes.
  const preview = await findInvite(code);
  if (!preview) throw invalid();
  validate(preview);
  if (preview.linkedIds.length > 0) {
    // The UNION of both halves of a claim: owner_org_id AND any org whose
    // linked_ids already grant edit rights. Keying on owner_org_id alone let
    // a redemption whose stamp never landed look unclaimed, so a second org
    // could be invited over a listing the first one can already edit.
    const claimed = await findClaimedLinkedRecords(
      linkedKindFor(preview.role),
      preview.linkedIds,
      await listOrgs(),
      // An invite that JOINS an existing org is not in conflict with that
      // org's own claim — being added to the holder is the whole point.
      { ignoreOrgId: preview.orgId },
    );
    if (claimed.length > 0) {
      throw new OwnershipConflictError(
        "This listing has already been claimed — contact the Chamber.",
      );
    }
  }

  const redeemed = await redeemInviteTx({
    code,
    actor: email || "system",
    // Re-checked against the row locked FOR UPDATE inside the transaction.
    validate,
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

  // E17: land BOTH halves of the claim. Neither may throw — the redemption
  // has committed, the code is burned, and the account exists; failing the
  // response here would strand a real person with no way back in. They log
  // in detail instead, and both the claims console and the mint refusal read
  // the UNION of the two halves, so a half-applied claim shows up as a
  // warning rather than as a listing that looks free to hand out again.
  if (preview.linkedIds.length > 0 && redeemed.user.orgId) {
    // (1) THE GRANT. redeemInviteTx's buildOrg returns null when the invite
    //     joins an EXISTING org, so that org's linked_ids were never
    //     extended — and can() reads edit rights from linked_ids, not from
    //     owner_org_id. Without this the invited user gets a 403 on the very
    //     listing they were invited to claim. A newly created org already
    //     carries the invite's linkedIds from inside the transaction.
    //
    //     Grant first, stamp second, deliberately: if only one half lands,
    //     the half that lets the owner do their job is the better one to keep.
    if (!redeemed.org) {
      try {
        await addOrgLinkedIds(
          redeemed.user.orgId,
          preview.linkedIds,
          redeemed.user.email,
          "public",
        );
      } catch (err) {
        console.error("invite-redeem linked-id grant failed", {
          orgId: redeemed.user.orgId,
          linkedIds: preview.linkedIds,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // (2) THE OWNERSHIP STAMP, each write audited (source "portal", actor =
    //     the new account). The structured result is logged whenever anything
    //     did not land cleanly: "backfill failed" with no detail is what let
    //     a half-applied claim go unnoticed.
    try {
      const outcome = await backfillLinkedOwnership(
        linkedKindFor(preview.role),
        preview.linkedIds,
        redeemed.user.orgId,
        redeemed.user.email,
      );
      if (!outcome.complete) {
        console.error("invite-redeem ownership backfill incomplete", {
          orgId: outcome.orgId,
          requested: outcome.requested,
          stamped: outcome.stamped,
          skipped: outcome.skipped,
          failed: outcome.failed,
        });
      }
    } catch (err) {
      console.error("invite-redeem ownership backfill failed", {
        orgId: redeemed.user.orgId,
        linkedIds: preview.linkedIds,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return redeemed;
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
