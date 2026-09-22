// Race registrant store against a real (PGlite) database: idempotent upsert
// on the Zeffy (payment, item) pair, snapshot-only names, cancel per payment,
// set-state check-in, link versioning, retention anonymization, and the
// no-PII-in-audit rule the volunteer store established.

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { raceRegistrant } from "@/lib/db/race-schema";
import {
  anonymizeAllRegistrants,
  anonymizeRegistrantsByEmail,
  cancelRegistrantsForPayment,
  findRegistrantsByEmail,
  getCheckinLink,
  lastRaceSyncRun,
  listCheckinRoster,
  listExistingRegistrants,
  listRegistrants,
  mintCheckinLink,
  RACE_AUDIT_STORE,
  recordRaceSyncRun,
  revokeCheckinLink,
  setCheckedIn,
  upsertRegistrants,
  type RegistrantInput,
} from "@/lib/db/race-registrants";
import { audit } from "@/lib/db/schema";
import { createTestDb, type TestDb } from "../setup/pglite-db";

const EMAIL = "runner@example.test";
const ACTOR = "sync:zeffy";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

function input(overrides: Partial<RegistrantInput> = {}): RegistrantInput {
  return {
    paymentId: "pay-1",
    itemId: "item-1",
    contactId: "contact-1",
    firstName: "Test",
    lastName: "Runner",
    email: EMAIL,
    rateTitle: "Early Bird Runner Registration",
    shirtNote: "M",
    waiverSigned: null,
    status: "active",
    needsReviewReason: null,
    registeredAt: new Date("2026-09-16T12:00:00Z"),
    ...overrides,
  };
}

async function rowFor(paymentId: string, itemId: string) {
  const rows = await tdb.db
    .select()
    .from(raceRegistrant)
    .where(eq(raceRegistrant.paymentId, paymentId));
  return rows.find((r) => r.itemId === itemId)!;
}

describe("upsert on (payment, item)", () => {
  it("replaying the same ticket inserts once and keeps one row", async () => {
    const first = await upsertRegistrants([input()], ACTOR);
    expect(first.inserted).toHaveLength(1);
    const second = await upsertRegistrants([input()], ACTOR);
    expect(second.inserted).toHaveLength(0);
    expect((await listExistingRegistrants()).filter((r) => r.paymentId === "pay-1")).toHaveLength(1);
  });

  it("never rewrites a stored name or email; does refresh ticket fields", async () => {
    await upsertRegistrants(
      [input({ firstName: "Changed", email: "other@example.test", shirtNote: "XL", rateTitle: "Standard 5K Runner Entry" })],
      ACTOR,
    );
    const row = await rowFor("pay-1", "item-1");
    expect(row.firstName).toBe("Test");
    expect(row.email).toBe(EMAIL);
    expect(row.shirtNote).toBe("XL");
    expect(row.rateTitle).toBe("Standard 5K Runner Entry");
  });

  it("keeps a known contact id when a later sync sends null", async () => {
    await upsertRegistrants([input({ paymentId: "pay-c", itemId: "i", contactId: null })], ACTOR);
    await upsertRegistrants([input({ paymentId: "pay-c", itemId: "i", contactId: "contact-9" })], ACTOR);
    expect((await rowFor("pay-c", "i")).contactId).toBe("contact-9");
    await upsertRegistrants([input({ paymentId: "pay-c", itemId: "i", contactId: null })], ACTOR);
    expect((await rowFor("pay-c", "i")).contactId).toBe("contact-9");
  });
});

describe("cancel per payment", () => {
  it("cancels every active ticket on the payment, idempotently", async () => {
    await upsertRegistrants(
      [input({ paymentId: "pay-2", itemId: "a" }), input({ paymentId: "pay-2", itemId: "b" })],
      ACTOR,
    );
    expect(await cancelRegistrantsForPayment("pay-2", ACTOR)).toBe(2);
    expect(await cancelRegistrantsForPayment("pay-2", ACTOR)).toBe(0);
    const roster = await listCheckinRoster();
    const cancelledId = (await rowFor("pay-2", "a")).id;
    expect(roster.some((r) => r.id === cancelledId)).toBe(false);
  });
});

describe("check-in is set-state, not toggle", () => {
  it("a double tap changes nothing; un-check works; cancelled runners refuse", async () => {
    const { id } = await rowFor("pay-1", "item-1");
    expect(await setCheckedIn(id, true, "volunteer-link")).toEqual({ ok: true, changed: true });
    expect(await setCheckedIn(id, true, "volunteer-link")).toEqual({ ok: true, changed: false });
    expect((await rowFor("pay-1", "item-1")).checkedInBy).toBe("volunteer-link");
    expect(await setCheckedIn(id, false, "volunteer-link")).toEqual({ ok: true, changed: true });
    expect((await rowFor("pay-1", "item-1")).checkedInAt).toBeNull();

    const cancelled = await rowFor("pay-2", "a");
    expect(await setCheckedIn(cancelled.id, true, "volunteer-link")).toEqual({
      ok: false,
      reason: "cancelled",
    });
    expect(await setCheckedIn("00000000-0000-0000-0000-000000000000", true, "x")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });
});

describe("check-in link versioning", () => {
  it("each mint bumps the version and a revoke bumps it again", async () => {
    const expires = new Date("2026-11-08T08:00:00Z");
    const first = await mintCheckinLink("race", expires, "user-1");
    expect(first.version).toBe(1);
    const second = await mintCheckinLink("race", expires, "user-1");
    expect(second.version).toBe(2);
    expect(second.revokedAt).toBeNull();
    expect(await revokeCheckinLink("race")).toBe(true);
    const after = await getCheckinLink("race");
    expect(after?.version).toBe(3);
    expect(after?.revokedAt).not.toBeNull();
    expect(await revokeCheckinLink("nope")).toBe(false);
  });
});

describe("volunteer roster shape", () => {
  it("carries no email and no Zeffy ids", async () => {
    const roster = await listCheckinRoster();
    expect(roster.length).toBeGreaterThan(0);
    for (const row of roster) {
      expect(Object.keys(row)).not.toContain("email");
      expect(Object.keys(row)).not.toContain("paymentId");
      expect(Object.keys(row)).not.toContain("contactId");
    }
  });
});

describe("sync runs", () => {
  it("records and reads back the latest zeffy run", async () => {
    await recordRaceSyncRun({
      runBy: "vitest-admin",
      stats: { fetched: 3, created: 1 },
      report: { paymentIds: ["pay-1"] },
      startedAt: new Date(),
    });
    const last = await lastRaceSyncRun();
    expect(last?.source).toBe("zeffy");
    expect(last?.stats.fetched).toBe(3);
  });
});

describe("PII (E11)", () => {
  it("finds by email case-insensitively and anonymizes name, email and shirt note", async () => {
    // Every fixture above shares the one email — four tickets, one person.
    expect(await findRegistrantsByEmail(EMAIL.toUpperCase())).toHaveLength(4);
    expect(await anonymizeRegistrantsByEmail(EMAIL, "vitest-admin")).toBe(4);
    expect(await findRegistrantsByEmail(EMAIL)).toHaveLength(0);
    const row = await rowFor("pay-1", "item-1");
    expect(row.firstName).toBeNull();
    expect(row.email).toBeNull();
    expect(row.shirtNote).toBeNull();
    expect(row.rateTitle).toBe("Standard 5K Runner Entry");
    expect(row.anonymizedAt).not.toBeNull();
  });

  it("the retention sweep anonymizes every remaining row once", async () => {
    await upsertRegistrants(
      [input({ paymentId: "pay-late", itemId: "i", email: "late@example.test" })],
      ACTOR,
    );
    const n = await anonymizeAllRegistrants("retention");
    expect(n).toBe(1);
    expect(await anonymizeAllRegistrants("retention")).toBe(0);
    expect((await listRegistrants()).every((r) => r.email === null)).toBe(true);
  });

  it("audit rows for this store never carry a name or email", async () => {
    const rows = await tdb.db.select().from(audit).where(eq(audit.store, RACE_AUDIT_STORE));
    expect(rows.length).toBeGreaterThan(0);
    const blob = JSON.stringify(rows);
    expect(blob).not.toContain(EMAIL);
    expect(blob).not.toContain("Runner");
    expect(blob).not.toContain("Test");
  });
});
