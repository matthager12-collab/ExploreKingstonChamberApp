// Data layer for the E06 auth tables (users / orgs / invites).
//
// Why this lives under src/lib/db/ and not src/lib/auth/: only src/lib/db/**
// may import the Postgres client (dependency-cruiser `db-client-only-via-db-layer`
// + the eslint no-restricted-imports twin). src/lib/auth/identity.ts is the
// domain API on top of this, exactly as src/lib/stores/json-store.ts delegates
// to src/lib/db/records.ts.
//
// This module, records.ts, and worklist.ts (E08) are the ONLY writers of the
// append-only `audit` table. Auth mutations and their audit rows go in ONE
// transaction — a lifecycle change that committed without its trail would be
// worse than one that failed outright.
//
// Audit payloads here are built from an explicit ALLOWLIST (auditableUser),
// never by dumping a row. records.ts redacts known-secret KEYS on the way out;
// that is a good backstop, but for a table whose whole purpose is credentials,
// listing what may leave is safer than listing what may not.

import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { getDb, type Db } from "./client";
import { audit, invites, orgs, users, type Role, type OrgKind } from "./schema";

export type UserRow = typeof users.$inferSelect;
export type OrgRow = typeof orgs.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;

/** Any Drizzle handle — the shared client or an open transaction. */
type Handle = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Auth lifecycle events written to the shared audit trail. The `audit.action`
 *  column is free text (no check constraint), so E06 extends the E05
 *  create/update/delete/import vocabulary rather than fighting it. */
export type AuthAuditAction =
  | "login"
  | "logout"
  | "user-create"
  | "password-change"
  | "admin-reset"
  | "role-change"
  | "disable"
  | "enable"
  | "user-delete"
  | "profile-update"
  | "invite-mint"
  | "invite-revoke"
  | "invite-redeem"
  | "org-create"
  | "org-update";

export interface AuthAuditEntry {
  actor: string;
  action: AuthAuditAction;
  store: "users" | "orgs" | "invites";
  recordId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** admin = staff tooling, portal = signed-in self-service, public = pre-auth
   *  surfaces (login, redeem). Mirrors v1's actorMeta convention. */
  source: "admin" | "portal" | "public";
}

/** The ONLY user fields allowed into an audit row. password_hash is absent by
 *  construction — it can never be added by a careless spread. */
export function auditableUser(u: UserRow): Record<string, unknown> {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    orgId: u.orgId,
    disabled: u.disabled,
    sessionVersion: u.sessionVersion,
  };
}

/** Invite fields allowed into an audit row (no secrets, but keep it explicit). */
export function auditableInvite(i: InviteRow): Record<string, unknown> {
  return {
    code: i.code,
    role: i.role,
    orgId: i.orgId,
    newOrgName: i.newOrgName,
    email: i.email,
    linkedIds: i.linkedIds,
    expiresAt: i.expiresAt?.toISOString() ?? null,
    revokedAt: i.revokedAt?.toISOString() ?? null,
    usedBy: i.usedBy,
  };
}

export async function appendAuthAudit(entry: AuthAuditEntry, tx?: Handle): Promise<void> {
  const h = tx ?? getDb();
  await h.insert(audit).values({
    actor: entry.actor,
    action: entry.action,
    store: entry.store,
    recordId: entry.recordId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    source: entry.source,
  });
}

// ---------- users ----------

export async function listUsers(): Promise<UserRow[]> {
  return getDb().select().from(users).orderBy(users.createdAt);
}

export async function countUsers(): Promise<number> {
  const [row] = await getDb().select({ n: sql<number>`count(*)::int` }).from(users);
  return row?.n ?? 0;
}

export async function findUserById(id: string): Promise<UserRow | undefined> {
  const [row] = await getDb().select().from(users).where(eq(users.id, id));
  return row;
}

/** Case-insensitive, matching the DB's unique index on lower(email). */
export async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`);
  return row;
}

/** Enabled admins, used by the last-admin guard. */
export async function countEnabledAdmins(): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.disabled, false)));
  return row?.n ?? 0;
}

export interface NewUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  orgId: string | null;
  passwordHash: string;
}

export async function insertUser(
  input: NewUser,
  entry: Omit<AuthAuditEntry, "store" | "recordId" | "before" | "after">,
): Promise<UserRow> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx.insert(users).values(input).returning();
    await appendAuthAudit(
      { ...entry, store: "users", recordId: row.id, after: auditableUser(row) },
      tx,
    );
    return row;
  });
}

/** Fields a lifecycle action may change. `sessionVersion` is bumped via
 *  `bumpSession`, not set directly, so revocation intent is always explicit. */
export interface UserPatch {
  name?: string;
  email?: string;
  role?: Role;
  orgId?: string | null;
  passwordHash?: string;
  disabled?: boolean;
  lastLoginAt?: Date;
}

export async function updateUser(
  id: string,
  patch: UserPatch,
  entry: Omit<AuthAuditEntry, "store" | "recordId" | "before" | "after">,
  opts?: { bumpSession?: boolean },
): Promise<UserRow> {
  return getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(users).where(eq(users.id, id));
    if (!before) throw new Error("User not found");
    const [row] = await tx
      .update(users)
      .set({
        ...patch,
        ...(opts?.bumpSession ? { sessionVersion: before.sessionVersion + 1 } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    await appendAuthAudit(
      {
        ...entry,
        store: "users",
        recordId: id,
        before: auditableUser(before),
        after: auditableUser(row),
      },
      tx,
    );
    return row;
  });
}

/** Hard-delete. Audit rows deliberately SURVIVE with the actor id intact — a
 *  dangling reference by design (E06 constraint: the trail outlives the row). */
export async function deleteUser(
  id: string,
  entry: Omit<AuthAuditEntry, "store" | "recordId" | "before" | "after">,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(users).where(eq(users.id, id));
    if (!before) throw new Error("User not found");
    await tx.delete(users).where(eq(users.id, id));
    await appendAuthAudit(
      { ...entry, store: "users", recordId: id, before: auditableUser(before) },
      tx,
    );
  });
}

// ---------- orgs ----------

export async function findOrgById(id: string): Promise<OrgRow | undefined> {
  const [row] = await getDb().select().from(orgs).where(eq(orgs.id, id));
  return row;
}

export async function listOrgs(): Promise<OrgRow[]> {
  return getDb().select().from(orgs).orderBy(orgs.name);
}

export async function insertOrg(
  input: { id: string; name: string; kind: OrgKind; linkedIds: string[] },
  entry: Omit<AuthAuditEntry, "store" | "recordId" | "before" | "after">,
): Promise<OrgRow> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx.insert(orgs).values(input).returning();
    await appendAuthAudit(
      { ...entry, store: "orgs", recordId: row.id, after: { ...row } },
      tx,
    );
    return row;
  });
}

export async function updateOrg(
  id: string,
  patch: { name?: string; linkedIds?: string[] },
  entry: Omit<AuthAuditEntry, "store" | "recordId" | "before" | "after">,
): Promise<OrgRow> {
  return getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(orgs).where(eq(orgs.id, id));
    if (!before) throw new Error("Organization not found");
    const [row] = await tx
      .update(orgs)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(orgs.id, id))
      .returning();
    await appendAuthAudit(
      { ...entry, store: "orgs", recordId: id, before: { ...before }, after: { ...row } },
      tx,
    );
    return row;
  });
}

// ---------- invites ----------

export async function listInvites(): Promise<InviteRow[]> {
  return getDb().select().from(invites).orderBy(invites.createdAt);
}

export async function findInvite(code: string): Promise<InviteRow | undefined> {
  const [row] = await getDb().select().from(invites).where(eq(invites.code, code));
  return row;
}

export interface NewInvite {
  code: string;
  role: Role;
  orgId: string | null;
  newOrgName: string | null;
  newOrgKind: OrgKind | null;
  linkedIds: string[];
  email: string | null;
  note: string | null;
  createdBy: string;
  expiresAt: Date;
}

export async function insertInvite(
  input: NewInvite,
  entry: Omit<AuthAuditEntry, "store" | "recordId" | "before" | "after">,
): Promise<InviteRow> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx.insert(invites).values(input).returning();
    await appendAuthAudit(
      { ...entry, store: "invites", recordId: row.code, after: auditableInvite(row) },
      tx,
    );
    return row;
  });
}

/** Same-day revocation for an un-redeemed grant (FR-A09). Idempotent: only
 *  un-revoked, un-used codes are touched. Returns the row, or undefined when
 *  there was nothing to revoke. */
export async function revokeInvite(
  code: string,
  entry: Omit<AuthAuditEntry, "store" | "recordId" | "before" | "after">,
): Promise<InviteRow | undefined> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(and(eq(invites.code, code), isNull(invites.revokedAt), isNull(invites.usedBy)))
      .returning();
    if (!row) return undefined;
    await appendAuthAudit(
      { ...entry, store: "invites", recordId: code, after: auditableInvite(row) },
      tx,
    );
    return row;
  });
}

/** Everything a redemption does, in ONE transaction: re-check the invite under
 *  lock, create the org if the invite creates one, create the user, burn the
 *  code. Any failure (including the DB's unique-email index) rolls back the
 *  whole thing, so a redemption can never half-apply.
 *
 * `validate` runs against the freshly-locked row — the caller's earlier read is
 * advisory only. This is what closes the double-redeem race: two concurrent
 * requests serialize on the row lock, and the second sees used_by set. */
export async function redeemInviteTx(args: {
  code: string;
  validate: (invite: InviteRow) => void;
  buildOrg: (invite: InviteRow) => { id: string; name: string; kind: OrgKind; linkedIds: string[] } | null;
  buildUser: (invite: InviteRow, orgId: string | null) => NewUser;
  actor: string;
}): Promise<{ user: UserRow; org: OrgRow | null }> {
  return getDb().transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(invites)
      .where(eq(invites.code, args.code))
      .for("update");
    if (!invite) throw new Error("Invalid or expired invite code");
    args.validate(invite);

    let org: OrgRow | null = null;
    const orgInput = args.buildOrg(invite);
    if (orgInput) {
      [org] = await tx.insert(orgs).values(orgInput).returning();
      await appendAuthAudit(
        {
          actor: args.actor,
          action: "org-create",
          store: "orgs",
          recordId: org.id,
          after: { ...org },
          source: "public",
        },
        tx,
      );
    }

    const [user] = await tx
      .insert(users)
      .values(args.buildUser(invite, org?.id ?? invite.orgId ?? null))
      .returning();
    await appendAuthAudit(
      {
        actor: args.actor,
        action: "user-create",
        store: "users",
        recordId: user.id,
        after: auditableUser(user),
        source: "public",
      },
      tx,
    );

    const [used] = await tx
      .update(invites)
      .set({ usedBy: user.id, usedAt: new Date() })
      .where(eq(invites.code, args.code))
      .returning();
    await appendAuthAudit(
      {
        actor: args.actor,
        action: "invite-redeem",
        store: "invites",
        recordId: args.code,
        after: auditableInvite(used),
        source: "public",
      },
      tx,
    );

    return { user, org };
  });
}
