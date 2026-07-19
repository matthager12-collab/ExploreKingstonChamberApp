// Shared schema helpers: coercion parity with the old hand-written
// sanitizers (E07). Every message asserted here is operator-facing — the
// admin UI shows it verbatim, so wording changes are behavior changes.

import { describe, expect, it } from "vitest";
import {
  firstZodMessage,
  idSchema,
  isoDateSchema,
  numberInRange,
  optionalTrimmed,
  parseWeeklyHours,
  requiredTrimmed,
  roundedInt,
  slugSchema,
  tagsSchema,
  weeklyHoursSchema,
} from "./shared";

function firstError(result: { success: boolean; error?: unknown }): string {
  expect(result.success).toBe(false);
  return firstZodMessage((result as { error: Parameters<typeof firstZodMessage>[0] }).error);
}

describe("idSchema / slugSchema", () => {
  it("accepts ids case-insensitively but slugs lowercase-only", () => {
    expect(idSchema.safeParse("Point-Casino").success).toBe(true);
    expect(slugSchema.parse("Beach-Day")).toBe("beach-day"); // lowercased on the way in
  });

  it("rejects with the exact friendly messages", () => {
    expect(firstError(idSchema.safeParse("-bad"))).toBe(
      "id required: letters, numbers, and dashes (max 64 chars)",
    );
    expect(firstError(idSchema.safeParse(""))).toBe(
      "id required: letters, numbers, and dashes (max 64 chars)",
    );
    expect(firstError(slugSchema.safeParse("no spaces"))).toBe(
      "slug required: lowercase letters, numbers, and dashes (e.g. beach-day)",
    );
  });

  it("rejects ids over 64 chars", () => {
    expect(idSchema.safeParse("a".repeat(64)).success).toBe(true);
    expect(idSchema.safeParse("a".repeat(65)).success).toBe(false);
  });
});

describe("text helpers", () => {
  it("requiredTrimmed trims and rejects empty with `<label> required`", () => {
    expect(requiredTrimmed("name").parse("  Grub Hut  ")).toBe("Grub Hut");
    expect(firstError(requiredTrimmed("name").safeParse("   "))).toBe("name required");
    expect(firstError(requiredTrimmed("name").safeParse(42))).toBe("name required");
  });

  it("optionalTrimmed turns empty/non-string into undefined", () => {
    expect(optionalTrimmed().parse("  hi ")).toBe("hi");
    expect(optionalTrimmed().parse("")).toBeUndefined();
    expect(optionalTrimmed().parse("   ")).toBeUndefined();
    expect(optionalTrimmed().parse(undefined)).toBeUndefined();
    expect(optionalTrimmed().parse(42)).toBeUndefined();
  });
});

describe("tagsSchema (strArray parity)", () => {
  it("coerces a non-array to [] instead of erroring", () => {
    expect(tagsSchema.parse("not-an-array")).toEqual([]);
    expect(tagsSchema.parse(undefined)).toEqual([]);
    expect(tagsSchema.parse({})).toEqual([]);
  });

  it("drops non-strings, trims, and drops empties", () => {
    expect(tagsSchema.parse([" a ", 42, "", null, "b"])).toEqual(["a", "b"]);
  });
});

describe("numeric helpers", () => {
  it("roundedInt accepts numeric strings and rounds", () => {
    expect(roundedInt(0, 120, "walk minutes").parse("5.4")).toBe(5);
    expect(roundedInt(15, 3600, "refreshSeconds").parse(60)).toBe(60);
  });

  it("roundedInt bounds carry the exact message", () => {
    const s = roundedInt(15, 3600, "refreshSeconds");
    expect(firstError(s.safeParse(14))).toBe(
      "refreshSeconds must be a number between 15 and 3600",
    );
    expect(firstError(s.safeParse(3601))).toBe(
      "refreshSeconds must be a number between 15 and 3600",
    );
    expect(firstError(s.safeParse("abc"))).toBe(
      "refreshSeconds must be a number between 15 and 3600",
    );
    expect(firstError(s.safeParse(undefined))).toBe(
      "refreshSeconds must be a number between 15 and 3600",
    );
  });

  it("numberInRange keeps decimals and carries the exact message", () => {
    const s = numberInRange("lat", -90, 90);
    expect(s.parse(47.7973)).toBe(47.7973);
    expect(s.parse("47.7973")).toBe(47.7973);
    expect(firstError(s.safeParse(91))).toBe("lat must be between -90 and 90");
    expect(firstError(s.safeParse(Infinity))).toBe("lat must be between -90 and 90");
  });
});

describe("weekly hours", () => {
  const good = {
    mon: [["11:00", "20:00"]],
    tue: [],
    wed: [["11:00", "14:00"], ["17:00", "21:00"]],
    thu: [],
    fri: [],
    sat: [],
    sun: [["09:00", "02:00"]], // closes past midnight — allowed
  };

  it("parseWeeklyHours accepts the strict shape and rebuilds from day keys only", () => {
    expect(parseWeeklyHours(good)).toEqual(good);
    expect(parseWeeklyHours({ ...good, extra: "dropped" })).toEqual(good);
  });

  it("parseWeeklyHours rejects malformed shapes", () => {
    expect(parseWeeklyHours(null)).toBeNull();
    expect(parseWeeklyHours({ ...good, mon: [["11:00", "11:00"]] })).toBeNull(); // open == close
    expect(parseWeeklyHours({ ...good, mon: [["25:00", "20:00"]] })).toBeNull(); // bad time
    expect(
      parseWeeklyHours({ ...good, mon: [["01:00", "02:00"], ["03:00", "04:00"], ["05:00", "06:00"]] }),
    ).toBeNull(); // >2 spans
    const missingDay: Record<string, unknown> = { ...good };
    delete missingDay.sun;
    expect(parseWeeklyHours(missingDay)).toBeNull();
  });

  it("weeklyHoursSchema reports `weeklyHours is malformed`", () => {
    expect(weeklyHoursSchema.safeParse(good).success).toBe(true);
    expect(firstError(weeklyHoursSchema.safeParse({ ...good, mon: [["11:00", "11:00"]] }))).toBe(
      "weeklyHours is malformed",
    );
  });
});

describe("isoDateSchema", () => {
  it("accepts YYYY-MM-DD and rejects everything else", () => {
    expect(isoDateSchema.safeParse("2026-07-19").success).toBe(true);
    expect(isoDateSchema.safeParse("07/19/2026").success).toBe(false);
    expect(isoDateSchema.safeParse("2026-7-19").success).toBe(false);
  });
});
