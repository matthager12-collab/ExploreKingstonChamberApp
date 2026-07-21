// E11: admin privacy-request fulfillment — access export, delete across the
// PII inventory, and the legal-hold refusal (FR-A92 reconciliation).
//
// Auth is stubbed to an admin so the test exercises fulfillment logic, not the
// E06 gate (which has its own suite).

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Mutable auth so a gate-removal mutation can't survive: the mock enforces the
// real admin contract (non-admin → 401), and a test flips it to prove the gate.
const authState = vi.hoisted(() => ({
  user: { email: "admin@example.test", role: "admin" } as { email: string; role: string } | null,
}));
vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(async () => authState.user),
  requireAdmin: vi.fn(async () =>
    authState.user?.role === "admin"
      ? null
      : Response.json({ error: "Sign in first" }, { status: 401 }),
  ),
}));

import { POST } from "@/app/api/admin/privacy/fulfill/route";
import { insertUser, findUserByEmail } from "@/lib/db/auth-store";
import { createWorklistItem, getWorklistItem } from "@/lib/db/worklist";
import { isUnderLegalHold } from "@/lib/db/privacy-delete";
import { audit } from "@/lib/db/schema";
import { createTestDb, type TestDb } from "../../../../tests/setup/pglite-db";

let tdb: TestDb;
const CONTACT = "deleteme@example.test";

async function makeRequest(kind: string, contact: string) {
  const { item } = await createWorklistItem(
    {
      type: "privacy_request",
      subjectStore: "privacy",
      subjectId: crypto.randomUUID(),
      subjectLabel: `${kind} request`,
      payload: { requestKind: kind, contact },
    },
    { actor: "public", source: "public" },
  );
  return item;
}

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/admin/privacy/fulfill", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeAll(async () => {
  tdb = await createTestDb();
  await insertUser(
    { id: "u-del", email: CONTACT, name: "Del User", role: "viewer", orgId: null, passwordHash: "scrypt$x$y" },
    { actor: "admin", action: "profile-update", source: "admin" },
  );
});
afterAll(async () => {
  await tdb.close();
});

describe("privacy fulfillment", () => {
  it("access returns an export bundle spanning the PII inventory", async () => {
    const item = await makeRequest("access", CONTACT);
    const res = await post({ op: "access", itemId: item.id });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { export: { sections: { store: string }[] } };
    const stores = data.export.sections.map((s) => s.store);
    expect(stores).toContain("users");
    expect(stores).toContain("survey_response"); // no-identifier stores included too
  });

  it("delete anonymizes across stores and resolves the item", async () => {
    const item = await makeRequest("delete", CONTACT);
    const res = await post({ op: "delete", itemId: item.id });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    // The account is anonymized.
    expect(await findUserByEmail(CONTACT)).toBeUndefined();
    // The item is resolved AND its contact scrubbed (redact-at-resolution).
    const resolved = await getWorklistItem(item.id);
    expect(resolved?.state).toBe("resolved");
    expect((resolved?.payload as { contact?: string }).contact).toBeUndefined();
  });

  it("a legal hold REFUSES deletion and logs the reconciliation (FR-A92)", async () => {
    const item = await makeRequest("delete", "held-person@example.test");
    // Place a hold, then attempt delete.
    expect((await post({ op: "hold-set", itemId: item.id, reason: "litigation 2026-19" })).status).toBe(200);
    expect(await isUnderLegalHold("privacy", item.subjectId)).toBe(true);

    const res = await post({ op: "delete", itemId: item.id });
    const data = (await res.json()) as { ok: boolean; refused?: string };
    expect(data.ok).toBe(false);
    expect(data.refused).toBe("legal-hold");
    // The item is NOT resolved (still actionable once the hold lifts).
    expect((await getWorklistItem(item.id))?.state).toBe("open");
    // The refusal is logged in the audit trail.
    const rows = await tdb.db.select().from(audit);
    expect(rows.some((a) => a.action === "privacy-delete-refused-hold")).toBe(true);

    // Clearing the hold lets the delete proceed.
    expect((await post({ op: "hold-clear", itemId: item.id })).status).toBe(200);
    expect(await isUnderLegalHold("privacy", item.subjectId)).toBe(false);
    expect((await post({ op: "delete", itemId: item.id })).status).toBe(200);
    expect((await getWorklistItem(item.id))?.state).toBe("resolved");
  });

  it("rejects a missing item, a REAL non-privacy item, and an unknown op", async () => {
    expect((await post({ op: "access", itemId: crypto.randomUUID() })).status).toBe(404);
    // A real item of the wrong type must hit the type guard, not just 404-on-missing.
    const { item: moderationItem } = await createWorklistItem(
      {
        type: "report_inaccurate",
        subjectStore: "restaurants",
        subjectId: "cafe",
        subjectLabel: "The Cafe",
        payload: { messages: [{ message: "wrong hours", at: new Date().toISOString() }], count: 1 },
      },
      { actor: "public", source: "public" },
    );
    expect((await post({ op: "delete", itemId: moderationItem.id })).status).toBe(404);
    const item = await makeRequest("access", "x@example.test");
    expect((await post({ op: "frobnicate", itemId: item.id })).status).toBe(400);
  });

  it("enforces the admin gate: a non-admin is 401'd on every op", async () => {
    const item = await makeRequest("access", "gate@example.test");
    const saved = authState.user;
    authState.user = null; // signed out
    try {
      for (const op of ["access", "delete", "hold-set", "hold-clear"]) {
        expect((await post({ op, itemId: item.id, reason: "x" })).status).toBe(401);
      }
    } finally {
      authState.user = saved;
    }
  });
});
