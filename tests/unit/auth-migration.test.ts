// scripts/migrate-auth-v2.mjs (E06) — planning, quarantine traps, and apply.
//
// The planner is pure, so these fixtures drive exactly the code path the real
// migration uses. The apply half runs against PGlite with the checked-in
// migrations, which is what proves idempotency for real rather than by
// inspection.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { sql } from "drizzle-orm";

import {
  HaltError,
  applyPlan,
  chooseSource,
  formatPlan,
  orgIdFor,
  planMigration,
  readFileSource,
} from "../../scripts/migrate-auth-v2.mjs";
import { audit, invites, orgs, record, users } from "@/lib/db/schema";
import { createTestDb, type TestDb } from "../setup/pglite-db";

const FIXTURES = path.join(process.cwd(), "tests", "fixtures", "auth-migration");
const HAPPY = path.join(FIXTURES, "happy");
const SHARED = path.join(FIXTURES, "shared-linked-id");

/** A legacy account as it exists in the v1 JSON. */
interface LegacyUser {
  id: string;
  email: string;
  name: string;
  role: string;
  linkedIds?: string[];
  passwordHash?: string;
  createdAt?: string;
}
/** A planned v2 user row. */
interface PlannedUser {
  id: string;
  email: string;
  role: string;
  orgId: string | null;
  passwordHash: string;
  sessionVersion: number;
  disabled: boolean;
}

/** readFileSource returns null for a dir with no auth files; every fixture
 *  here has them, so narrow once instead of asserting at each call site. */
async function loadFixture(dir: string): Promise<{ users: LegacyUser[]; invites: unknown[] }> {
  const src = await readFileSource(dir);
  if (!src) throw new Error(`fixture has no auth/ files: ${dir}`);
  return src;
}

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});
afterEach(async () => {
  await tdb.db.delete(users);
  await tdb.db.delete(invites);
  await tdb.db.delete(orgs);
  await tdb.db.delete(record);
  await tdb.db.execute(sql`TRUNCATE audit`);
});

/** Drives the .mjs apply path against PGlite, translating $1-style params. */
function pgliteQuery(db: TestDb["db"]) {
  return async (text: string, params: unknown[] = []) => {
    const res = await db.execute(sql.raw(inline(text, params)));
    const rows = (res as unknown as { rows?: unknown[] }).rows ?? res;
    return Object.assign(rows as unknown[], {
      rowCount: (res as unknown as { rowCount?: number }).rowCount ?? (rows as unknown[]).length,
    });
  };
}

/** Minimal $n interpolation for the fixture harness only. */
function inline(text: string, params: unknown[]): string {
  return text.replace(/\$(\d+)/g, (_m, n) => {
    const v = params[Number(n) - 1];
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "number") return String(v);
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (v instanceof Date) return `'${v.toISOString()}'`;
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

describe("source selection", () => {
  it("reads the pre-E05 file source", async () => {
    const src = await loadFixture(HAPPY);
    expect(src.users).toHaveLength(3);
    expect(src.invites).toHaveLength(2);
  });

  it("returns null when a data dir holds no auth files", async () => {
    expect(await readFileSource(path.join(FIXTURES, "does-not-exist"))).toBeNull();
  });

  it("HALTS when BOTH legacy sources hold users instead of merging them", () => {
    // They could disagree on password hashes, or one could contain accounts
    // deleted from the other. Only a human can say which is authoritative.
    expect(() =>
      chooseSource({ users: [{ id: "a" }], invites: [] }, { users: [{ id: "b" }], invites: [] }),
    ).toThrow(HaltError);
  });

  it("prefers the record table when only it has users (post-E05 shape)", () => {
    const chosen = chooseSource(
      { users: [], invites: [] },
      { users: [{ id: "b" }], invites: [] },
    );
    expect(chosen?.source).toContain("record table");
  });

  it("falls back to the file source when only it has users (pre-cutover shape)", () => {
    const chosen = chooseSource({ users: [{ id: "a" }], invites: [] }, null);
    expect(chosen?.source).toContain("users.json");
  });
});

describe("planning the happy path", () => {
  it("maps roles, creates one org per org-account, and leaves admins org-less", async () => {
    const src = await loadFixture(HAPPY);
    const plan = planMigration(src);

    expect(plan.quarantine).toEqual([]);

    const byId: Record<string, PlannedUser> = Object.fromEntries(
      (plan.users as PlannedUser[]).map((u) => [u.id, u]),
    );
    expect(byId["u-admin"].role).toBe("admin");
    expect(byId["u-admin"].orgId).toBeNull();
    expect(byId["u-cafe"].role).toBe("member-business");
    expect(byId["u-fb"].role).toBe("org-editor");

    expect(plan.orgs).toHaveLength(2);
    const cafe = plan.orgs.find((o: { id: string }) => o.id === orgIdFor("u-cafe"));
    expect(cafe.kind).toBe("business");
    expect(cafe.linkedIds).toEqual(["driftwood-cafe"]);
    const fb = plan.orgs.find((o: { id: string }) => o.id === orgIdFor("u-fb"));
    expect(fb.kind).toBe("nonprofit");
  });

  it("carries password hashes across verbatim (no rehash migration)", async () => {
    const src = await loadFixture(HAPPY);
    const plan = planMigration(src);
    const cafe = src.users.find((u) => u.id === "u-cafe")!;
    const planned = (plan.users as PlannedUser[]).find((u) => u.id === "u-cafe")!;
    expect(planned.passwordHash).toBe(cafe.passwordHash);
    expect(planned.sessionVersion).toBe(0);
    expect(planned.disabled).toBe(false);
  });

  it("plans owner_org_id backfills for listings, events, and volunteer needs", async () => {
    const plan = planMigration(await loadFixture(HAPPY));
    const kinds = plan.backfills.map((b: { store: string; via: string }) => `${b.store}:${b.via}`);
    expect(kinds).toContain("restaurants:linked-id");
    expect(kinds).toContain("charities:linked-id");
    expect(kinds).toContain("events:ownerId");
    expect(kinds).toContain("volunteer-needs:charityId");
  });

  it("does NOT migrate pending invites, but reports them for re-minting", async () => {
    const plan = planMigration(await loadFixture(HAPPY));
    // The used one is not pending; only the unbound, non-expiring one is.
    expect(plan.unmigratedInvites).toHaveLength(1);
    expect(plan.unmigratedInvites[0].code).toBe("abc123");
    expect(formatPlan(plan, { source: "x" })).toContain("NOT migrated");
  });
});

describe("quarantine traps", () => {
  it("HALTS when two accounts claim the same linked id, naming both", async () => {
    const plan = planMigration(await loadFixture(SHARED));
    const finding = plan.quarantine.find(
      (q: { kind: string }) => q.kind === "shared-linked-id",
    );
    expect(finding).toBeTruthy();
    expect(finding.linkedId).toBe("marina-grill");
    const emails = finding.users.map((u: { email: string }) => u.email);
    expect(emails).toContain("front@marinagrill.test");
    expect(emails).toContain("owner@marinagrill.test");
    // The operator-facing report names the ids and the people.
    const report = formatPlan(plan, { source: "fixture" });
    expect(report).toContain("QUARANTINE");
    expect(report).toContain("marina-grill");
  });

  it("catches emails that would collide under users_email_lower_idx", () => {
    const plan = planMigration({
      users: [
        { id: "a", email: "Same@X.test", name: "A", role: "admin", linkedIds: [], passwordHash: "scrypt$a$b" },
        { id: "b", email: "same@x.TEST", name: "B", role: "admin", linkedIds: [], passwordHash: "scrypt$a$b" },
      ],
      invites: [],
    });
    // Without this trap the second insert would fail MID-APPLY, leaving a
    // half-migrated database.
    expect(plan.quarantine.some((q: { kind: string }) => q.kind === "duplicate-email")).toBe(true);
  });

  it("quarantines an unmappable legacy role rather than guessing", () => {
    const plan = planMigration({
      users: [{ id: "a", email: "a@x.test", name: "A", role: "superuser", linkedIds: [], passwordHash: "scrypt$a$b" }],
      invites: [],
    });
    expect(plan.quarantine[0].kind).toBe("unknown-role");
    expect(plan.users).toHaveLength(0);
  });

  it("quarantines an incomplete legacy user", () => {
    const plan = planMigration({
      users: [{ id: "a", email: "", name: "A", role: "admin", linkedIds: [] }],
      invites: [],
    });
    expect(plan.quarantine[0].kind).toBe("incomplete-user");
  });

  it("reports an admin carrying linkedIds (meaningless for staff in v2)", () => {
    const plan = planMigration({
      users: [{ id: "a", email: "a@x.test", name: "A", role: "admin", linkedIds: ["orphan"], passwordHash: "scrypt$a$b" }],
      invites: [],
    });
    expect(plan.quarantine[0].kind).toBe("staff-with-linked-ids");
  });
});

describe("apply (against a real Postgres engine)", () => {
  it("writes orgs and users, and backfills owner_org_id on the content records", async () => {
    const q = pgliteQuery(tdb.db);
    // Seed the content records the backfill should claim.
    await tdb.db.insert(record).values([
      { store: "restaurants", id: "driftwood-cafe", doc: { id: "driftwood-cafe", name: "Driftwood Cafe" } },
      { store: "charities", id: "kingston-food-bank", doc: { id: "kingston-food-bank", name: "Food Bank" } },
      { store: "events", id: "ev1", doc: { id: "ev1", title: "Pancakes", start: "2026-08-01", ownerId: "driftwood-cafe" } },
      { store: "volunteer-needs", id: "vn1", doc: { id: "vn1", title: "Sorters", date: "2026-08-02", charityId: "kingston-food-bank" } },
      // Owned by nobody in the plan — must stay null.
      { store: "restaurants", id: "unclaimed", doc: { id: "unclaimed", name: "Unclaimed" } },
    ]);

    const plan = planMigration(await loadFixture(HAPPY));
    const result = await applyPlan(plan, q);

    expect(result.orgsWritten).toBe(2);
    expect(result.usersWritten).toBe(3);

    const rows = await tdb.db.select().from(record);
    const owner = (id: string) => rows.find((r) => r.id === id)?.ownerOrgId;
    expect(owner("driftwood-cafe")).toBe(orgIdFor("u-cafe"));
    expect(owner("kingston-food-bank")).toBe(orgIdFor("u-fb"));
    expect(owner("ev1")).toBe(orgIdFor("u-cafe"));
    expect(owner("vn1")).toBe(orgIdFor("u-fb"));
    expect(owner("unclaimed")).toBeNull();

    const userRows = await tdb.db.select().from(users);
    expect(userRows).toHaveLength(3);
    expect(userRows.every((u) => u.sessionVersion === 0 && !u.disabled)).toBe(true);
  });

  it("is IDEMPOTENT — a second run creates no duplicates", async () => {
    const q = pgliteQuery(tdb.db);
    const plan = planMigration(await loadFixture(HAPPY));
    await applyPlan(plan, q);
    await applyPlan(plan, q);
    // Org ids are derived from the legacy user id, not random, which is what
    // makes the re-run an upsert instead of a duplicate.
    expect(await tdb.db.select().from(orgs)).toHaveLength(2);
    expect(await tdb.db.select().from(users)).toHaveLength(3);
  });

  it("does not overwrite an owner_org_id an admin has since corrected by hand", async () => {
    const q = pgliteQuery(tdb.db);
    await tdb.db.insert(record).values({
      store: "restaurants",
      id: "driftwood-cafe",
      doc: { id: "driftwood-cafe", name: "Driftwood Cafe" },
      ownerOrgId: "org-set-by-hand",
    });
    await applyPlan(planMigration(await loadFixture(HAPPY)), q);
    const [row] = await tdb.db.select().from(record);
    expect(row.ownerOrgId).toBe("org-set-by-hand");
  });

  it("produces rows that satisfy the schema's own constraints", async () => {
    const q = pgliteQuery(tdb.db);
    await applyPlan(planMigration(await loadFixture(HAPPY)), q);
    // users_org_binding: staff carry no org, org roles must have one.
    const rows = await tdb.db.select().from(users);
    for (const u of rows) {
      const isOrgRole = u.role === "org-editor" || u.role === "member-business";
      expect(Boolean(u.orgId), `${u.email} (${u.role})`).toBe(isOrgRole);
    }
  });
});
