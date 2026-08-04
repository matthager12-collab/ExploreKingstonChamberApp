// E20 — purpose-scoped HMAC action tokens + the shift-start-instant parser,
// tested against the REAL seed timeRange strings (charter step 2).

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { volunteerNeeds as needSeeds } from "@/lib/data/charities";
import {
  manageUrl,
  parseLeadingTime,
  shiftStartInstant,
  signupActionToken,
  verifySignupActionToken,
} from "@/lib/volunteer-links";

const SIGNUP_ID = "3b241101-e2bb-4255-8caf-4136c566a962";

beforeEach(() => {
  process.env.VOLUNTEER_LINK_SECRET = "vitest-volunteer-secret";
});
afterEach(() => {
  delete process.env.VOLUNTEER_LINK_SECRET;
});

describe("signup action tokens", () => {
  it("round-trips per purpose and never across purposes", () => {
    for (const purpose of ["cancel", "confirm", "checkin"] as const) {
      const token = signupActionToken(SIGNUP_ID, purpose);
      expect(verifySignupActionToken(SIGNUP_ID, purpose, token)).toBe(true);
    }
    const cancel = signupActionToken(SIGNUP_ID, "cancel");
    expect(verifySignupActionToken(SIGNUP_ID, "checkin", cancel)).toBe(false);
    expect(verifySignupActionToken(SIGNUP_ID, "confirm", cancel)).toBe(false);
  });

  it("rejects tampered tokens and foreign signup ids", () => {
    const token = signupActionToken(SIGNUP_ID, "cancel");
    expect(verifySignupActionToken(SIGNUP_ID, "cancel", token.slice(0, -2) + "xx")).toBe(false);
    expect(verifySignupActionToken(SIGNUP_ID, "cancel", "")).toBe(false);
    expect(
      verifySignupActionToken("00000000-0000-4000-8000-000000000000", "cancel", token),
    ).toBe(false);
  });

  it("manageUrl is absolute and carries the cancel-purpose token", () => {
    const url = manageUrl(SIGNUP_ID);
    expect(url).toMatch(/^https?:\/\//);
    expect(url).toContain(`/volunteer/manage/${SIGNUP_ID}?t=`);
    const token = new URL(url).searchParams.get("t")!;
    expect(verifySignupActionToken(SIGNUP_ID, "cancel", token)).toBe(true);
  });
});

describe("parseLeadingTime", () => {
  it("parses every seed timeRange (they all carry an explicit meridiem)", () => {
    for (const seed of needSeeds) {
      expect(parseLeadingTime(seed.timeRange), `seed ${seed.id}: "${seed.timeRange}"`).toMatch(
        /^([01]\d|2[0-3]):[0-5]\d$/,
      );
    }
  });

  it("handles the 12-o'clock edges and refuses ambiguity", () => {
    expect(parseLeadingTime("9:00 AM – 1:00 PM")).toBe("09:00");
    expect(parseLeadingTime("12:00 PM – 2:00 PM")).toBe("12:00");
    expect(parseLeadingTime("12:30 AM shift")).toBe("00:30");
    expect(parseLeadingTime("7 PM onward")).toBe("19:00");
    // No meridiem = ambiguous (10 at night?) — null, never a guess.
    expect(parseLeadingTime("10:00–2:00")).toBeNull();
    expect(parseLeadingTime("all day")).toBeNull();
    expect(parseLeadingTime("")).toBeNull();
  });
});

describe("shiftStartInstant", () => {
  const base = { timeRange: "9:00 AM – 1:00 PM" };

  it("prefers explicit startTime over the parsed timeRange", () => {
    const iso = shiftStartInstant({ ...base, date: "2026-09-12", startTime: "07:30" });
    expect(iso).toBeTruthy();
    // 07:30 Pacific in September is PDT (UTC-7).
    expect(new Date(iso!).toISOString()).toBe("2026-09-12T14:30:00.000Z");
  });

  it("derives the day from Pacific wall time for BOTH real date shapes", () => {
    // Portal shape: bare date anchored at Pacific midnight.
    const portal = shiftStartInstant({ ...base, date: "2026-09-12" });
    expect(new Date(portal!).toISOString()).toBe("2026-09-12T16:00:00.000Z"); // 9 AM PDT
    // Seed shape: full instant anchored at the shift start.
    const seed = shiftStartInstant({ ...base, date: "2026-09-12T09:00:00-07:00" });
    expect(seed).toBe(portal);
  });

  it("returns null when no start is derivable — the no-T-2h-reminder path", () => {
    expect(shiftStartInstant({ date: "2026-09-12", timeRange: "10:00–2:00" })).toBeNull();
    expect(shiftStartInstant({ date: "garbage", timeRange: "9:00 AM – 1:00 PM" })).toBeNull();
  });
});
