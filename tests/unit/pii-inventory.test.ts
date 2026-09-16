// E11: the PII-inventory coverage test — the tripwire the E16 registration
// contract points reviewers at. Every registered store must implement the full
// handler set; the known stores must all be present; and the identifier-backed
// handlers must actually round-trip (find → export → anonymize) against real
// data so "registered" can't mean "stubbed".

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PII_STORES, PII_STORE_IDS } from "@/lib/privacy/pii-inventory";
import { insertUser, findUserByEmail, insertInvite } from "@/lib/db/auth-store";
import { writeRecord, readRecordRows } from "@/lib/db/records";
import { appendFeedbackResponse } from "@/lib/db/append";
import { saveCharity } from "@/lib/stores/charity-store";
import { createTestDb, type TestDb } from "../setup/pglite-db";

describe("PII inventory coverage (the E16 tripwire)", () => {
  it("every entry implements the full handler set", () => {
    for (const s of PII_STORES) {
      expect(typeof s.findByIdentifier, s.store).toBe("function");
      expect(typeof s.exportRecords, s.store).toBe("function");
      expect(typeof s.deleteOrAnonymize, s.store).toBe("function");
      expect(typeof s.description, s.store).toBe("string");
      expect(typeof s.hasEmailIdentifier, s.store).toBe("boolean");
    }
  });

  it("registers every known PII store (add a store → register it here)", () => {
    // If a future epic adds a personal-data store, this list forces the
    // registration conversation (and docs/PRIVACY.md's rule) to happen.
    for (const required of [
      "users",
      "invites",
      "charities",
      "volunteer_signup",
      "worklist_item",
      "hunt-submissions",
      "survey_response",
      "analytics_event",
      "quarantine",
    ]) {
      expect(PII_STORE_IDS).toContain(required);
    }
    // AC-12: at least four identifier-backed find handlers.
    expect(PII_STORES.filter((s) => s.hasEmailIdentifier).length).toBeGreaterThanOrEqual(4);
  });
});

describe("the tripwire actually trips (added during run 2)", () => {
  // WHY THIS EXISTS. docs/FEEDBACK-GUARDRAIL claimed the coverage tests above
  // would fail "the moment the identifier lands" on feedback_response, and
  // that this was the mechanism forcing the privacy work to ship with the
  // feature. That was wrong, and it was checked: adding `email` to
  // FeedbackResponse and storing it left the whole suite green.
  //
  // The tests above verify that every REGISTERED store has handlers and that
  // the known-store list is complete. Neither can notice that a store's DATA
  // grew an identifier while its registration stayed identifier-free — which
  // is exactly the mistake worth catching, because it is the one that silently
  // makes docs/PRIVACY.md and the public notice untrue.
  //
  // So: any store whose stored shape carries an email must declare it.
  it("a store whose rows can carry an email declares hasEmailIdentifier", () => {
    // Keyed on the store id, so adding a contact field to one of these types
    // and forgetting the registration fails here rather than in production.
    const storesWithAnEmailField = ["users", "invites", "volunteer_signup", "feedback_response"];

    for (const id of storesWithAnEmailField) {
      const entry = PII_STORES.find((s) => s.store === id);
      expect(entry, `${id} must be registered`).toBeDefined();
      expect(entry?.hasEmailIdentifier, `${id} stores an email, so it must be searchable by one`).toBe(
        true,
      );
    }
  });

  it("feedback_response is no longer a no-identifier store", () => {
    // The specific regression this run could have shipped: contact fields on
    // the widget, and a registry still telling a requester there is no key to
    // search by.
    const entry = PII_STORES.find((s) => s.store === "feedback_response");
    expect(entry?.hasEmailIdentifier).toBe(true);
  });

});

describe("PII inventory handlers round-trip against real data", () => {
  let tdb: TestDb;
  const EMAIL = "requester@example.test";

  beforeAll(async () => {
    tdb = await createTestDb();
    await insertUser(
      { id: "u-req", email: EMAIL, name: "Req Uester", role: "viewer", orgId: null, passwordHash: "scrypt$a$b" },
      { actor: "admin", action: "profile-update", source: "admin" },
    );
    await insertInvite(
      {
        code: "inv-req",
        role: "viewer",
        orgId: null,
        newOrgName: null,
        newOrgKind: null,
        linkedIds: [],
        email: EMAIL,
        note: "for the requester",
        createdBy: "admin",
        expiresAt: new Date("2027-01-01T00:00:00Z"),
      } as never,
      { actor: "admin", action: "invite-mint", source: "admin" },
    );
    await saveCharity(
      { id: "char-req", name: "Requester's Cause", mission: "help", contactEmail: EMAIL },
      { actor: "admin", source: "admin" },
    );
    // A record this user authored, to prove the D-11 updated_by re-key.
    // Arbitrary un-schema'd store so writeRecord doesn't domain-validate it.
    await writeRecord("authored-probe", { id: "r-by-req", name: "Their Cafe" }, {
      actor: EMAIL,
      source: "portal",
    });
  });

  afterAll(async () => {
    await tdb.close();
  });

  function store(id: string) {
    return PII_STORES.find((s) => s.store === id)!;
  }

  it("access export finds the requester across identifier stores, never the password hash", async () => {
    const userExport = await store("users").exportRecords(EMAIL);
    expect(userExport.records).toHaveLength(1);
    expect(JSON.stringify(userExport.records)).not.toContain("scrypt");
    expect(JSON.stringify(userExport.records)).toContain(EMAIL);
    const inviteExport = await store("invites").exportRecords(EMAIL);
    expect(inviteExport.records).toHaveLength(1);
    // The invite's `code` is a live bearer redemption token — NEVER exported.
    expect(JSON.stringify(inviteExport.records)).not.toContain("inv-req");
    expect((await store("charities").exportRecords(EMAIL)).records).toHaveLength(1);
  });

  it("a legal hold on the account BLOCKS anonymize (FR-A92)", async () => {
    const { setLegalHold, clearLegalHold } = await import("@/lib/db/privacy-delete");
    const HOLD_EMAIL = "held-user@example.test";
    await insertUser(
      { id: "u-held", email: HOLD_EMAIL, name: "Held", role: "viewer", orgId: null, passwordHash: "scrypt$h$h" },
      { actor: "admin", action: "profile-update", source: "admin" },
    );
    await setLegalHold("users", "u-held", "litigation", "admin@example.test");
    const res = await store("users").deleteOrAnonymize(HOLD_EMAIL, "admin@example.test");
    expect(res.affected).toBe(0);
    expect(res.note).toMatch(/legal hold/i);
    // Still findable by email — the account was NOT anonymized.
    expect(await findUserByEmail(HOLD_EMAIL)).toBeDefined();
    // Clearing the hold lets it proceed.
    await clearLegalHold("users", "u-held", "admin@example.test");
    expect((await store("users").deleteOrAnonymize(HOLD_EMAIL, "admin@example.test")).affected).toBe(1);
    expect(await findUserByEmail(HOLD_EMAIL)).toBeUndefined();
  });

  it("feedback: finds, exports and hard-deletes by the address a visitor left", async () => {
    const entry = PII_STORES.find((s) => s.store === "feedback_response")!;
    const mine = "leaver@example.com";

    await appendFeedbackResponse({
      submittedAt: new Date().toISOString(),
      rating: 2,
      comment: "bay 14 is mislabelled",
      path: "/parking",
      name: "A Visitor",
      email: mine,
    });
    // Someone else's row, and one with no address at all. Neither may be
    // touched by a request naming `mine`.
    await appendFeedbackResponse({
      submittedAt: new Date().toISOString(),
      rating: 5,
      comment: "someone else's words",
      path: "/eat",
      email: "other@example.com",
    });
    await appendFeedbackResponse({
      submittedAt: new Date().toISOString(),
      rating: 3,
      comment: "anonymous, unreachable by any lookup",
      path: "/do",
    });

    expect(await entry.findByIdentifier(mine)).toHaveLength(1);

    const exported = await entry.exportRecords(mine);
    expect(exported.records).toHaveLength(1);
    expect(exported.records[0]).toMatchObject({ comment: "bay 14 is mislabelled", email: mine });
    // The note has to stay honest about what this lookup cannot reach.
    expect(exported.note).toMatch(/without an email/i);

    // Case-insensitive: the address is whatever a visitor typed.
    expect(await entry.findByIdentifier("LEAVER@EXAMPLE.COM")).toHaveLength(1);

    const deleted = await entry.deleteOrAnonymize(mine, "admin@test");
    expect(deleted.affected).toBe(1);
    expect(await entry.findByIdentifier(mine)).toHaveLength(0);
    // A hard delete, and only of the row that was asked about.
    expect(await entry.findByIdentifier("other@example.com")).toHaveLength(1);
  });

  it("feedback: a wildcard in the requested address matches literally, not everything", async () => {
    // `like` here instead of `=` would let a requester delete the whole table
    // with a single `%`. Guarding it in a test because the failure is silent
    // and total.
    const entry = PII_STORES.find((s) => s.store === "feedback_response")!;
    await appendFeedbackResponse({
      submittedAt: new Date().toISOString(),
      rating: 1,
      comment: "should survive a wildcard",
      path: "/map",
      email: "wildcard-probe@example.com",
    });

    expect(await entry.findByIdentifier("%")).toHaveLength(0);
    expect(await entry.findByIdentifier("%@example.com")).toHaveLength(0);
    expect((await entry.deleteOrAnonymize("%", "admin@test")).affected).toBe(0);
    expect(await entry.findByIdentifier("wildcard-probe@example.com")).toHaveLength(1);
  });

  it("no-identifier stores return an explanatory note, not silent nothing", async () => {
    const survey = await store("survey_response").exportRecords(EMAIL);
    expect(survey.records).toEqual([]);
    expect(survey.note).toMatch(/anonymous/i);
    const del = await store("analytics_event").deleteOrAnonymize(EMAIL, "admin");
    expect(del.affected).toBe(0);
    expect(del.note).toBeTruthy();
  });

  it("delete anonymizes the user, re-keys record authorship, and scrubs invites/charities (D-11)", async () => {
    const res = await store("users").deleteOrAnonymize(EMAIL, "admin@example.test");
    expect(res.affected).toBe(1);
    // The user is gone by email; the row survives under an opaque sentinel.
    expect(await findUserByEmail(EMAIL)).toBeUndefined();
    // D-11: the record they authored no longer references their email.
    const rows = await readRecordRows("authored-probe");
    const theirs = rows.find((r) => r.id === "r-by-req");
    expect(theirs?.updatedBy).toBe("u-req"); // opaque id, not the email
    expect(theirs?.updatedBy).not.toBe(EMAIL);

    // Invites + charities scrub their copy of the contact.
    await store("invites").deleteOrAnonymize(EMAIL, "admin");
    expect((await store("invites").findByIdentifier(EMAIL))).toHaveLength(0);
    await store("charities").deleteOrAnonymize(EMAIL, "admin");
    expect((await store("charities").findByIdentifier(EMAIL))).toHaveLength(0);
  });
});

describe("charity delete does NOT re-immortalize the contact email (metadata-only)", () => {
  it("the scrub audit row carries field names only, never the erased email", async () => {
    const fresh = await createTestDb();
    try {
      const { audit } = await import("@/lib/db/schema");
      const CE = "charity-contact@example.test";
      await saveCharity(
        { id: "c-leak", name: "Leaky Cause", mission: "help", contactEmail: CE },
        { actor: "admin", source: "admin" },
      );
      const inv = PII_STORES.find((s) => s.store === "charities")!;
      const res = await inv.deleteOrAnonymize(CE, "admin@example.test");
      expect(res.affected).toBe(1);
      // Live record no longer carries the email…
      expect(await inv.findByIdentifier(CE)).toHaveLength(0);
      // …and the scrub wrote a metadata-only row (field NAMES, not the value).
      const rows = await fresh.db.select().from(audit);
      const scrub = rows.find((a) => a.action === "privacy-field-scrub");
      expect(scrub).toBeDefined();
      expect(JSON.stringify(scrub!.after ?? {})).toContain("contactEmail"); // the field name
      expect(JSON.stringify(scrub!.after ?? {})).not.toContain(CE); // NOT the value
      // No audit row created by the scrub holds the email in a before/after doc.
      const scrubRelated = rows.filter((a) => a.recordId === "c-leak" && a.action === "privacy-field-scrub");
      for (const r of scrubRelated) {
        const body = JSON.stringify(r.after ?? {}) + JSON.stringify(r.before ?? {});
        expect(body).not.toContain(CE);
      }
    } finally {
      await fresh.close();
    }
  });
});
