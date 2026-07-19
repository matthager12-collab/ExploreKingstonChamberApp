// Auth v2 identity, tokens, and invite lifecycle (E06), over PGlite.
//
// Runs against a REAL Postgres engine migrated with the checked-in
// db/migrations/, so the schema-level guarantees this epic added (the unique
// index on lower(email), the invite check constraints) are exercised as
// constraints, not as app-code politeness.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import { eq, sql } from "drizzle-orm";

import {
  AuthError,
  adminResetPassword,
  changeOwnPassword,
  createFirstAdmin,
  createInvite,
  createOrg,
  deleteUser,
  hasAnyUsers,
  inviteState,
  redeemInvite,
  revokeInvite,
  setUserDisabled,
  setUserRole,
  updateOwnProfile,
  verifyCredentials,
} from "@/lib/auth/identity";
import {
  hashPassword,
  makeSessionToken,
  verifyPassword,
  verifySessionToken,
} from "@/lib/auth/tokens";
import { audit, invites, orgs, users } from "@/lib/db/schema";
import { createTestDb, type TestDb } from "../setup/pglite-db";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});
afterEach(async () => {
  // Order matters: users/invites reference orgs.
  await tdb.db.delete(users);
  await tdb.db.delete(invites);
  await tdb.db.delete(orgs);
  // TRUNCATE, not DELETE: E05's audit_immutable() trigger rejects DELETE on
  // this table by design (it is append-only in production too). Row triggers
  // do not fire on TRUNCATE, which is the sanctioned way to reset it in tests.
  await tdb.db.execute(sql`TRUNCATE audit`);
});

const SECRET = "test-secret";

async function seedAdmin(email = "admin@example.test") {
  return createFirstAdmin({ email, name: "Admin", password: "admin-password" });
}

// ---------------------------------------------------------------------------
// Passwords — the ported mechanics. These must not drift: existing hashes have
// to keep verifying, because E06 ships no rehash migration.
// ---------------------------------------------------------------------------

describe("password hashing (ported byte-compatibly from v1)", () => {
  it("round-trips a password it hashed itself", () => {
    const stored = hashPassword("hunter2-hunter2");
    expect(verifyPassword("hunter2-hunter2", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("verifies a hash STORED BY v1 (fixture) — no rehash migration needed", () => {
    // Produced by the pre-E06 hashPassword: scrypt, 16-byte hex salt, N=64.
    // If scrypt parameters or the storage format ever change, this fails and
    // every existing account would have been locked out on deploy.
    const legacy =
      "scrypt$9f86d081884c7d659a2feaa0c55ad015$76bd7b9e95d158ec404b372b587f6eea83bc9befbd14113ec804fbd77ff56292365e4d2922c4820b6912a1107d38f471b55b4ecd3182a66f083cb3325bd4ed82";
    expect(verifyPassword("correct horse battery staple", legacy)).toBe(true);
    expect(verifyPassword("not the password", legacy)).toBe(false);
  });

  it("salts: the same password hashes differently every time", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("rejects malformed stored values instead of throwing", () => {
    for (const bad of ["", "plaintext", "bcrypt$a$b", "scrypt$onlysalt"]) {
      expect(verifyPassword("x", bad)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Session tokens — the revocation mechanism.
// ---------------------------------------------------------------------------

describe("session tokens", () => {
  it("round-trips uid and session version", () => {
    const t = makeSessionToken("u1", 7, SECRET);
    expect(verifySessionToken(t, SECRET)).toEqual({ uid: "u1", sv: 7 });
  });

  it("rejects a token signed under a different secret", () => {
    expect(verifySessionToken(makeSessionToken("u1", 0, SECRET), "other")).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const [payload, sig] = makeSessionToken("u1", 0, SECRET).split(".");
    const evil = Buffer.from(JSON.stringify({ uid: "admin", sv: 0, exp: Date.now() + 1e6 }))
      .toString("base64url");
    expect(verifySessionToken(`${evil}.${sig}`, SECRET)).toBeNull();
    expect(verifySessionToken(`${payload}.${sig}x`, SECRET)).toBeNull();
    expect(verifySessionToken("no-dot-separator", SECRET)).toBeNull();
  });

  it("rejects an expired token", () => {
    const expired = Buffer.from(
      JSON.stringify({ uid: "u1", sv: 0, exp: Date.now() - 1000 }),
    ).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(expired).digest("base64url");
    expect(verifySessionToken(`${expired}.${sig}`, SECRET)).toBeNull();
  });

  it("REJECTS a pre-E06 token that carries no `sv` claim", () => {
    // v1's payload shape. A token we cannot version is a token we cannot
    // revoke — hence the one forced re-login at the auth-v2 deploy.
    const legacy = Buffer.from(
      JSON.stringify({ uid: "u1", exp: Date.now() + 1e6 }),
    ).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(legacy).digest("base64url");
    expect(verifySessionToken(`${legacy}.${sig}`, SECRET)).toBeNull();
  });

  it("rejects a non-integer sv", () => {
    const bad = Buffer.from(
      JSON.stringify({ uid: "u1", sv: "0", exp: Date.now() + 1e6 }),
    ).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(bad).digest("base64url");
    expect(verifySessionToken(`${bad}.${sig}`, SECRET)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Users and the database's own guarantees.
// ---------------------------------------------------------------------------

describe("users", () => {
  it("hasAnyUsers gates bootstrap and flips after the first admin", async () => {
    expect(await hasAnyUsers()).toBe(false);
    await seedAdmin();
    expect(await hasAnyUsers()).toBe(true);
  });

  it("refuses to create a second first-admin", async () => {
    await seedAdmin();
    await expect(
      createFirstAdmin({ email: "b@x.test", name: "B", password: "password123" }),
    ).rejects.toThrow(AuthError);
  });

  it("the DATABASE rejects a duplicate email differing only in case", async () => {
    await seedAdmin("Mat@Example.test");
    // Not an app-level check — the unique index on lower(email) is what fails,
    // which is what closes v1's read-then-write TOCTOU window. Drizzle wraps
    // driver errors, so the constraint name lives on `.cause`, not `.message`.
    const insert = tdb.db.insert(users).values({
      id: "dupe",
      email: "mat@example.TEST",
      name: "Dupe",
      role: "admin",
      orgId: null,
      passwordHash: "scrypt$a$b",
    });
    await expect(insert).rejects.toThrow();
    const cause = await insert.then(
      () => null,
      (e: { cause?: { message?: string } }) => e.cause?.message ?? "",
    );
    expect(cause).toMatch(/users_email_lower_idx|duplicate key/i);
    expect(await tdb.db.select().from(users)).toHaveLength(1);
  });

  it("verifyCredentials is case-insensitive on email", async () => {
    await seedAdmin("Mat@Example.test");
    expect(await verifyCredentials("MAT@EXAMPLE.TEST", "admin-password")).toBeTruthy();
    expect(await verifyCredentials("mat@example.test", "wrong")).toBeNull();
  });

  it("a disabled account cannot authenticate, and looks exactly like a wrong password", async () => {
    const admin = await seedAdmin();
    await createFirstAdminPeer();
    await setUserDisabled(admin.id, true, "other@example.test");
    expect(await verifyCredentials(admin.email, "admin-password")).toBeNull();
  });

  it("updateOwnProfile keeps emails unique across accounts", async () => {
    const a = await seedAdmin("a@x.test");
    const b = await createFirstAdminPeer("b@x.test");
    await expect(updateOwnProfile(b.id, { email: "A@X.TEST" })).rejects.toThrow(AuthError);
    const renamed = await updateOwnProfile(a.id, { name: "  Renamed  " });
    expect(renamed.name).toBe("Renamed");
  });
});

/** A second admin, bypassing the first-admin guard. */
async function createFirstAdminPeer(email = "peer@example.test") {
  const [row] = await tdb.db
    .insert(users)
    .values({
      id: `peer-${email}`,
      email,
      name: "Peer",
      role: "admin",
      orgId: null,
      passwordHash: hashPassword("peer-password"),
    })
    .returning();
  return row;
}

// ---------------------------------------------------------------------------
// Revocation — the point of the whole epic.
// ---------------------------------------------------------------------------

describe("session revocation via session_version", () => {
  it("a self password-change bumps sv (orphaning outstanding tokens)", async () => {
    const admin = await seedAdmin();
    expect(admin.sessionVersion).toBe(0);
    const after = await changeOwnPassword(admin.id, "admin-password", "new-password-1");
    expect(after.sessionVersion).toBe(1);
    // The token minted before the change no longer matches.
    const old = verifySessionToken(makeSessionToken(admin.id, 0, SECRET), SECRET);
    expect(old?.sv).not.toBe(after.sessionVersion);
  });

  it("changeOwnPassword requires the correct current password and a long-enough new one", async () => {
    const admin = await seedAdmin();
    await expect(changeOwnPassword(admin.id, "wrong", "new-password-1")).rejects.toThrow(AuthError);
    await expect(changeOwnPassword(admin.id, "admin-password", "short")).rejects.toThrow(AuthError);
  });

  it("an admin reset bumps sv — the reset finally revokes a hijacked cookie", async () => {
    const admin = await seedAdmin();
    const peer = await createFirstAdminPeer();
    const { user, tempPassword } = await adminResetPassword(peer.id, admin.email);
    expect(user.sessionVersion).toBe(peer.sessionVersion + 1);
    expect(verifyPassword(tempPassword, user.passwordHash)).toBe(true);
  });

  it("disable and role-change both bump sv", async () => {
    const admin = await seedAdmin();
    const peer = await createFirstAdminPeer();
    const disabled = await setUserDisabled(peer.id, true, admin.email);
    expect(disabled.sessionVersion).toBe(1);
    const demoted = await setUserRole(peer.id, "viewer", admin.email);
    expect(demoted.sessionVersion).toBe(2);
    expect(demoted.role).toBe("viewer");
  });
});

describe("last-admin guard", () => {
  it("refuses to disable, delete, or demote the only enabled admin", async () => {
    const admin = await seedAdmin();
    await expect(setUserDisabled(admin.id, true, admin.email)).rejects.toThrow(/last enabled admin/);
    await expect(deleteUser(admin.id, admin.email)).rejects.toThrow(/last enabled admin/);
    await expect(setUserRole(admin.id, "viewer", admin.email)).rejects.toThrow(/last enabled admin/);
  });

  it("allows it once a second enabled admin exists", async () => {
    const admin = await seedAdmin();
    await createFirstAdminPeer();
    await expect(setUserDisabled(admin.id, true, admin.email)).resolves.toBeTruthy();
  });

  it("counts only ENABLED admins — a disabled one does not satisfy the guard", async () => {
    const admin = await seedAdmin();
    const peer = await createFirstAdminPeer();
    await setUserDisabled(peer.id, true, admin.email);
    await expect(deleteUser(admin.id, admin.email)).rejects.toThrow(/last enabled admin/);
  });

  it("a staff role change moves org_id to null and satisfies users_org_binding", async () => {
    const admin = await seedAdmin();
    const org = await createOrg({ name: "Cafe", kind: "business", linkedIds: ["r1"] }, admin.email);
    const invite = await createInvite(
      { role: "member-business", orgId: org.id, linkedIds: ["r1"] },
      admin.email,
    );
    const { user } = await redeemInvite(invite.code, {
      email: "member@x.test",
      name: "Member",
      password: "member-password",
    });
    expect(user.orgId).toBe(org.id);
    const promoted = await setUserRole(user.id, "moderator", admin.email);
    expect(promoted.orgId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Invites — expiry, binding, revocation: all three absent in v1.
// ---------------------------------------------------------------------------

describe("invite lifecycle", () => {
  it("mint -> redeem creates the org and the user, and burns the code", async () => {
    const admin = await seedAdmin();
    const invite = await createInvite(
      { role: "org-editor", newOrgName: "Food Bank", newOrgKind: "nonprofit", linkedIds: ["c1"] },
      admin.email,
    );
    expect(inviteState(invite)).toBe("active");

    const { user, org } = await redeemInvite(invite.code, {
      email: "vol@x.test",
      name: "Vol",
      password: "vol-password",
    });
    expect(user.role).toBe("org-editor");
    expect(org?.name).toBe("Food Bank");
    expect(org?.linkedIds).toEqual(["c1"]);
    expect(user.orgId).toBe(org?.id);

    // Reuse is refused.
    await expect(
      redeemInvite(invite.code, { email: "b@x.test", name: "B", password: "password12" }),
    ).rejects.toThrow(/Invalid or expired/);
  });

  it("rejects an EXPIRED code", async () => {
    const admin = await seedAdmin();
    const invite = await createInvite(
      {
        role: "viewer",
        expiresAt: new Date(Date.now() - 1000),
      },
      admin.email,
    );
    expect(inviteState(invite)).toBe("expired");
    await expect(
      redeemInvite(invite.code, { email: "v@x.test", name: "V", password: "password12" }),
    ).rejects.toThrow(/Invalid or expired/);
  });

  it("rejects a REVOKED code, and revoke is reflected in state", async () => {
    const admin = await seedAdmin();
    const invite = await createInvite({ role: "viewer" }, admin.email);
    expect(await revokeInvite(invite.code, admin.email)).toBe(true);
    await expect(
      redeemInvite(invite.code, { email: "v@x.test", name: "V", password: "password12" }),
    ).rejects.toThrow(/Invalid or expired/);
    // Revoking again is a no-op, not an error.
    expect(await revokeInvite(invite.code, admin.email)).toBe(false);
  });

  it("rejects an unknown code with the same uniform message", async () => {
    await seedAdmin();
    await expect(
      redeemInvite("deadbeef", { email: "v@x.test", name: "V", password: "password12" }),
    ).rejects.toThrow(/Invalid or expired/);
  });

  it("enforces EMAIL BINDING case-insensitively", async () => {
    const admin = await seedAdmin();
    const invite = await createInvite(
      { role: "viewer", email: "Invited@X.test" },
      admin.email,
    );
    await expect(
      redeemInvite(invite.code, { email: "someone-else@x.test", name: "X", password: "password12" }),
    ).rejects.toThrow(/bound to a different email/);
    // The invited address, differently cased, works.
    const { user } = await redeemInvite(invite.code, {
      email: "INVITED@x.TEST",
      name: "Invited",
      password: "password12",
    });
    expect(user.role).toBe("viewer");
  });

  it("REFUSES to mint an admin invite with no email binding", async () => {
    const admin = await seedAdmin();
    // A forwarded admin code must never be a bearer admin grant.
    await expect(createInvite({ role: "admin" }, admin.email)).rejects.toThrow(
      /bound to an email/,
    );
    await expect(
      createInvite({ role: "admin", email: "new-admin@x.test" }, admin.email),
    ).resolves.toBeTruthy();
  });

  it("refuses an org invite that both joins and creates an org", async () => {
    const admin = await seedAdmin();
    const org = await createOrg({ name: "Cafe", kind: "business" }, admin.email);
    await expect(
      createInvite(
        { role: "member-business", orgId: org.id, newOrgName: "Other", newOrgKind: "business" },
        admin.email,
      ),
    ).rejects.toThrow(/either an existing organization or a new one/);
  });

  it("refuses an org invite bound to neither an existing nor a new org", async () => {
    const admin = await seedAdmin();
    await expect(createInvite({ role: "member-business" }, admin.email)).rejects.toThrow(
      /Pick an existing organization or name a new one/,
    );
  });

  it("refuses to attach an org to a staff role", async () => {
    const admin = await seedAdmin();
    const org = await createOrg({ name: "Cafe", kind: "business" }, admin.email);
    await expect(
      createInvite({ role: "moderator", orgId: org.id }, admin.email),
    ).rejects.toThrow(/Chamber staff and takes no organization/);
  });

  it("a concurrent double-redeem burns the code exactly once", async () => {
    const admin = await seedAdmin();
    const invite = await createInvite({ role: "viewer" }, admin.email);
    const attempt = (email: string) =>
      redeemInvite(invite.code, { email, name: "Racer", password: "password12" });
    const results = await Promise.allSettled([attempt("a@x.test"), attempt("b@x.test")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await tdb.db.select().from(users)).toHaveLength(2); // the admin + one redeemer
  });
});

// ---------------------------------------------------------------------------
// The audit trail must never become a credential leak.
// ---------------------------------------------------------------------------

describe("auth audit rows", () => {
  it("records the lifecycle events FR-A05 names", async () => {
    const admin = await seedAdmin();
    const peer = await createFirstAdminPeer();
    const invite = await createInvite({ role: "viewer", email: "v@x.test" }, admin.email);
    await revokeInvite(invite.code, admin.email);
    const second = await createInvite({ role: "viewer" }, admin.email);
    await redeemInvite(second.code, { email: "v2@x.test", name: "V2", password: "password12" });
    await adminResetPassword(peer.id, admin.email);
    await setUserRole(peer.id, "moderator", admin.email);
    await setUserDisabled(peer.id, true, admin.email);
    await deleteUser(peer.id, admin.email);

    const rows = await tdb.db.select().from(audit);
    const actions = new Set(rows.map((r) => r.action));
    for (const expected of [
      "user-create",
      "invite-mint",
      "invite-revoke",
      "invite-redeem",
      "admin-reset",
      "role-change",
      "disable",
      "user-delete",
    ]) {
      expect(actions, `missing audit action: ${expected}`).toContain(expected);
    }
  });

  it("no audit row contains a password hash, a temp password, or any scrypt material", async () => {
    const admin = await seedAdmin();
    const peer = await createFirstAdminPeer();
    const { tempPassword } = await adminResetPassword(peer.id, admin.email);
    await changeOwnPassword(admin.id, "admin-password", "brand-new-password");

    const [{ dump }] = await tdb.db
      .select({ dump: sql<string>`coalesce(string_agg(${audit.before}::text || ${audit.after}::text, ' '), '')` })
      .from(audit);
    expect(dump).not.toContain("scrypt$");
    expect(dump).not.toContain(tempPassword);
    expect(dump).not.toContain("brand-new-password");
    expect(dump).not.toContain("passwordHash");
  });

  it("the audit trail SURVIVES a hard user delete (dangling actor by design)", async () => {
    const admin = await seedAdmin();
    const peer = await createFirstAdminPeer();
    await deleteUser(peer.id, admin.email);
    expect(await tdb.db.select().from(users).where(eq(users.id, peer.id))).toHaveLength(0);
    const rows = await tdb.db.select().from(audit).where(eq(audit.recordId, peer.id));
    expect(rows.length).toBeGreaterThan(0);
  });
});
