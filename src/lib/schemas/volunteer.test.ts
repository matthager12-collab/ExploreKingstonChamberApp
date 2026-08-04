// E20 schema invariants — the PII floor as executable shape (charter step 4).

import { describe, expect, it } from "vitest";

import { volunteerNeeds as needSeeds } from "@/lib/data/charities";
import {
  deriveContactKind,
  START_TIME_RE,
  volunteerCheckinSchema,
  volunteerManageActionSchema,
  volunteerNeedSchema,
  volunteerSignupInputSchema,
} from "./volunteer";

const GOOD = { shiftId: "shift-1", name: "Neighbor Nancy", contact: "nancy@example.com" };

describe("volunteerSignupInputSchema — the PII floor", () => {
  it("accepts exactly the three named keys", () => {
    const parsed = volunteerSignupInputSchema.safeParse(GOOD);
    expect(parsed.success).toBe(true);
  });

  it.each([
    ["idempotencyKey", { ...GOOD, idempotencyKey: "abc-123" }], // header-only, never body
    ["address", { ...GOOD, address: "123 Main St" }],
    ["dob", { ...GOOD, dob: "1990-01-01" }],
    ["lat", { ...GOOD, lat: 47.79 }],
    ["lng", { ...GOOD, lng: -122.49 }],
    ["email+phone together", { ...GOOD, email: "a@b.co", phone: "360-555-0100" }],
    ["password", { ...GOOD, password: "hunter2" }],
  ])("rejects a body carrying %s", (_label, body) => {
    expect(volunteerSignupInputSchema.safeParse(body).success).toBe(false);
  });

  it("rejects empty name, empty contact, over-cap lengths", () => {
    expect(volunteerSignupInputSchema.safeParse({ ...GOOD, name: "  " }).success).toBe(false);
    expect(volunteerSignupInputSchema.safeParse({ ...GOOD, contact: "ab" }).success).toBe(false);
    expect(
      volunteerSignupInputSchema.safeParse({ ...GOOD, name: "x".repeat(101) }).success,
    ).toBe(false);
    expect(
      volunteerSignupInputSchema.safeParse({ ...GOOD, contact: `${"x".repeat(200)}@a.io` })
        .success,
    ).toBe(false);
  });
});

describe("deriveContactKind", () => {
  it("classifies emails, phones, and garbage", () => {
    expect(deriveContactKind("nancy@example.com")).toBe("email");
    expect(deriveContactKind("(360) 297-5886")).toBe("phone");
    expect(deriveContactKind("360.555.0100")).toBe("phone");
    expect(deriveContactKind("not-a-contact")).toBeNull();
    expect(deriveContactKind("@@")).toBeNull();
    expect(deriveContactKind("12345")).toBeNull(); // too short for a phone
  });
});

describe("action schemas", () => {
  const UUID = "3b241101-e2bb-4255-8caf-4136c566a962";
  it("manage: uuid + token + a known action, nothing extra", () => {
    expect(
      volunteerManageActionSchema.safeParse({ signupId: UUID, token: "t", action: "cancel" })
        .success,
    ).toBe(true);
    expect(
      volunteerManageActionSchema.safeParse({ signupId: "nope", token: "t", action: "cancel" })
        .success,
    ).toBe(false);
    expect(
      volunteerManageActionSchema.safeParse({
        signupId: UUID,
        token: "t",
        action: "checkin", // not a manage action
      }).success,
    ).toBe(false);
    expect(
      volunteerManageActionSchema.safeParse({
        signupId: UUID,
        token: "t",
        action: "cancel",
        extra: 1,
      }).success,
    ).toBe(false);
  });

  it("checkin: token optional (session callers), still strict", () => {
    expect(volunteerCheckinSchema.safeParse({ signupId: UUID }).success).toBe(true);
    expect(volunteerCheckinSchema.safeParse({ signupId: UUID, token: "t" }).success).toBe(true);
    expect(
      volunteerCheckinSchema.safeParse({ signupId: UUID, name: "sneaky" }).success,
    ).toBe(false);
  });
});

describe("volunteerNeedSchema", () => {
  it("validates every checked-in seed record as-is", () => {
    for (const seed of needSeeds) {
      const parsed = volunteerNeedSchema.safeParse(seed);
      expect(parsed.success, `seed ${seed.id}`).toBe(true);
    }
  });

  it("accepts both real-world date shapes and the optional startTime", () => {
    const base = {
      id: "n-1",
      charityId: "c-1",
      title: "Trail day",
      timeRange: "9:00 AM – 1:00 PM",
      slotsTotal: 10,
      slotsFilled: 0,
      description: "",
    };
    expect(
      volunteerNeedSchema.safeParse({ ...base, date: "2026-09-12T09:00:00-07:00" }).success,
    ).toBe(true);
    expect(volunteerNeedSchema.safeParse({ ...base, date: "2026-09-12" }).success).toBe(true);
    expect(volunteerNeedSchema.safeParse({ ...base, date: "not a date" }).success).toBe(false);
    expect(
      volunteerNeedSchema.safeParse({ ...base, date: "2026-09-12", startTime: "09:00" })
        .success,
    ).toBe(true);
    expect(
      volunteerNeedSchema.safeParse({ ...base, date: "2026-09-12", startTime: "9am" }).success,
    ).toBe(false);
  });

  it("startTime regex is 24-hour wall time", () => {
    expect(START_TIME_RE.test("00:00")).toBe(true);
    expect(START_TIME_RE.test("23:59")).toBe(true);
    expect(START_TIME_RE.test("24:00")).toBe(false);
    expect(START_TIME_RE.test("7:30")).toBe(false); // zero-padded only
  });
});
