// E11: the public privacy-request intake — no account (NFR-07), rate-limited,
// creates a privacy_request worklist item with a 45-day due date, and never
// lets the requester's contact reach the immortal audit table (D-12).

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST } from "@/app/api/privacy/request/route";
import { audit } from "@/lib/db/schema";
import { listWorklistItems } from "@/lib/db/worklist";
import { createTestDb, type TestDb } from "../../../../tests/setup/pglite-db";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

function post(ip: string, body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/privacy/request", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
    }),
  );
}

describe("POST /api/privacy/request", () => {
  it("creates a privacy_request item with a ~45-day due date, no auth required", async () => {
    const before = Date.now();
    const res = await post("203.0.113.40", {
      kind: "delete",
      contact: "someone@example.test",
      note: "please remove my account",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const items = await listWorklistItems({ type: "privacy_request" });
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.subjectStore).toBe("privacy");
    expect(item.state).toBe("open");
    expect((item.payload as { requestKind: string }).requestKind).toBe("delete");
    // Label is PII-free: kind + date, never the contact.
    expect(item.subjectLabel).not.toContain("someone@example.test");
    // Due date ~45 days out.
    const dueMs = item.dueAt!.getTime() - before;
    const days = dueMs / (24 * 60 * 60_000);
    expect(days).toBeGreaterThan(44.9);
    expect(days).toBeLessThan(45.1);
  });

  it("keeps the requester's contact OUT of the audit table (D-12)", async () => {
    await post("203.0.113.41", { kind: "access", contact: "audit-leak@example.test" });
    const rows = await tdb.db.select().from(audit);
    const worklistAudits = rows.filter((a) => a.store === "worklist");
    expect(worklistAudits.length).toBeGreaterThan(0); // the create was audited
    for (const a of worklistAudits) {
      const body = JSON.stringify(a.after ?? {}) + JSON.stringify(a.before ?? {});
      expect(body).not.toContain("audit-leak@example.test");
    }
  });

  it("rejects an unknown kind and a missing contact", async () => {
    expect((await post("203.0.113.42", { kind: "steal", contact: "x@y.z" })).status).toBe(400);
    expect((await post("203.0.113.43", { kind: "access" })).status).toBe(400);
  });

  it("rate-limits after 5 from one IP", async () => {
    const ip = "203.0.113.44";
    for (let i = 0; i < 5; i++) {
      expect((await post(ip, { kind: "access", contact: `c${i}@example.test` })).status).toBe(200);
    }
    expect((await post(ip, { kind: "access", contact: "c6@example.test" })).status).toBe(429);
  });

  it("accepts the records kind (FR-A92 public-records intake)", async () => {
    const res = await post("203.0.113.45", { kind: "records", contact: "clerk@example.test" });
    expect(res.status).toBe(200);
    const items = await listWorklistItems({ type: "privacy_request" });
    expect(items.some((i) => (i.payload as { requestKind: string }).requestKind === "records")).toBe(
      true,
    );
  });
});
