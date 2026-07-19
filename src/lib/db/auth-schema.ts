// Auth v2 tables (E06): identity, organizations, invitations.
//
// Split into its own file rather than appended to schema.ts so the auth
// substrate reads as one unit; schema.ts re-exports it, which is what wires
// these tables into BOTH the runtime client (client.ts does
// `import * as schema`) and drizzle-kit generation (drizzle.config.ts points
// at schema.ts). Migrations are still GENERATED — never hand-edit db/migrations/.
//
// These are dedicated tables, NOT rows in the generic `record` table. Auth
// stopped riding the overlay/record contract in E06: it needs real columns
// (session_version, disabled, last_login_at) and real constraints (unique
// email) that a jsonb doc cannot enforce.
//
// Invariants deliberately pushed DOWN to the database, because an in-app check
// is a TOCTOU window and E16's AMS sync will write users from another code path:
//   - one account per email, case-insensitively  (users_email_lower_idx)
//   - an admin invite must be email-bound         (invites_admin_requires_email)
//   - an invite either joins an org or creates one, never both/neither
//                                                 (invites_org_binding)

import { sql } from "drizzle-orm";
import { ORG_KINDS, ORG_ROLES, ROLES, type OrgKind, type Role } from "@/lib/auth/roles";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// The role vocabulary lives in src/lib/auth/roles.ts, which imports nothing —
// so client components can share these names without pulling drizzle-orm into
// the browser bundle. Re-exported here for schema-side callers.
export { ORG_KINDS, ORG_ROLES, ROLES, type OrgKind, type Role } from "@/lib/auth/roles";

const roleList = sql.raw(ROLES.map((r) => `'${r}'`).join(", "));
const orgRoleList = sql.raw(ORG_ROLES.map((r) => `'${r}'`).join(", "));
const kindList = sql.raw(ORG_KINDS.map((k) => `'${k}'`).join(", "));

/** An organization: the entity that OWNS content, sitting between users and
 *  records. `linked_ids` moved here from the user in E06 — permission now
 *  follows the org, so a second account for the same business inherits it. */
export const orgs = pgTable(
  "orgs",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").$type<OrgKind>().notNull(),
    /** restaurant ids (business) or charity ids (nonprofit) this org may edit. */
    linkedIds: jsonb("linked_ids").$type<string[]>().notNull().default([]),
    /** Seam for the AMS member id — `{ amsMemberId?: string }`. Populated by
     *  E16; deliberately empty and unread today. */
    externalIds: jsonb("external_ids")
      .$type<{ amsMemberId?: string }>()
      .notNull()
      .default({}),
    /** Seam for paid tiers. Consulted structurally by can() so E19 can wire
     *  entitlements without changing a signature; empty and non-deciding today. */
    entitlements: jsonb("entitlements")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("orgs_kind_check", sql`${t.kind} IN (${kindList})`)],
);

/** A person who can sign in. */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role").$type<Role>().notNull(),
    /** null for Chamber staff (admin / moderator / viewer). */
    orgId: text("org_id").references(() => orgs.id, { onDelete: "set null" }),
    /** scrypt$salt$hash — format unchanged from v1, so existing hashes verify. */
    passwordHash: text("password_hash").notNull(),
    /** Embedded in every session token as `sv`. Bumping it invalidates every
     *  outstanding cookie for this user — the same-day revocation FR-A09 wants,
     *  without server-side session storage. */
    sessionVersion: integer("session_version").notNull().default(0),
    disabled: boolean("disabled").notNull().default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Case-insensitive uniqueness, enforced by the DATABASE. v1 checked this in
    // app code with a read-then-write race; E16 will add a second writer.
    uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`),
    check("users_role_check", sql`${t.role} IN (${roleList})`),
    // Staff roles carry no org; org roles must have one.
    check(
      "users_org_binding",
      sql`(${t.role} IN (${orgRoleList})) = (${t.orgId} IS NOT NULL)`,
    ),
  ],
);

/** A single-use invitation to create an account. v1 invites never expired,
 *  were not bound to an email, and could not be revoked — all three are fixed
 *  here (FR-A09). */
export const invites = pgTable(
  "invites",
  {
    /** randomBytes(12).toString("hex") — 24 chars. */
    code: text("code").primaryKey(),
    role: text("role").$type<Role>().notNull(),
    /** Join an EXISTING org... */
    orgId: text("org_id").references(() => orgs.id, { onDelete: "cascade" }),
    /** ...or create one on redemption. Exactly one of the two, enforced below. */
    newOrgName: text("new_org_name"),
    newOrgKind: text("new_org_kind").$type<OrgKind>(),
    /** Seeds the new org's linked_ids; validated against the real stores at mint. */
    linkedIds: jsonb("linked_ids").$type<string[]>().notNull().default([]),
    /** Binding: when set, redemption must match case-insensitively. REQUIRED for
     *  admin invites — a forwarded admin code must never be a bearer grant. */
    email: text("email"),
    note: text("note"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Mint default: now + 14 days. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    usedBy: text("used_by"),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [
    check("invites_role_check", sql`${t.role} IN (${roleList})`),
    check(
      "invites_kind_check",
      sql`${t.newOrgKind} IS NULL OR ${t.newOrgKind} IN (${kindList})`,
    ),
    // A bearer token that mints an admin is the worst failure mode this table
    // has; make the database refuse to store one.
    check(
      "invites_admin_requires_email",
      sql`${t.role} <> 'admin' OR ${t.email} IS NOT NULL`,
    ),
    // Org roles: join XOR create. Staff roles: neither.
    check(
      "invites_org_binding",
      sql`CASE WHEN ${t.role} IN (${orgRoleList})
             THEN (${t.orgId} IS NOT NULL AND ${t.newOrgName} IS NULL)
               OR (${t.orgId} IS NULL AND ${t.newOrgName} IS NOT NULL AND ${t.newOrgKind} IS NOT NULL)
             ELSE ${t.orgId} IS NULL AND ${t.newOrgName} IS NULL
           END`,
    ),
  ],
);
