// Backup serializer + restorer for the Postgres substrate (E05). One module,
// two halves of the same contract:
//
//   serializeDb()  — full rows WITH governance metadata for every table
//                    (record grouped by store; audit/quarantine/append logs as
//                    plain arrays, timestamps as ISO strings). Consumed by the
//                    /api/admin/backup route (v2 bundles) and the export:json
//                    CLI.
//   restoreDb()    — inserts a serialized section back VERBATIM: record rows
//                    keep their original status/source/timestamps and audit
//                    rows keep their ids. Deliberately raw drizzle inserts,
//                    NOT writeRecord — a restore must not mint fresh audit
//                    rows (the audit table itself is being restored).
//
// Lives inside src/lib/db/** because only the data layer may import the DB
// client (eslint no-restricted-imports + dependency-cruiser). Scripts import
// THIS module, never the client.
//
// Sensitivity: serialized record rows for auth-users contain password hashes
// (audit rows are already redacted at write time) — treat exported bundles as
// sensitive.

import "server-only";

import { asc, count, sql } from "drizzle-orm";

import { getDb } from "./client";
import { readRecordRows } from "./records";
import {
  analyticsEvent,
  audit,
  ferryObservation,
  invites,
  orgs,
  quarantine,
  surveyResponse,
  users,
  record,
  type RecordSource,
  type RecordStatus,
} from "./schema";

/** A `record` row, verbatim, timestamps as ISO strings. */
export type RecordRow = {
  store: string;
  id: string;
  doc: Record<string, unknown>;
  deleted: boolean;
  status: RecordStatus;
  source: RecordSource;
  externalId: string | null;
  ownerOrgId: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};

/** An `audit` row, verbatim (id preserved), ts as ISO string. */
export type AuditRow = {
  id: number;
  ts: string;
  actor: string;
  action: string;
  store: string;
  recordId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  source: string;
};

export type QuarantineRow = {
  store: string | null;
  id: string | null;
  doc: Record<string, unknown> | null;
  errors: unknown;
  quarantinedAt: string;
  resolvedAt: string | null;
};

export type AnalyticsEventRow = { ts: string; event: unknown };
export type SurveyResponseRow = { ts: string; response: unknown };
export type FerryObservationRow = { ts: string; obs: unknown };

// --- Auth tables (E06) ------------------------------------------------------
// Before E06 accounts lived in `record` under the "auth-users" store, so they
// rode along in every bundle for free. Once auth moved to dedicated tables,
// omitting them here would have made bundles restore to a site with ZERO
// users — a total lockout, discovered only during a real recovery. These
// sections close that hole.

export type OrgBackupRow = {
  id: string;
  name: string;
  kind: string;
  linkedIds: string[];
  externalIds: Record<string, unknown>;
  entitlements: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type UserBackupRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  orgId: string | null;
  /** scrypt$salt$hash. See the sensitivity note at the top of this file. */
  passwordHash: string;
  sessionVersion: number;
  disabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InviteBackupRow = {
  code: string;
  role: string;
  orgId: string | null;
  newOrgName: string | null;
  newOrgKind: string | null;
  linkedIds: string[];
  email: string | null;
  note: string | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  usedBy: string | null;
  usedAt: string | null;
};

/** The `db` section of a v2 backup bundle: the entire Postgres substrate.
 *  Deliberately version-agnostic — the wrapping bundle carries `version`. */
export type DbSection = {
  records: { [store: string]: RecordRow[] };
  audit: AuditRow[];
  quarantine: QuarantineRow[];
  analytics_event: AnalyticsEventRow[];
  survey_response: SurveyResponseRow[];
  ferry_observation: FerryObservationRow[];
  /** E06. Optional on READ so bundles taken before E06 still restore. */
  orgs?: OrgBackupRow[];
  users?: UserBackupRow[];
  invites?: InviteBackupRow[];
};

export type RestoreCounts = {
  record: number;
  audit: number;
  quarantine: number;
  analytics_event: number;
  survey_response: number;
  ferry_observation: number;
  orgs: number;
  users: number;
  invites: number;
};

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

/** Serialize every table, deterministically ordered (records by store then
 *  id, audit by id, logs by ts) so consecutive exports of the same data
 *  diff cleanly. */
export async function serializeDb(): Promise<DbSection> {
  const db = getDb();

  const recordRows = await readRecordRows();
  const records: DbSection["records"] = {};
  const sorted = [...recordRows].sort(
    (a, b) => a.store.localeCompare(b.store) || a.id.localeCompare(b.id),
  );
  for (const r of sorted) {
    (records[r.store] ??= []).push({
      store: r.store,
      id: r.id,
      doc: r.doc,
      deleted: r.deleted,
      status: r.status,
      source: r.source,
      externalId: r.externalId,
      ownerOrgId: r.ownerOrgId,
      createdAt: toIso(r.createdAt),
      updatedAt: toIso(r.updatedAt),
      updatedBy: r.updatedBy,
    });
  }

  const auditRows = await db.select().from(audit).orderBy(asc(audit.id));
  const quarantineRows = await db
    .select()
    .from(quarantine)
    .orderBy(asc(quarantine.store), asc(quarantine.id));
  const analyticsRows = await db
    .select()
    .from(analyticsEvent)
    .orderBy(asc(analyticsEvent.ts));
  const surveyRows = await db
    .select()
    .from(surveyResponse)
    .orderBy(asc(surveyResponse.ts));
  const ferryRows = await db
    .select()
    .from(ferryObservation)
    .orderBy(asc(ferryObservation.ts));
  const orgRows = await db.select().from(orgs).orderBy(asc(orgs.id));
  const userRows = await db.select().from(users).orderBy(asc(users.id));
  const inviteRows = await db.select().from(invites).orderBy(asc(invites.code));

  return {
    records,
    audit: auditRows.map((a) => ({
      id: a.id,
      ts: toIso(a.ts),
      actor: a.actor,
      action: a.action,
      store: a.store,
      recordId: a.recordId,
      before: a.before,
      after: a.after,
      source: a.source,
    })),
    quarantine: quarantineRows.map((q) => ({
      store: q.store,
      id: q.id,
      doc: q.doc,
      errors: q.errors,
      quarantinedAt: toIso(q.quarantinedAt),
      resolvedAt: q.resolvedAt ? toIso(q.resolvedAt) : null,
    })),
    analytics_event: analyticsRows.map((r) => ({ ts: toIso(r.ts), event: r.event })),
    survey_response: surveyRows.map((r) => ({ ts: toIso(r.ts), response: r.response })),
    ferry_observation: ferryRows.map((r) => ({ ts: toIso(r.ts), obs: r.obs })),
    orgs: orgRows.map((o) => ({
      id: o.id,
      name: o.name,
      kind: o.kind,
      linkedIds: o.linkedIds,
      externalIds: o.externalIds,
      entitlements: o.entitlements,
      createdAt: toIso(o.createdAt),
      updatedAt: toIso(o.updatedAt),
    })),
    users: userRows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      orgId: u.orgId,
      // Restoring an account without its hash would lock the owner out, so
      // the bundle carries it — which is exactly why bundles are treated as
      // secrets (encrypted at rest by the off-site workflow).
      passwordHash: u.passwordHash,
      sessionVersion: u.sessionVersion,
      disabled: u.disabled,
      lastLoginAt: u.lastLoginAt ? toIso(u.lastLoginAt) : null,
      createdAt: toIso(u.createdAt),
      updatedAt: toIso(u.updatedAt),
    })),
    invites: inviteRows.map((i) => ({
      code: i.code,
      role: i.role,
      orgId: i.orgId,
      newOrgName: i.newOrgName,
      newOrgKind: i.newOrgKind,
      linkedIds: i.linkedIds,
      email: i.email,
      note: i.note,
      createdBy: i.createdBy,
      createdAt: toIso(i.createdAt),
      expiresAt: toIso(i.expiresAt),
      revokedAt: i.revokedAt ? toIso(i.revokedAt) : null,
      usedBy: i.usedBy,
      usedAt: i.usedAt ? toIso(i.usedAt) : null,
    })),
  };
}

/** Keep INSERT parameter counts far below the Postgres 65535 limit (widest
 *  row here is `record` at 11 columns → 300 rows = 3300 params). */
const BATCH = 300;

function* chunks<T>(rows: T[]): Generator<T[]> {
  for (let i = 0; i < rows.length; i += BATCH) yield rows.slice(i, i + BATCH);
}

/** Insert a serialized section back verbatim, in one transaction.
 *
 *  Refuses (throws) when the target `record` table is non-empty and
 *  `force` is false — a restore is meant for an empty database. `force`
 *  only bypasses that check; rows are still plain INSERTs, so colliding
 *  primary keys will fail the transaction (nothing is silently merged).
 *
 *  Audit rows are inserted WITH their original ids (plain inserts into a
 *  bigserial column work in both pg and PGlite; the sequence just doesn't
 *  advance), then the sequence is bumped past max(id) so post-restore
 *  writes don't collide. */
export async function restoreDb(
  section: DbSection,
  opts: { force: boolean },
): Promise<RestoreCounts> {
  const db = getDb();

  const [{ n: existing }] = await db.select({ n: count() }).from(record);
  if (existing > 0 && !opts.force) {
    throw new Error(
      `target record table is non-empty (${existing} row(s)) — refusing to restore. ` +
        "Pass --force to insert into a non-empty database anyway.",
    );
  }
  // Same guard for accounts (E06): a database can hold zero records but real
  // users, and restoring over them would collide on the primary key mid-
  // transaction rather than failing cleanly here.
  const [{ n: existingUsers }] = await db.select({ n: count() }).from(users);
  if (existingUsers > 0 && !opts.force) {
    throw new Error(
      `target users table is non-empty (${existingUsers} account(s)) — refusing to restore. ` +
        "Pass --force to insert into a non-empty database anyway.",
    );
  }

  const recordRows = Object.values(section.records).flat();
  // Pre-E06 bundles carry no auth sections; treat them as empty rather than
  // failing, so an older backup still restores.
  const orgRows = section.orgs ?? [];
  const userRows = section.users ?? [];
  const inviteRows = section.invites ?? [];

  await db.transaction(async (tx) => {
    // Orgs FIRST: users.org_id and invites.org_id reference them.
    for (const batch of chunks(orgRows)) {
      await tx.insert(orgs).values(
        batch.map((o) => ({
          id: o.id,
          name: o.name,
          kind: o.kind as (typeof orgs.$inferInsert)["kind"],
          linkedIds: o.linkedIds,
          externalIds: o.externalIds,
          entitlements: o.entitlements,
          createdAt: new Date(o.createdAt),
          updatedAt: new Date(o.updatedAt),
        })),
      );
    }

    for (const batch of chunks(userRows)) {
      await tx.insert(users).values(
        batch.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role as (typeof users.$inferInsert)["role"],
          orgId: u.orgId,
          passwordHash: u.passwordHash,
          sessionVersion: u.sessionVersion,
          disabled: u.disabled,
          lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt) : null,
          createdAt: new Date(u.createdAt),
          updatedAt: new Date(u.updatedAt),
        })),
      );
    }

    for (const batch of chunks(inviteRows)) {
      await tx.insert(invites).values(
        batch.map((i) => ({
          code: i.code,
          role: i.role as (typeof invites.$inferInsert)["role"],
          orgId: i.orgId,
          newOrgName: i.newOrgName,
          newOrgKind: i.newOrgKind as (typeof invites.$inferInsert)["newOrgKind"],
          linkedIds: i.linkedIds,
          email: i.email,
          note: i.note,
          createdBy: i.createdBy,
          createdAt: new Date(i.createdAt),
          expiresAt: new Date(i.expiresAt),
          revokedAt: i.revokedAt ? new Date(i.revokedAt) : null,
          usedBy: i.usedBy,
          usedAt: i.usedAt ? new Date(i.usedAt) : null,
        })),
      );
    }

    for (const batch of chunks(recordRows)) {
      await tx.insert(record).values(
        batch.map((r) => ({
          store: r.store,
          id: r.id,
          doc: r.doc,
          deleted: r.deleted,
          status: r.status,
          source: r.source,
          externalId: r.externalId,
          ownerOrgId: r.ownerOrgId,
          createdAt: new Date(r.createdAt),
          updatedAt: new Date(r.updatedAt),
          updatedBy: r.updatedBy,
        })),
      );
    }

    for (const batch of chunks(section.audit)) {
      await tx.insert(audit).values(
        batch.map((a) => ({
          id: a.id,
          ts: new Date(a.ts),
          actor: a.actor,
          action: a.action,
          store: a.store,
          recordId: a.recordId,
          before: a.before,
          after: a.after,
          source: a.source,
        })),
      );
    }
    if (section.audit.length > 0) {
      const maxId = section.audit.reduce((m, a) => Math.max(m, a.id), 0);
      await tx.execute(
        sql`SELECT setval(pg_get_serial_sequence('audit', 'id'), ${maxId})`,
      );
    }

    for (const batch of chunks(section.quarantine)) {
      await tx.insert(quarantine).values(
        batch.map((q) => ({
          store: q.store,
          id: q.id,
          doc: q.doc,
          errors: q.errors,
          quarantinedAt: new Date(q.quarantinedAt),
          resolvedAt: q.resolvedAt ? new Date(q.resolvedAt) : null,
        })),
      );
    }

    for (const batch of chunks(section.analytics_event)) {
      await tx
        .insert(analyticsEvent)
        .values(batch.map((r) => ({ ts: new Date(r.ts), event: r.event })));
    }
    for (const batch of chunks(section.survey_response)) {
      await tx
        .insert(surveyResponse)
        .values(batch.map((r) => ({ ts: new Date(r.ts), response: r.response })));
    }
    for (const batch of chunks(section.ferry_observation)) {
      await tx
        .insert(ferryObservation)
        .values(batch.map((r) => ({ ts: new Date(r.ts), obs: r.obs })));
    }
  });

  return {
    record: recordRows.length,
    audit: section.audit.length,
    quarantine: section.quarantine.length,
    analytics_event: section.analytics_event.length,
    survey_response: section.survey_response.length,
    ferry_observation: section.ferry_observation.length,
    orgs: orgRows.length,
    users: userRows.length,
    invites: inviteRows.length,
  };
}
