#!/usr/bin/env node
// E06 auth-v2 data migration: legacy accounts -> users/orgs tables.
//
//   node scripts/migrate-auth-v2.mjs [--data-dir <dir>] [--dry-run|--apply] [--yes]
//
// Follows E05's importer doctrine (scripts/import-data-dir.ts): dry-run is the
// DEFAULT, ambiguity is quarantined rather than guessed at, and the exit code
// is the runbook's gate.
//
//   0 = clean (dry-run planned nothing dangerous / apply succeeded)
//   1 = HALT  (bad usage, unparseable source, dual-source conflict, DB error)
//   2 = quarantined findings — nothing was applied; a human must resolve them
//
// WHAT IT READS (both legacy homes, because which one is live depends on
// whether E05's production cutover has happened yet):
//   A. the `record` table, stores "auth-users" / "auth-invites"  (post-E05)
//   B. <data-dir>/auth/users.json + invites.json                 (pre-E05)
// If BOTH hold users it HALTS with a conflict report rather than merging —
// silently picking one would drop accounts.
//
// WHAT IT DOES NOT DO: it never deletes the legacy sources. `.data/auth/`
// stays in place read-only as the one-release rollback window (ADR-D1).
// Legacy pending invites are NOT migrated — they are unbound, non-expiring
// codes with no minter recorded, and re-minting them under the new rules is
// safer than importing them. They are reported so an admin can re-issue.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Legacy 3-role model -> the five-role model (E06 decisions doc). */
export const ROLE_MAP = {
  admin: "admin",
  business: "member-business",
  nonprofit: "org-editor",
};

/** Which content store an org's linked ids point into. */
const KIND_FOR_ROLE = {
  "member-business": "business",
  "org-editor": "nonprofit",
};

/**
 * Org ids are DERIVED from the legacy user id, never random.
 *
 * This is what makes `--apply` idempotent: re-running upserts the same org
 * rather than minting a duplicate on every run. A half-finished migration can
 * simply be run again.
 */
export function orgIdFor(legacyUserId) {
  return `org-${legacyUserId}`;
}

// ---------------------------------------------------------------------------
// Planning — pure. Takes legacy rows, returns everything that WOULD happen.
// No database, so the fixture tests drive exactly the code the real run uses.
// ---------------------------------------------------------------------------

/**
 * @param {{users: any[], invites: any[], now?: Date}} input
 * @returns {{orgs: any[], users: any[], backfills: any[], quarantine: any[],
 *            unmigratedInvites: any[]}}
 */
export function planMigration({ users, invites = [], now = new Date() }) {
  const quarantine = [];
  const orgs = [];
  const planned = [];

  // --- Trap 1: two accounts claiming the same listing/charity id. ---------
  // v1 let an admin mint two invites carrying the same linkedId, so this is
  // reachable in real data. Each linked id must belong to exactly ONE org, and
  // only a human knows whether these are two people at one business (one org,
  // two members) or a data-entry mistake. Guessing would silently hand one
  // account edit rights over another's listing.
  const claimants = new Map();
  for (const u of users) {
    for (const id of u.linkedIds ?? []) {
      if (!claimants.has(id)) claimants.set(id, []);
      claimants.get(id).push(u);
    }
  }
  for (const [linkedId, owners] of claimants) {
    if (owners.length > 1) {
      quarantine.push({
        kind: "shared-linked-id",
        linkedId,
        users: owners.map((u) => ({ id: u.id, email: u.email, name: u.name })),
        detail:
          `linked id "${linkedId}" is claimed by ${owners.length} accounts ` +
          `(${owners.map((u) => u.email).join(", ")}). Assign it to one org by hand, ` +
          `then re-run.`,
      });
    }
  }

  // --- Trap 2: emails that collide under the new unique index. ------------
  // Not in the epic's list, but implied by it: v1 checked uniqueness in app
  // code with a TOCTOU window, so two rows differing only in case can exist.
  // The new users_email_lower_idx would reject the second insert MID-APPLY,
  // leaving a partial migration. Catch it during planning instead.
  const byEmail = new Map();
  for (const u of users) {
    const key = String(u.email ?? "").trim().toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key).push(u);
  }
  for (const [email, dupes] of byEmail) {
    if (dupes.length > 1) {
      quarantine.push({
        kind: "duplicate-email",
        email,
        users: dupes.map((u) => ({ id: u.id, email: u.email })),
        detail:
          `${dupes.length} accounts share the email "${email}" (case-insensitively). ` +
          `users_email_lower_idx permits one — merge or delete the extras, then re-run.`,
      });
    }
  }

  // --- Per-user mapping --------------------------------------------------
  for (const u of users) {
    if (!u.id || !u.email || !u.passwordHash) {
      quarantine.push({
        kind: "incomplete-user",
        user: { id: u.id ?? null, email: u.email ?? null },
        detail: "legacy user is missing id, email, or passwordHash",
      });
      continue;
    }
    const role = ROLE_MAP[u.role];
    if (!role) {
      quarantine.push({
        kind: "unknown-role",
        user: { id: u.id, email: u.email, role: u.role },
        detail: `legacy role "${u.role}" has no mapping in the five-role model`,
      });
      continue;
    }

    const kind = KIND_FOR_ROLE[role];
    let orgId = null;
    if (kind) {
      // One org per legacy org-account. The account's own name is the best
      // org name available in v1's model; an admin renames it afterwards.
      orgId = orgIdFor(u.id);
      orgs.push({
        id: orgId,
        name: u.name || u.email,
        kind,
        linkedIds: [...(u.linkedIds ?? [])],
      });
    } else if ((u.linkedIds ?? []).length > 0) {
      // An admin with linkedIds: harmless in v1 (admins could edit
      // everything anyway) and meaningless in v2 (staff carry no org).
      // Report it so the ids are not silently forgotten.
      quarantine.push({
        kind: "staff-with-linked-ids",
        user: { id: u.id, email: u.email, role: u.role },
        linkedIds: [...u.linkedIds],
        detail:
          `admin "${u.email}" carries linkedIds, which staff roles do not have in v2. ` +
          `They edit everything regardless; confirm no org needs to own these ids.`,
      });
    }

    planned.push({
      id: u.id,
      email: u.email,
      name: u.name || u.email,
      role,
      orgId,
      // Ported verbatim — there is no rehash migration.
      passwordHash: u.passwordHash,
      sessionVersion: 0,
      disabled: false,
      createdAt: u.createdAt ? new Date(u.createdAt) : now,
    });
  }

  // --- owner_org_id backfill on the content records ----------------------
  const backfills = [];
  for (const org of orgs) {
    const store = org.kind === "business" ? "restaurants" : "charities";
    for (const linkedId of org.linkedIds) {
      backfills.push({ store, id: linkedId, orgId: org.id, via: "linked-id" });
      // Child records that reference the owner by id rather than carrying one.
      backfills.push({
        store: "events",
        ownerField: "ownerId",
        ownerValue: linkedId,
        orgId: org.id,
        via: "ownerId",
      });
      if (org.kind === "nonprofit") {
        backfills.push({
          store: "volunteer-needs",
          ownerField: "charityId",
          ownerValue: linkedId,
          orgId: org.id,
          via: "charityId",
        });
      }
    }
  }

  return {
    orgs,
    users: planned,
    backfills,
    quarantine,
    unmigratedInvites: (invites ?? [])
      .filter((i) => !i.usedBy)
      .map((i) => ({ code: i.code, role: i.role, note: i.note ?? null })),
  };
}

export function formatPlan(plan, { source }) {
  const L = [];
  L.push(`source: ${source}`);
  L.push("");
  L.push(`orgs to create/update:   ${plan.orgs.length}`);
  for (const o of plan.orgs) {
    L.push(`  + ${o.id}  ${JSON.stringify(o.name)}  kind=${o.kind}  linked=[${o.linkedIds.join(", ")}]`);
  }
  L.push(`users to create/update:  ${plan.users.length}`);
  for (const u of plan.users) {
    L.push(`  + ${u.id}  ${u.email}  role=${u.role}  org=${u.orgId ?? "-"}`);
  }
  L.push(`owner_org_id backfills:  ${plan.backfills.length}`);
  for (const b of plan.backfills) {
    L.push(
      b.via === "linked-id"
        ? `  ~ ${b.store}/${b.id} -> ${b.orgId}`
        : `  ~ ${b.store} where ${b.ownerField}=${b.ownerValue} -> ${b.orgId}`,
    );
  }
  if (plan.unmigratedInvites.length) {
    L.push("");
    L.push(
      `NOT migrated: ${plan.unmigratedInvites.length} pending legacy invite(s) — ` +
        `unbound and non-expiring under v1 rules. Re-mint them from /admin/accounts:`,
    );
    for (const i of plan.unmigratedInvites) {
      L.push(`  - ${i.code}  role=${i.role}${i.note ? `  note=${JSON.stringify(i.note)}` : ""}`);
    }
  }
  if (plan.quarantine.length) {
    L.push("");
    L.push(`QUARANTINE — ${plan.quarantine.length} finding(s); nothing will be applied:`);
    for (const q of plan.quarantine) {
      L.push(`  ! [${q.kind}] ${q.detail}`);
    }
  }
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** Pre-E05 file mode: <dataDir>/auth/{users,invites}.json */
export async function readFileSource(dataDir) {
  const read = async (name) => {
    try {
      return JSON.parse(await readFile(path.join(dataDir, "auth", name), "utf8"));
    } catch (err) {
      if (err.code === "ENOENT") return null;
      // A source that exists but does not parse is a HALT, never an empty read.
      throw new HaltError(`${name} exists but is not valid JSON: ${err.message}`);
    }
  };
  const users = await read("users.json");
  const invites = await read("invites.json");
  if (users === null && invites === null) return null;
  return { users: users ?? [], invites: invites ?? [] };
}

/**
 * Post-E05: rows in the `record` table under the auth store keys.
 *
 * NOTE: the epic's context pack calls this the `overlay` table. E05 replaced
 * overlay with `record` (schema.ts: "record supersedes the old generic overlay
 * table"), and there is no hasDb() dual backend any more. Repo wins.
 */
export async function readDbSource(query) {
  const rows = await query(
    `select store, id, doc, deleted from record where store in ('auth-users', 'auth-invites')`,
  );
  const live = rows.filter((r) => !r.deleted);
  const users = live.filter((r) => r.store === "auth-users").map((r) => r.doc);
  const invites = live.filter((r) => r.store === "auth-invites").map((r) => r.doc);
  if (users.length === 0 && invites.length === 0) return null;
  return { users, invites };
}

export class HaltError extends Error {}

/**
 * Pick the one legacy source, or HALT.
 *
 * Both-populated is not merged: the two could hold different password hashes
 * for the same person, and choosing silently would either drop accounts or
 * resurrect deleted ones.
 */
export function chooseSource(fileSource, dbSource) {
  const fileUsers = fileSource?.users?.length ?? 0;
  const dbUsers = dbSource?.users?.length ?? 0;
  if (fileUsers > 0 && dbUsers > 0) {
    throw new HaltError(
      "CONFLICT: both legacy sources hold users — " +
        `${fileUsers} in <data-dir>/auth/users.json and ${dbUsers} in the record table ` +
        `(store "auth-users"). Refusing to merge: they may disagree on password hashes ` +
        `or contain accounts deleted from the other. Decide which is authoritative, ` +
        `move the other aside, and re-run.`,
    );
  }
  if (dbUsers > 0) return { ...dbSource, source: 'record table (store "auth-users")' };
  if (fileUsers > 0) return { ...fileSource, source: "<data-dir>/auth/users.json" };
  return null;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/**
 * Idempotent: orgs and users upsert by their derived/legacy ids, and the
 * backfill only sets owner_org_id where it is still null, so re-running never
 * overwrites an ownership an admin has since corrected by hand.
 */
export async function applyPlan(plan, query) {
  let orgsWritten = 0;
  let usersWritten = 0;
  let recordsBackfilled = 0;

  for (const o of plan.orgs) {
    await query(
      `insert into orgs (id, name, kind, linked_ids)
       values ($1, $2, $3, $4::jsonb)
       on conflict (id) do update set
         name = excluded.name,
         kind = excluded.kind,
         linked_ids = excluded.linked_ids,
         updated_at = now()`,
      [o.id, o.name, o.kind, JSON.stringify(o.linkedIds)],
    );
    orgsWritten += 1;
  }

  for (const u of plan.users) {
    await query(
      `insert into users (id, email, name, role, org_id, password_hash,
                          session_version, disabled, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (id) do update set
         email = excluded.email,
         name = excluded.name,
         role = excluded.role,
         org_id = excluded.org_id,
         password_hash = excluded.password_hash,
         updated_at = now()`,
      [
        u.id,
        u.email,
        u.name,
        u.role,
        u.orgId,
        u.passwordHash,
        u.sessionVersion,
        u.disabled,
        u.createdAt,
      ],
    );
    usersWritten += 1;
  }

  for (const b of plan.backfills) {
    const res =
      b.via === "linked-id"
        ? await query(
            `update record set owner_org_id = $1
              where store = $2 and id = $3 and owner_org_id is null`,
            [b.orgId, b.store, b.id],
          )
        : await query(
            `update record set owner_org_id = $1
              where store = $2 and doc->>${quoteIdent(b.ownerField)} = $3
                and owner_org_id is null`,
            [b.orgId, b.store, b.ownerValue],
          );
    recordsBackfilled += res.rowCount ?? 0;
  }

  return { orgsWritten, usersWritten, recordsBackfilled };
}

/** doc->>'field' — the field name is from our own closed set, never user input,
 *  but quote it defensively so this can never become an injection point. */
function quoteIdent(field) {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field)) throw new HaltError(`bad owner field: ${field}`);
  return `'${field}'`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(n);
  const opt = (n) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const apply = flag("--apply");
  const dataDir = opt("--data-dir") ?? process.env.DATA_DIR ?? ".data";

  const { Pool } = await import("pg");
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — the auth tables live in Postgres (E05/E06).");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const query = async (text, params) => {
    const res = await pool.query(text, params);
    return Object.assign(res.rows, { rowCount: res.rowCount });
  };

  try {
    const chosen = chooseSource(await readFileSource(dataDir), await readDbSource(query));
    if (!chosen) {
      console.log("No legacy accounts found in either source — nothing to migrate.");
      return 0;
    }

    const plan = planMigration({ users: chosen.users, invites: chosen.invites });
    console.log(formatPlan(plan, { source: chosen.source }));

    if (plan.quarantine.length > 0) {
      console.error(
        `\nHALTED: ${plan.quarantine.length} quarantine finding(s). ` +
          `Nothing was written. Resolve them by hand and re-run.`,
      );
      return 2;
    }
    if (!apply) {
      console.log("\n(dry run — pass --apply to write. Re-runnable: writes are idempotent.)");
      return 0;
    }

    const host = new URL(process.env.DATABASE_URL.replace(/^postgres(ql)?:/, "http:")).host;
    console.log(`\nApplying to ${host} ...`);
    const result = await applyPlan(plan, query);
    console.log(
      `done: ${result.orgsWritten} org(s), ${result.usersWritten} user(s), ` +
        `${result.recordsBackfilled} record(s) backfilled with owner_org_id.`,
    );
    console.log(
      "Legacy sources left untouched as the one-release rollback window (ADR-D1).",
    );
    return 0;
  } catch (err) {
    if (err instanceof HaltError) {
      console.error(`\nHALTED: ${err.message}`);
      return 1;
    }
    console.error(err);
    return 1;
  } finally {
    await pool.end();
  }
}

// Only run when invoked directly — the fixture tests import the planners.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
