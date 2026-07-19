// write-choke (E05): every structured write goes through writeRecord —
// validated, metadata-stamped, and audited (exactly one append-only audit row
// per effective write) inside one transaction. Validation failures write
// NOTHING. Auth-store audit rows never contain password material.

import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { deleteRecord, readRecords, writeRecord } from "@/lib/db/records";
import { audit, record } from "@/lib/db/schema";
import { RecordValidationError } from "@/lib/db/store-schemas";
import { validLodging, validRestaurant } from "../setup/domain-docs";
import { createTestDb, type TestDb } from "../setup/pglite-db";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

async function auditRows(store: string) {
  return tdb.db.select().from(audit).where(eq(audit.store, store)).orderBy(asc(audit.id));
}

describe("writeRecord choke point", () => {
  it("create → update → tombstone emits exactly one audit row each, with correct actor/action/source/before/after", async () => {
    const meta = { actor: "mat@example.test", source: "admin" as const };

    await writeRecord("restaurants", validRestaurant({ id: "cafe", name: "Cafe v1" }), meta);
    await writeRecord("restaurants", validRestaurant({ id: "cafe", name: "Cafe v2" }), meta);
    await writeRecord(
      "restaurants",
      validRestaurant({ id: "cafe", name: "Cafe v2", _deleted: true }),
      meta,
    );

    const rows = await auditRows("restaurants");
    expect(rows.map((r) => r.action)).toEqual(["create", "update", "delete"]);
    expect(rows.every((r) => r.actor === "mat@example.test" && r.source === "admin")).toBe(true);
    expect(rows.every((r) => r.recordId === "cafe")).toBe(true);

    expect(rows[0].before).toBeNull();
    expect(rows[0].after).toMatchObject({ name: "Cafe v1" });
    expect(rows[1].before).toMatchObject({ name: "Cafe v1" });
    expect(rows[1].after).toMatchObject({ name: "Cafe v2" });
    expect(rows[2].action).toBe("delete");
  });

  it("defaults when no meta is passed: actor 'system', source 'admin', status 'live'", async () => {
    await writeRecord("lodging", validLodging({ id: "inn", name: "The Inn" }));
    const [row] = await tdb.db
      .select()
      .from(record)
      .where(eq(record.id, "inn"));
    expect(row.status).toBe("live");
    expect(row.source).toBe("admin");
    expect(row.updatedBy).toBe("system");
    const [a] = await auditRows("lodging");
    expect(a.actor).toBe("system");
  });

  it("validation failure throws RecordValidationError and writes NOTHING (no record row, no audit row)", async () => {
    await expect(
      writeRecord("restaurants", { id: "no-name" } as { id: string }),
    ).rejects.toBeInstanceOf(RecordValidationError);

    const rows = await readRecords("restaurants");
    expect(rows.some((r) => r.id === "no-name")).toBe(false);
    const audits = await auditRows("restaurants");
    expect(audits.some((a) => a.recordId === "no-name")).toBe(false);
  });

  it("id shape is enforced per store: entity ids reject spaces, site-copy dotted keys and site-pages paths pass", async () => {
    await expect(
      writeRecord("restaurants", { id: "bad id!", name: "X" }),
    ).rejects.toBeInstanceOf(RecordValidationError);
    await writeRecord("site-copy", { id: "home.hero.eyebrow", text: "hi" });
    await writeRecord("site-pages", { id: "/ferry", hidden: true } as {
      id: string;
      hidden: boolean;
    });
  });

  it("tombstones validate minimally — a bare { id, _deleted } passes even where live writes need more", async () => {
    await writeRecord("restaurants", { id: "junk-row", _deleted: true } as {
      id: string;
      _deleted: true;
    });
    const rows = await readRecords<{ id: string }>("restaurants");
    expect(rows.find((r) => r.id === "junk-row")?._deleted).toBe(true);
  });

  it("auth-users audit rows redact password material; the record itself keeps it", async () => {
    await writeRecord(
      "auth-users",
      {
        id: "u1",
        email: "u1@example.test",
        passwordHash: "scrypt$deadbeef$cafebabe",
      } as { id: string; email: string; passwordHash: string },
      { actor: "u1@example.test", source: "portal" },
    );

    const [row] = await tdb.db.select().from(record).where(eq(record.id, "u1"));
    expect((row.doc as { passwordHash: string }).passwordHash).toBe(
      "scrypt$deadbeef$cafebabe",
    );
    const [a] = await auditRows("auth-users");
    expect((a.after as { passwordHash: string }).passwordHash).toBe("[redacted]");
    expect(JSON.stringify(a)).not.toContain("deadbeef");
  });

  it("unknown store warns once but writes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await writeRecord("mystery-store", { id: "m1" });
      await writeRecord("mystery-store", { id: "m2" });
      const rows = await readRecords("mystery-store");
      expect(rows.map((r) => r.id).sort()).toEqual(["m1", "m2"]);
      const warnings = warn.mock.calls.filter((c) =>
        String(c[0]).includes("mystery-store"),
      );
      expect(warnings).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("deleteRecord tombstones while preserving the last doc, audited as delete", async () => {
    await writeRecord("charities", { id: "helpers", name: "The Helpers" });
    await deleteRecord("charities", "helpers", { actor: "mat@example.test" });

    const rows = await readRecords<{ id: string; name?: string }>("charities");
    const gone = rows.find((r) => r.id === "helpers");
    expect(gone?._deleted).toBe(true);
    expect(gone?.name).toBe("The Helpers");
    const audits = await auditRows("charities");
    expect(audits.at(-1)?.action).toBe("delete");
  });
});
