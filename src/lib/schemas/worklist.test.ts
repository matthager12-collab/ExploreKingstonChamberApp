// E08 worklist payload schemas: every type's valid fixture parses, the
// invalid shapes fail with plain-English messages, and the report-inaccurate
// schema keeps its PRIVACY INVARIANT (M-15-06): message + optional free-text
// contact, nothing else — no location fields, no required identity.

import { describe, expect, it } from "vitest";

import {
  claimRequestPayloadSchema,
  moderationPayloadSchema,
  privacyRequestPayloadSchema,
  reportInaccuratePayloadSchema,
  stalenessPayloadSchema,
  syncConflictPayloadSchema,
  validateWorklistPayload,
  WORKLIST_RESOLUTIONS,
  WORKLIST_STATES,
  WORKLIST_TYPES,
  WorklistValidationError,
} from "./worklist";

describe("moderation payload", () => {
  it("accepts new / edit / takedown kinds", () => {
    expect(moderationPayloadSchema.safeParse({ kind: "new" }).success).toBe(true);
    expect(
      moderationPayloadSchema.safeParse({ kind: "edit", proposed: { id: "cafe", name: "x" } })
        .success,
    ).toBe(true);
    expect(moderationPayloadSchema.safeParse({ kind: "takedown", note: "why" }).success).toBe(true);
  });

  it("an edit without the proposed record is rejected — the live record is never the fallback", () => {
    const parsed = moderationPayloadSchema.safeParse({ kind: "edit" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toBe(
        "an edit needs the proposed record in the payload",
      );
    }
  });

  it("rejects unknown kinds and a proposed record without an id", () => {
    expect(moderationPayloadSchema.safeParse({ kind: "publish" }).success).toBe(false);
    expect(
      moderationPayloadSchema.safeParse({ kind: "edit", proposed: { name: "no id" } }).success,
    ).toBe(false);
  });
});

describe("sync_conflict payload (E16 fixture shape)", () => {
  it("accepts a field-level conflict", () => {
    expect(
      syncConflictPayloadSchema.safeParse({
        fields: [{ name: "phone", localValue: "a", remoteValue: "b" }],
        remoteFetchedAt: "2026-07-19T10:00:00Z",
      }).success,
    ).toBe(true);
  });

  it("rejects an empty field list and a bad timestamp", () => {
    expect(
      syncConflictPayloadSchema.safeParse({ fields: [], remoteFetchedAt: "2026-07-19T10:00:00Z" })
        .success,
    ).toBe(false);
    expect(
      syncConflictPayloadSchema.safeParse({
        fields: [{ name: "phone", localValue: "a", remoteValue: "b" }],
        remoteFetchedAt: "yesterday",
      }).success,
    ).toBe(false);
  });
});

describe("staleness payload", () => {
  it("accepts never-verified (null) and verified-with-interval", () => {
    expect(
      stalenessPayloadSchema.safeParse({ lastVerifiedAt: null, intervalDays: 90 }).success,
    ).toBe(true);
    expect(
      stalenessPayloadSchema.safeParse({
        lastVerifiedAt: "2026-01-01T00:00:00Z",
        intervalDays: 180,
      }).success,
    ).toBe(true);
  });

  it("rejects zero/negative/fractional intervals", () => {
    for (const bad of [0, -30, 1.5]) {
      expect(
        stalenessPayloadSchema.safeParse({ lastVerifiedAt: null, intervalDays: bad }).success,
      ).toBe(false);
    }
  });
});

describe("report_inaccurate payload — privacy invariant (M-15-06)", () => {
  it("accepts a message with NO contact — identity is never required", () => {
    expect(
      reportInaccuratePayloadSchema.safeParse({
        messages: [{ message: "hours wrong", at: "2026-07-19T10:00:00Z" }],
        count: 1,
      }).success,
    ).toBe(true);
  });

  it("caps message at 2000 and contact at 200 chars", () => {
    expect(
      reportInaccuratePayloadSchema.safeParse({
        messages: [{ message: "a".repeat(2001), at: "2026-07-19T10:00:00Z" }],
        count: 1,
      }).success,
    ).toBe(false);
    expect(
      reportInaccuratePayloadSchema.safeParse({
        messages: [
          { message: "ok", contact: "c".repeat(201), at: "2026-07-19T10:00:00Z" },
        ],
        count: 1,
      }).success,
    ).toBe(false);
  });

  it("INVARIANT: the schema has exactly messages+count, message entries have exactly message/contact/at, and strip mode drops smuggled location fields", () => {
    // Shape introspection: adding lat/lng or a required email to this schema
    // must break this test — that is the point (Never tier).
    expect(Object.keys(reportInaccuratePayloadSchema.shape).sort()).toEqual(["count", "messages"]);
    const entryShape =
      reportInaccuratePayloadSchema.shape.messages.element.shape;
    expect(Object.keys(entryShape).sort()).toEqual(["at", "contact", "message"]);
    for (const key of Object.keys(entryShape)) {
      expect(["lat", "lng", "latitude", "longitude", "email"]).not.toContain(key);
    }

    // Strip mode: a client smuggling location data gets it silently dropped.
    const parsed = reportInaccuratePayloadSchema.parse({
      messages: [{ message: "x", at: "2026-07-19T10:00:00Z", lat: 47.79, lng: -122.49 }],
      count: 1,
      lat: 47.79,
    });
    expect(JSON.stringify(parsed)).not.toContain("47.79");
  });
});

describe("privacy_request payload (E11 fixture shape)", () => {
  it("accepts access and delete kinds; contact IS required here (no account to reply through)", () => {
    expect(
      privacyRequestPayloadSchema.safeParse({ requestKind: "access", contact: "a@b.test" })
        .success,
    ).toBe(true);
    expect(
      privacyRequestPayloadSchema.safeParse({
        requestKind: "delete",
        contact: "a@b.test",
        scopeNote: "everything about my visit",
      }).success,
    ).toBe(true);
    expect(privacyRequestPayloadSchema.safeParse({ requestKind: "access" }).success).toBe(false);
    expect(
      privacyRequestPayloadSchema.safeParse({ requestKind: "forget-me", contact: "a@b.test" })
        .success,
    ).toBe(false);
  });
});

describe("validateWorklistPayload + vocabularies", () => {
  it("throws WorklistValidationError with the type and joined issues", () => {
    expect(() => validateWorklistPayload("moderation", { kind: "edit" })).toThrow(
      WorklistValidationError,
    );
    try {
      validateWorklistPayload("moderation", { kind: "edit" });
    } catch (err) {
      expect((err as WorklistValidationError).message).toContain("moderation");
      expect((err as WorklistValidationError).message).toContain("proposed");
    }
  });

  it("every type has a resolution vocabulary and the closed lists match the spec", () => {
    for (const t of WORKLIST_TYPES) {
      expect(WORKLIST_RESOLUTIONS[t].length).toBeGreaterThan(0);
    }
    expect(WORKLIST_RESOLUTIONS.moderation).toEqual(["approved", "rejected", "taken_down"]);
    expect(WORKLIST_RESOLUTIONS.staleness).toEqual(["verified", "archived"]);
    expect(WORKLIST_RESOLUTIONS.report_inaccurate).toEqual(["fixed", "dismissed"]);
    expect(WORKLIST_RESOLUTIONS.claim_request).toEqual(["invited", "rejected", "duplicate"]);
  });

  it("claim_request payload (E17): name + one contact, message capped, count ≥ 1 — and no location fields ever", () => {
    const valid = {
      store: "restaurants",
      id: "jaime-les-crepes",
      contactName: "Pat Owner",
      contact: "360-555-0100",
      count: 1,
    };
    expect(() => validateWorklistPayload("claim_request", valid)).not.toThrow();
    expect(() => validateWorklistPayload("claim_request", { ...valid, contact: "" })).toThrow(
      /a way to reach you/,
    );
    expect(() =>
      validateWorklistPayload("claim_request", { ...valid, message: "x".repeat(1001) }),
    ).toThrow();
    expect(() => validateWorklistPayload("claim_request", { ...valid, count: 0 })).toThrow();
    // Data-minimization floor: the shape must never grow location fields.
    const shape = claimRequestPayloadSchema.shape;
    expect(Object.keys(shape)).toEqual([
      "store",
      "id",
      "businessName",
      "contactName",
      "contact",
      "message",
      "count",
    ]);
  });

  it("type and state vocabularies are the six/four the DB CHECKs mirror", () => {
    expect([...WORKLIST_TYPES]).toEqual([
      "moderation",
      "sync_conflict",
      "staleness",
      "report_inaccurate",
      "privacy_request",
      // E17: claim_request joined in migration 0008 (CHECK extended there).
      "claim_request",
    ]);
    expect([...WORKLIST_STATES]).toEqual(["open", "in_progress", "resolved", "dismissed"]);
  });
});
