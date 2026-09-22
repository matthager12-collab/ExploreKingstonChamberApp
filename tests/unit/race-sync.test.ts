// Zeffy → registrant sync against PGlite with a fake Zeffy client: the
// question allowlist (an emergency-contact canary never reaches the
// database), buyer-level answers copied to every ticket, idempotent replay,
// contact fetches only for unseen tickets, refund/deletion handling, the
// guest fallback, campaign filtering and the webhook debounce.

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { raceRegistrant } from "@/lib/db/race-schema";
import { listRegistrants } from "@/lib/db/race-registrants";
import { audit } from "@/lib/db/schema";
import { __resetRaceSyncForTests, mapAnswers, runRaceSync } from "@/lib/race/sync";
import type { ZeffyClient, ZeffyContact, ZeffyPayment } from "@/lib/race/zeffy-client";
import { createTestDb, type TestDb } from "../setup/pglite-db";

const CAMPAIGN = "camp-race";
const CONFIG = { apiKey: "test-key", campaignId: CAMPAIGN };
const QUESTIONS = { shirt: "T-shirt size", waiver: "I accept the waiver" };
const CANARY_PHONE = "555-0100";
const CANARY_NAME = "Canary Emergency";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});
beforeEach(() => __resetRaceSyncForTests());

function payment(
  id: string,
  items: ZeffyPayment["items"],
  overrides: Partial<ZeffyPayment> = {},
): ZeffyPayment {
  return {
    id,
    campaign_id: CAMPAIGN,
    status: "succeeded",
    refund_status: "none",
    created: 1_789_600_000,
    buyer: { first_name: "Buyer", last_name: "Person", email: "buyer@example.test" },
    buyer_questions: [
      { question: "T-shirt size", type: "single_select", answer: "L" },
      { question: "Emergency contact name", type: "text", answer: CANARY_NAME },
    ],
    items,
    ...overrides,
  };
}

function ticket(id: string, contactId: string | null, questions: ZeffyPayment["items"][number]["questions"] = []) {
  return { id, type: "ticket", rate_id: "r1", rate_title: "Early Bird Runner Registration", contact_id: contactId, questions };
}

function fakeClient(payments: ZeffyPayment[], contacts: Record<string, ZeffyContact>, deleted = new Set<string>()) {
  const calls = { contacts: 0, lists: 0 };
  const client: ZeffyClient = {
    async listSucceededPayments() {
      calls.lists++;
      return payments.filter((p) => !deleted.has(p.id) && p.status === "succeeded");
    },
    async getPayment(id) {
      return deleted.has(id) ? null : (payments.find((p) => p.id === id) ?? null);
    },
    async getContact(id) {
      calls.contacts++;
      return contacts[id] ?? null;
    },
  };
  return { client, calls };
}

const CONTACTS: Record<string, ZeffyContact> = {
  "c-ann": { id: "c-ann", first_name: "Ann", last_name: "Runner", email: "ann@example.test" },
  "c-bob": { id: "c-bob", first_name: "Bob", last_name: "Runner", email: "bob@example.test" },
};

describe("mapAnswers", () => {
  it("keeps only the mapped questions and ignores everything else", () => {
    const mapped = mapAnswers(
      [
        { question: "  t-shirt size ", type: "single_select", answer: "M" },
        { question: "I accept the waiver", type: "checkbox", answer: true },
        { question: "Emergency contact phone", type: "phone", answer: CANARY_PHONE },
      ],
      QUESTIONS,
    );
    expect(mapped).toEqual({ shirtNote: "M", waiverSigned: true });
    expect(JSON.stringify(mapped)).not.toContain(CANARY_PHONE);
  });

  it("returns nulls when the form asks nothing mappable", () => {
    expect(mapAnswers([{ question: "Costume?", type: "text", answer: "ghost" }], QUESTIONS)).toEqual({
      shirtNote: null,
      waiverSigned: null,
    });
    expect(mapAnswers(undefined, { shirt: null, waiver: null })).toEqual({ shirtNote: null, waiverSigned: null });
  });
});

describe("runRaceSync", () => {
  it("first run creates a row per ticket, copies the buyer's shirt answer, fetches each contact once", async () => {
    const payments = [
      payment("p1", [
        ticket("i1", "c-ann", [{ question: "Emergency contact phone", type: "phone", answer: CANARY_PHONE }]),
        ticket("i2", "c-bob", [{ question: "T-shirt size", type: "single_select", answer: "S" }]),
      ]),
    ];
    const { client, calls } = fakeClient(payments, CONTACTS);
    const result = await runRaceSync("manual", { client, config: CONFIG, questions: QUESTIONS, runBy: "vitest" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats).toMatchObject({ fetched: 1, tickets: 2, created: 2, cancelled: 0, contactsFetched: 2 });

    const rows = await listRegistrants();
    const ann = rows.find((r) => r.itemId === "i1")!;
    const bob = rows.find((r) => r.itemId === "i2")!;
    expect(ann.firstName).toBe("Ann");
    expect(ann.email).toBe("ann@example.test");
    expect(ann.shirtNote).toBe("L"); // buyer-level answer applies to the ticket
    expect(bob.shirtNote).toBe("S"); // the per-ticket answer wins
    expect(ann.waiverSigned).toBeNull();

    // The emergency-contact canaries never reached the database or the audit trail.
    const everything = JSON.stringify([
      await tdb.db.select().from(raceRegistrant),
      await tdb.db.select().from(audit).where(eq(audit.store, "race_registrant")),
    ]);
    expect(everything).not.toContain(CANARY_PHONE);
    expect(everything).not.toContain(CANARY_NAME);

    // Replay: nothing new, no contact fetches.
    __resetRaceSyncForTests();
    const again = await runRaceSync("manual", { client, config: CONFIG, questions: QUESTIONS });
    expect(again.ok && again.stats.created).toBe(0);
    expect(calls.contacts).toBe(2);
    expect((await listRegistrants()).filter((r) => r.paymentId === "p1")).toHaveLength(2);
  });

  it("a ticket without an attendee contact falls back to the buyer and is flagged", async () => {
    const payments = [payment("p2", [ticket("g1", null), ticket("g2", null)])];
    const { client, calls } = fakeClient(payments, CONTACTS);
    const result = await runRaceSync("manual", { client, config: CONFIG, questions: QUESTIONS });
    expect(result.ok && result.stats.needsReview).toBe(2);
    expect(calls.contacts).toBe(0);
    const rows = (await listRegistrants()).filter((r) => r.paymentId === "p2");
    expect(rows.map((r) => r.lastName).sort()).toEqual(["Person", "Person (guest 2)"]);
    expect(rows.every((r) => r.needsReviewReason === "no-contact-id")).toBe(true);
    expect(rows.every((r) => r.email === "buyer@example.test")).toBe(true);
  });

  it("full refund cancels every ticket; partial refund flags them; a deleted payment cancels", async () => {
    const payments = [
      payment("p3", [ticket("f1", "c-ann"), ticket("f2", "c-bob")]),
      payment("p4", [ticket("q1", "c-ann")]),
      payment("p5", [ticket("d1", "c-bob")]),
    ];
    const { client } = fakeClient(payments, CONTACTS);
    await runRaceSync("manual", { client, config: CONFIG, questions: QUESTIONS });

    payments[0].refund_status = "full";
    payments[1].refund_status = "partial";
    const deleted = new Set(["p5"]);
    const second = fakeClient(payments, CONTACTS, deleted).client;
    __resetRaceSyncForTests();
    const result = await runRaceSync("manual", { client: second, config: CONFIG, questions: QUESTIONS });
    expect(result.ok && result.stats.cancelled).toBe(3);

    const rows = await listRegistrants();
    expect(rows.filter((r) => r.paymentId === "p3").every((r) => r.status === "cancelled")).toBe(true);
    const partial = rows.find((r) => r.paymentId === "p4")!;
    expect(partial.status).toBe("active");
    expect(partial.needsReviewReason).toBe("partial-refund");
    expect(rows.find((r) => r.paymentId === "p5")!.status).toBe("cancelled");

    // Cancelling again is a no-op.
    __resetRaceSyncForTests();
    const third = await runRaceSync("manual", { client: second, config: CONFIG, questions: QUESTIONS });
    expect(third.ok && third.stats.cancelled).toBe(0);
  });

  it("ignores payments from other campaigns and non-ticket items", async () => {
    const payments = [
      payment("p6", [ticket("o1", "c-ann")], { campaign_id: "camp-other" }),
      payment("p7", [
        { id: "don", type: "donation", rate_id: null, rate_title: null, contact_id: null, questions: [] },
        ticket("t7", "c-bob"),
      ]),
    ];
    const { client } = fakeClient(payments, CONTACTS);
    const result = await runRaceSync("manual", { client, config: CONFIG, questions: QUESTIONS });
    expect(result.ok && result.stats.tickets).toBe(1);
    const rows = await listRegistrants();
    expect(rows.some((r) => r.paymentId === "p6")).toBe(false);
    expect(rows.filter((r) => r.paymentId === "p7")).toHaveLength(1);
  });

  it("reports not-configured without touching Zeffy, and debounces webhook bursts", async () => {
    const { client, calls } = fakeClient([], CONTACTS);
    expect(await runRaceSync("manual", { client, config: null })).toEqual({ ok: false, reason: "not-configured" });
    expect(calls.lists).toBe(0);

    let clock = 1_000_000;
    const now = () => clock;
    expect((await runRaceSync("webhook", { client, config: CONFIG, questions: QUESTIONS, now })).ok).toBe(true);
    clock += 5_000;
    expect(await runRaceSync("webhook", { client, config: CONFIG, questions: QUESTIONS, now })).toEqual({
      ok: false,
      reason: "debounced",
    });
    // A manual press is never debounced.
    expect((await runRaceSync("manual", { client, config: CONFIG, questions: QUESTIONS, now })).ok).toBe(true);
    clock += 31_000;
    expect((await runRaceSync("webhook", { client, config: CONFIG, questions: QUESTIONS, now })).ok).toBe(true);
    expect(calls.lists).toBe(3);
  });
});
