// Zeffy → registrant sync against PGlite with a fake Zeffy client: the
// question allowlist (an emergency-contact canary never reaches the
// database), buyer-level answers copied to every ticket, idempotent replay,
// contact fetches only for unseen tickets, refund/deletion handling, the
// guest fallback, campaign filtering and the webhook debounce.

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { raceRegistrant } from "@/lib/db/race-schema";
import { anonymizeAllRegistrants, listCheckinRoster, listRegistrants, upsertRegistrants } from "@/lib/db/race-registrants";
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

/** The campaign's price list. Only r-shirt is an add-on (the $15 shirt). */
const RATES = [
  { id: "r1", title: "Early Bird Runner Registration", is_add_on: false },
  { id: "r-shirt", title: "ExploreKingston exclusive t-shirt", is_add_on: true },
];

function shirt(id: string) {
  return { id, type: "ticket", rate_id: "r-shirt", rate_title: "ExploreKingston exclusive t-shirt", contact_id: null, questions: [] };
}

function fakeClient(payments: ZeffyPayment[], contacts: Record<string, ZeffyContact>, deleted = new Set<string>()) {
  const calls = { contacts: 0, lists: 0, rates: 0 };
  const client: ZeffyClient = {
    async getCampaignRates() {
      calls.rates++;
      return RATES;
    },
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

// ---------------------------------------------------------------------------
// Three defects fixed 2026-09-22 after the close-out review. Each case below
// failed against the code as merged in PR #227.
// ---------------------------------------------------------------------------

describe("mapAnswers matches the whole question, not its opening words", () => {
  const LIVE =
    "If adding ExploreKingston t-shirt(s), note desired sizing otherwise you'll be given first-come/first-served choice of remaining options";

  it("ignores a question that merely starts with the configured one", () => {
    // The old prefix match stored this answer — an emergency contact — in the
    // shirt column, where the volunteer check-in screen shows it.
    const mapped = mapAnswers(
      [{ question: `${LIVE}, and who is your emergency contact?`, type: "text", answer: `${CANARY_NAME} ${CANARY_PHONE}` }],
      { shirt: LIVE, waiver: null },
    );
    expect(mapped.shirtNote).toBeNull();
  });

  it("still matches the live wording across case, spacing and curly quotes", () => {
    const asZeffySendsIt = "if adding  ExploreKingston t-shirt(s), note desired sizing otherwise you’ll be given first-come/first-served choice of remaining options ";
    expect(mapAnswers([{ question: asZeffySendsIt, type: "text", answer: "M and L" }], { shirt: LIVE, waiver: null }).shirtNote).toBe(
      "M and L",
    );
  });
});

describe("an erased runner stays erased", () => {
  it("a sync after anonymization does not write the shirt answer back", async () => {
    await tdb.db.delete(raceRegistrant);
    const payments = [payment("p-anon", [ticket("i-anon", "c-ann")])];
    const { client } = fakeClient(payments, CONTACTS);
    await runRaceSync("manual", { client, config: CONFIG, questions: QUESTIONS });
    expect((await listRegistrants())[0].shirtNote).toBe("L");

    await anonymizeAllRegistrants("vitest");
    __resetRaceSyncForTests();
    await runRaceSync("manual", { client, config: CONFIG, questions: QUESTIONS });

    const [row] = await listRegistrants();
    expect(row.anonymizedAt).not.toBeNull();
    expect(row.firstName).toBeNull();
    expect(row.email).toBeNull();
    // The retention sweep skips rows already marked anonymized, so anything
    // written back here would stay forever.
    expect(row.shirtNote).toBeNull();
  });
});

describe("add-ons are not runners", () => {
  it("a shirt bought with a ticket is counted on the order, not registered as a second runner", async () => {
    await tdb.db.delete(raceRegistrant);
    const payments = [payment("p-shirts", [ticket("i-runner", "c-ann"), shirt("i-shirt-1"), shirt("i-shirt-2")])];
    const { client, calls } = fakeClient(payments, CONTACTS);
    const result = await runRaceSync("manual", { client, config: CONFIG, questions: QUESTIONS });
    expect(result.ok && result.stats.tickets).toBe(1);
    expect(calls.rates).toBe(1);

    const rows = await listRegistrants();
    expect(rows).toHaveLength(1);
    expect(rows[0].firstName).toBe("Ann");
    expect(rows[0].rateTitle).toBe("Early Bird Runner Registration");
    expect(rows[0].needsReviewReason).toBeNull();
    // "Order:" because a family order copies this to every runner on it — it
    // is the order's total, not each runner's.
    expect(rows[0].shirtNote).toBe("Order: 2 × ExploreKingston exclusive t-shirt · L");
  });

  it("removes shirt rows an earlier sync wrongly added as runners, and audits it by id only", async () => {
    await tdb.db.delete(raceRegistrant);
    // What the sync as merged in PR #227 wrote for a runner + shirt order.
    await upsertRegistrants(
      [
        {
          paymentId: "p-old", itemId: "i-old-runner", contactId: "c-bob", firstName: "Bob", lastName: "Runner",
          email: "bob@example.test", rateTitle: "Early Bird Runner Registration", shirtNote: "L", waiverSigned: null,
          status: "active", needsReviewReason: null, registeredAt: new Date(1_789_600_000 * 1000),
        },
        {
          paymentId: "p-old", itemId: "i-old-shirt", contactId: null, firstName: "Buyer", lastName: "Person",
          email: "buyer@example.test", rateTitle: "ExploreKingston exclusive t-shirt", shirtNote: "L", waiverSigned: null,
          status: "active", needsReviewReason: "no-contact-id", registeredAt: new Date(1_789_600_000 * 1000),
        },
      ],
      "vitest",
    );
    const phantomId = (await listRegistrants()).find((r) => r.itemId === "i-old-shirt")!.id;

    const payments = [payment("p-old", [ticket("i-old-runner", "c-bob"), shirt("i-old-shirt")])];
    const { client } = fakeClient(payments, CONTACTS);
    const result = await runRaceSync("manual", { client, config: CONFIG, questions: QUESTIONS });

    const rows = await listRegistrants();
    expect(rows.map((r) => r.itemId)).toEqual(["i-old-runner"]);
    expect(result.ok && result.stats.removed).toBe(1);
    const removal = (await tdb.db.select().from(audit).where(eq(audit.recordId, phantomId))).find(
      (a) => a.action === "delete",
    );
    expect(removal).toBeDefined();
    expect(JSON.stringify(removal!.after)).not.toMatch(/Buyer|example\.test/);
  });

  it("leaves an erased shirt row in place, so its details cannot come back", async () => {
    // Outside review, 2026-09-22: deleting an anonymized row also deletes the
    // mark that keeps it erased. A later sync that misread the shirt would
    // then insert it afresh, buyer's name and all.
    await tdb.db.delete(raceRegistrant);
    await upsertRegistrants(
      [
        {
          paymentId: "p-old", itemId: "i-old-shirt", contactId: null, firstName: "Buyer", lastName: "Person",
          email: "buyer@example.test", rateTitle: "ExploreKingston exclusive t-shirt", shirtNote: "L", waiverSigned: null,
          status: "active", needsReviewReason: "no-contact-id", registeredAt: new Date(1_789_600_000 * 1000),
        },
      ],
      "vitest",
    );
    await anonymizeAllRegistrants("vitest");

    const { client } = fakeClient([payment("p-old", [shirt("i-old-shirt")])], CONTACTS);
    const result = await runRaceSync("manual", { client, config: CONFIG, questions: QUESTIONS });

    // Kept, but off the roster: a "delete my data" request can erase a row
    // before race day, and volunteers must not see a nameless shirt runner.
    expect(result.ok && result.stats.removed).toBe(1);
    const kept = (await listRegistrants()).find((r) => r.itemId === "i-old-shirt");
    expect(kept?.anonymizedAt).not.toBeNull();
    expect(kept?.firstName).toBeNull();
    expect(kept?.status).toBe("cancelled");
    expect(await listCheckinRoster()).toHaveLength(0);
  });

  it("deletes only the named add-on row, whatever its ids look like", async () => {
    // Security negative: Zeffy's ids reach a DELETE. Quote-and-OR shaped ids
    // must stay data, and a runner on the same payment must survive.
    await tdb.db.delete(raceRegistrant);
    const pay = "p-x' or '1'='1";
    const base = {
      contactId: null, firstName: "Buyer", lastName: "Person", email: "buyer@example.test", shirtNote: null,
      waiverSigned: null, status: "active" as const, needsReviewReason: null, registeredAt: new Date(1_789_600_000 * 1000),
    };
    await upsertRegistrants(
      [
        { ...base, paymentId: pay, itemId: "i-run'); delete from race_registrant; --", rateTitle: "Early Bird Runner Registration" },
        { ...base, paymentId: pay, itemId: "i-shirt' or 1=1 --", rateTitle: "ExploreKingston exclusive t-shirt" },
        { ...base, paymentId: "p-other", itemId: "i-other", rateTitle: "Early Bird Runner Registration" },
      ],
      "vitest",
    );
    const { client } = fakeClient(
      [payment(pay, [ticket("i-run'); delete from race_registrant; --", null), shirt("i-shirt' or 1=1 --")])],
      CONTACTS,
    );
    const result = await runRaceSync("manual", { client, config: CONFIG, questions: QUESTIONS });

    expect(result.ok && result.stats.removed).toBe(1);
    expect((await listRegistrants()).map((r) => r.itemId).sort()).toEqual(
      ["i-other", "i-run'); delete from race_registrant; --"].sort(),
    );
  });

  it("stops before writing anything when Zeffy sends no price list", async () => {
    // Without the rates nothing marks the shirt as an add-on, so every shirt
    // would be stored as a runner again. Every campaign with tickets has rates.
    await tdb.db.delete(raceRegistrant);
    const payments = [payment("p-shirts", [ticket("i-runner", "c-ann"), shirt("i-shirt-1")])];
    const { client } = fakeClient(payments, CONTACTS);
    client.getCampaignRates = async () => [];

    await expect(runRaceSync("manual", { client, config: CONFIG, questions: QUESTIONS })).rejects.toThrow(/price list/);
    expect(await listRegistrants()).toHaveLength(0);
  });
});
