// E09 audit surfaces: the trail read endpoint (redaction, filters, CSV,
// pagination cap) and the restore endpoint (round-trip, un-delete, schema
// rejection, concurrency, sensitive/unregistered/fragment refusals). Runs on
// per-suite PGlite migrated with the checked-in migrations, so the
// append-only trigger and the E09 indexes are the real thing.

import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/db/schema";
import { deleteRecord, readRecords, writeRecord } from "@/lib/db/records";
import { RESTORE_UNAVAILABLE_MESSAGE } from "@/lib/audit/restore-registry";
import {
  validRestaurant,
  validWebcam,
} from "../../../../tests/setup/domain-docs";
import { createTestDb, type TestDb } from "../../../../tests/setup/pglite-db";

const authState = vi.hoisted(() => ({
  user: null as null | { id: string; role: string; email: string },
}));

vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(async () => authState.user),
  requireAdmin: vi.fn(async () =>
    !authState.user
      ? Response.json({ error: "Sign in first" }, { status: 401 })
      : authState.user.role !== "admin"
        ? Response.json({ error: "You do not have access to that" }, { status: 403 })
        : null,
  ),
}));

import { GET } from "@/app/api/admin/audit/route";
import { POST } from "@/app/api/admin/audit/restore/route";

const ADMIN = { id: "admin-1", role: "admin", email: "admin@example.test" };

function get(query = "") {
  return GET(new NextRequest(`http://localhost/api/admin/audit${query}`));
}
function postRestore(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/admin/audit/restore", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

type EntryJson = {
  id: number;
  action: string;
  store: string;
  recordId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadataOnly: boolean;
  restorable: boolean;
};
type PageJson = {
  entries: EntryJson[];
  nextCursor: number | null;
  recordMeta?: { updatedAt: string; updatedBy: string | null; deleted: boolean; status: string } | null;
};

/** Current updatedAt for the concurrency pin, via the API like the UI does. */
async function currentUpdatedAt(store: string, recordId: string): Promise<string | null> {
  const res = await get(`?store=${store}&recordId=${recordId}&limit=1`);
  const data = (await res.json()) as PageJson;
  return data.recordMeta?.updatedAt ?? null;
}

async function allAuditRows(tdb: TestDb) {
  return tdb.db.select().from(audit).orderBy(audit.id);
}

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

describe("audit-route auth", () => {
  it("returns 401 with no session on both routes", async () => {
    authState.user = null;
    expect((await get()).status).toBe(401);
    expect(
      (
        await postRestore({ store: "restaurants", recordId: "x", auditId: 1, expectedUpdatedAt: null })
      ).status,
    ).toBe(401);
  });

  it("returns 403 for an authenticated non-admin on both routes", async () => {
    authState.user = { id: "u2", role: "moderator", email: "mod@example.test" };
    expect((await get()).status).toBe(403);
    expect(
      (
        await postRestore({ store: "restaurants", recordId: "x", auditId: 1, expectedUpdatedAt: null })
      ).status,
    ).toBe(403);
  });
});

describe("restore round-trip", () => {
  beforeEach(() => {
    authState.user = ADMIN;
  });

  it("restores v1, mints exactly one 'restore' audit row, leaves history byte-identical", async () => {
    const v1 = validRestaurant({ id: "rt-cafe", name: "Original Cafe" });
    await writeRecord("restaurants", v1, { actor: "one@example.test", source: "admin" });
    await writeRecord(
      "restaurants",
      { ...v1, name: "Renamed Cafe" },
      { actor: "two@example.test", source: "admin" },
    );

    const history = (await (await get("?store=restaurants&recordId=rt-cafe")).json()) as PageJson;
    const createEntry = history.entries.find((e) => e.action === "create");
    expect(createEntry).toBeDefined();
    expect(createEntry!.restorable).toBe(true);

    const rowsBefore = await allAuditRows(tdb);
    const res = await postRestore({
      store: "restaurants",
      recordId: "rt-cafe",
      auditId: createEntry!.id,
      expectedUpdatedAt: history.recordMeta!.updatedAt,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; recordMeta: { updatedBy: string } };
    expect(body.ok).toBe(true);
    expect(body.recordMeta.updatedBy).toBe(ADMIN.email);

    const docs = await readRecords<{ id: string; name: string }>("restaurants");
    expect(docs.find((d) => d.id === "rt-cafe")).toEqual(v1);

    const rowsAfter = await allAuditRows(tdb);
    expect(rowsAfter.length).toBe(rowsBefore.length + 1);
    // Pre-existing rows are byte-identical — restore appends, never edits.
    expect(JSON.stringify(rowsAfter.slice(0, rowsBefore.length))).toBe(
      JSON.stringify(rowsBefore),
    );
    const minted = rowsAfter[rowsAfter.length - 1];
    expect(minted.action).toBe("restore");
    expect(minted.actor).toBe(ADMIN.email);
    expect(minted.store).toBe("restaurants");
    expect(minted.recordId).toBe("rt-cafe");
  });
});

describe("un-delete round-trip", () => {
  beforeEach(() => {
    authState.user = ADMIN;
  });

  it("brings a tombstoned record back live via its pre-delete snapshot", async () => {
    const cam = validWebcam({ id: "ud-cam", name: "Dock Cam" });
    await writeRecord("webcams", cam, { actor: ADMIN.email, source: "admin" });
    await deleteRecord("webcams", "ud-cam", { actor: ADMIN.email, source: "admin" });

    const history = (await (await get("?store=webcams&recordId=ud-cam")).json()) as PageJson;
    expect(history.recordMeta?.deleted).toBe(true);
    const createEntry = history.entries.find((e) => e.action === "create")!;

    const res = await postRestore({
      store: "webcams",
      recordId: "ud-cam",
      auditId: createEntry.id,
      expectedUpdatedAt: history.recordMeta!.updatedAt,
    });
    expect(res.status).toBe(200);

    const rows = await readRecords<{ id: string; _deleted?: boolean }>("webcams");
    const restored = rows.find((r) => r.id === "ud-cam");
    expect(restored).toBeDefined();
    expect(restored!._deleted).toBeUndefined();
  });

  it("a delete entry replays as a re-delete", async () => {
    const cam = validWebcam({ id: "rd-cam" });
    await writeRecord("webcams", cam, { actor: ADMIN.email, source: "admin" });
    await deleteRecord("webcams", "rd-cam", { actor: ADMIN.email, source: "admin" });
    // un-delete first so the record is live again
    const h1 = (await (await get("?store=webcams&recordId=rd-cam")).json()) as PageJson;
    await postRestore({
      store: "webcams",
      recordId: "rd-cam",
      auditId: h1.entries.find((e) => e.action === "create")!.id,
      expectedUpdatedAt: h1.recordMeta!.updatedAt,
    });
    // now restore the delete entry → tombstoned again
    const h2 = (await (await get("?store=webcams&recordId=rd-cam")).json()) as PageJson;
    const res = await postRestore({
      store: "webcams",
      recordId: "rd-cam",
      auditId: h2.entries.find((e) => e.action === "delete")!.id,
      expectedUpdatedAt: h2.recordMeta!.updatedAt,
    });
    expect(res.status).toBe(200);
    const rows = await readRecords<{ id: string; _deleted?: boolean }>("webcams");
    expect(rows.find((r) => r.id === "rd-cam")?._deleted).toBe(true);
  });
});

describe("zod rejection", () => {
  beforeEach(() => {
    authState.user = ADMIN;
  });

  it("422s a snapshot that violates the current schema; nothing written", async () => {
    const v1 = validRestaurant({ id: "zr-cafe" });
    await writeRecord("restaurants", v1, { actor: ADMIN.email, source: "admin" });
    // A snapshot that predates a (hypothetical) schema tightening: name gone.
    const [bad] = await tdb.db
      .insert(audit)
      .values({
        actor: "old@example.test",
        action: "update",
        store: "restaurants",
        recordId: "zr-cafe",
        before: v1,
        after: { id: "zr-cafe" },
        source: "admin",
      })
      .returning({ id: audit.id });

    const rowsBefore = await allAuditRows(tdb);
    const res = await postRestore({
      store: "restaurants",
      recordId: "zr-cafe",
      auditId: bad.id,
      expectedUpdatedAt: await currentUpdatedAt("restaurants", "zr-cafe"),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/no longer matches the current rules/);

    expect((await allAuditRows(tdb)).length).toBe(rowsBefore.length);
    const docs = await readRecords<{ id: string; name?: string }>("restaurants");
    expect(docs.find((d) => d.id === "zr-cafe")?.name).toBe(v1.name);
  });
});

describe("stale concurrency", () => {
  beforeEach(() => {
    authState.user = ADMIN;
  });

  it("409s when the record changed since the history was loaded; nothing written", async () => {
    const v1 = validRestaurant({ id: "cc-cafe" });
    await writeRecord("restaurants", v1, { actor: ADMIN.email, source: "admin" });
    const history = (await (await get("?store=restaurants&recordId=cc-cafe")).json()) as PageJson;

    const rowsBefore = await allAuditRows(tdb);
    const res = await postRestore({
      store: "restaurants",
      recordId: "cc-cafe",
      auditId: history.entries[0].id,
      expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    });
    expect(res.status).toBe(409);
    expect((await allAuditRows(tdb)).length).toBe(rowsBefore.length);
  });
});

describe("restore refusals", () => {
  beforeEach(() => {
    authState.user = ADMIN;
  });

  it("400s auth-store restores", async () => {
    await writeRecord(
      "auth-users",
      { id: "au-1", email: "victim@example.test", passwordHash: "h4sh-value" },
      { actor: "system", source: "admin" },
    );
    const rows = await allAuditRows(tdb);
    const row = rows.find((r) => r.store === "auth-users")!;
    const res = await postRestore({
      store: "auth-users",
      recordId: "au-1",
      auditId: row.id,
      expectedUpdatedAt: await currentUpdatedAt("auth-users", "au-1"),
    });
    expect(res.status).toBe(400);
  });

  it("400s stores outside the restore registry, with the friendly reason", async () => {
    await writeRecord(
      "ferry-prediction",
      { id: "settings", enabled: true },
      { actor: "system", source: "admin" },
    );
    const rows = await allAuditRows(tdb);
    const row = rows.find((r) => r.store === "ferry-prediction")!;
    const res = await postRestore({
      store: "ferry-prediction",
      recordId: "settings",
      auditId: row.id,
      expectedUpdatedAt: await currentUpdatedAt("ferry-prediction", "settings"),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      RESTORE_UNAVAILABLE_MESSAGE,
    );
  });

  it("400s partial-snapshot entries (status-change and friends)", async () => {
    const v1 = validRestaurant({ id: "fr-cafe" });
    await writeRecord("restaurants", v1, { actor: ADMIN.email, source: "admin" });
    const [frag] = await tdb.db
      .insert(audit)
      .values({
        actor: ADMIN.email,
        action: "status-change",
        store: "restaurants",
        recordId: "fr-cafe",
        before: { status: "live" },
        after: { status: "hidden" },
        source: "admin",
      })
      .returning({ id: audit.id });
    const res = await postRestore({
      store: "restaurants",
      recordId: "fr-cafe",
      auditId: frag.id,
      expectedUpdatedAt: await currentUpdatedAt("restaurants", "fr-cafe"),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/status-change/);
  });

  it("404s an auditId that belongs to a different record", async () => {
    const v1 = validRestaurant({ id: "mm-cafe" });
    await writeRecord("restaurants", v1, { actor: ADMIN.email, source: "admin" });
    const rows = await allAuditRows(tdb);
    const row = rows.find((r) => r.recordId === "mm-cafe")!;
    const res = await postRestore({
      store: "restaurants",
      recordId: "some-other-id",
      auditId: row.id,
      expectedUpdatedAt: null,
    });
    expect(res.status).toBe(404);
    expect((await postRestore({
      store: "restaurants",
      recordId: "mm-cafe",
      auditId: 99_999_999,
      expectedUpdatedAt: null,
    })).status).toBe(404);
  });
});

describe("redaction", () => {
  beforeEach(() => {
    authState.user = ADMIN;
  });

  it("auth-store rows are metadata-only: neither hash value nor key appears", async () => {
    // Written in "restore refusals" above; assert on the read side here.
    const res = await get("?store=auth-users");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("h4sh-value");
    expect(text.toLowerCase()).not.toContain("passwordhash");
    const data = JSON.parse(text) as PageJson;
    expect(data.entries.length).toBeGreaterThan(0);
    for (const entry of data.entries) {
      expect(entry.metadataOnly).toBe(true);
      expect(entry.before).toBeNull();
      expect(entry.after).toBeNull();
      expect(entry.restorable).toBe(false);
    }
  });

  it("denylisted keys are removed from non-auth stores too", async () => {
    await writeRecord(
      "events",
      { id: "ev-1", title: "Concert", start: "2026-08-01", token: "sekrit-tok" },
      { actor: ADMIN.email, source: "admin" },
    );
    const text = await (await get("?store=events")).text();
    expect(text).not.toContain("sekrit-tok");
    expect(text).not.toContain('"token"');
    expect(text).toContain("Concert");
  });

  it("CSV: correct header/content-type, no bodies, no secrets, injection-proofed", async () => {
    await writeRecord(
      "charities",
      { id: "ch-1", name: "Helpers" },
      { actor: "=HYPERLINK(evil)", source: "admin" },
    );
    const res = await get("?format=csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/csv");
    expect(res.headers.get("content-disposition") ?? "").toMatch(
      /attachment; filename="audit-export-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    const text = await res.text();
    expect(text.split("\n")[0]).toBe("ts,actor,action,store,record_id,source");
    expect(text).not.toContain("h4sh-value");
    expect(text.toLowerCase()).not.toContain("passwordhash");
    expect(text).not.toContain("sekrit-tok");
    // Formula injection: the leading = is neutralized with a quote prefix.
    expect(text).toContain("'=HYPERLINK(evil)");
    expect(text).not.toMatch(/^=|,=/m);
  });
});

describe("pagination", () => {
  beforeEach(() => {
    authState.user = ADMIN;
  });

  it("caps a page at 200 and cursor-walks the full set without overlap", async () => {
    const bulk = Array.from({ length: 230 }, (_, i) => ({
      actor: "bulk@example.test",
      action: "update",
      store: "bulk-store",
      recordId: `r${i % 7}`,
      before: null,
      after: { id: `r${i % 7}`, n: i },
      source: "admin",
    }));
    await tdb.db.insert(audit).values(bulk);

    const capped = (await (
      await get("?store=bulk-store&limit=500")
    ).json()) as PageJson;
    expect(capped.entries.length).toBe(200);
    expect(capped.nextCursor).not.toBeNull();

    const seen = new Set<number>();
    let cursor: number | null = null;
    let previousLow = Number.POSITIVE_INFINITY;
    do {
      const query: string =
        `?store=bulk-store&limit=60` + (cursor === null ? "" : `&cursor=${cursor}`);
      const page = (await (await get(query)).json()) as PageJson;
      for (const entry of page.entries) {
        expect(seen.has(entry.id)).toBe(false);
        seen.add(entry.id);
        expect(entry.id).toBeLessThan(previousLow + 1);
        previousLow = entry.id;
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen.size).toBe(230);
  });
});
