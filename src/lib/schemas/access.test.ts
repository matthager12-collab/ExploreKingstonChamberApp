// E27 — access facts: the honesty rules, as tests.
//
// The failure mode being guarded is not a crash. It is a venue that appears
// more accessible than anyone actually verified, because "no data" got
// rendered as a positive answer somewhere along the way. Someone plans a trip
// around a step-free entrance that does not exist.
//
// So the rules under test are:
//   - absent input means "unknown", never "yes"
//   - a record where nothing has been checked yields NO access block at all,
//     rather than a row of "Not checked" that reads like a verdict
//   - the schema is the single declaration (E07): the same shape validates the
//     admin form and the API route, with no second sanitizer

import { describe, expect, it } from "vitest";
import { lodgingSchema } from "./lodging";
import { restaurantSchema } from "./restaurant";
import {
  ACCESS_ANSWERS,
  accessFactsFields,
  hasAnyAccessFact,
  readAccessFacts,
} from "./access";

const baseLodging = {
  id: "test-inn",
  name: "Test Inn",
  type: "hotel",
  description: "A place.",
  tags: "",
};

describe("access facts schema", () => {
  it("defaults a blank answer to 'unknown', never to a positive claim", () => {
    const parsed = lodgingSchema.parse({ ...baseLodging, stepFreeEntrance: "" });
    expect(parsed.stepFreeEntrance).toBe("unknown");
  });

  it("omits answers that were never supplied", () => {
    const parsed = lodgingSchema.parse(baseLodging);
    expect(parsed.stepFreeEntrance).toBeUndefined();
  });

  it("accepts every documented answer", () => {
    for (const a of ACCESS_ANSWERS) {
      const parsed = lodgingSchema.parse({ ...baseLodging, accessibleRestroom: a });
      expect(parsed.accessibleRestroom).toBe(a);
    }
  });

  it("rejects an answer outside the vocabulary", () => {
    const res = lodgingSchema.safeParse({ ...baseLodging, stepFreeEntrance: "probably?" });
    expect(res.success).toBe(false);
  });

  it("rejects a malformed verification date", () => {
    const res = lodgingSchema.safeParse({ ...baseLodging, accessVerifiedOn: "July 2026" });
    expect(res.success).toBe(false);
  });

  it("is declared on the restaurant domain too", () => {
    const parsed = restaurantSchema.parse({
      id: "test-cafe",
      name: "Test Cafe",
      cuisine: "Cafe",
      description: "Coffee.",
      address: "1 Main St",
      priceLevel: 1,
      tags: "",
      lat: 47.7966,
      lng: -122.4958,
      walkMinutesFromFerry: 2,
      accessibleParking: "partial",
    });
    expect(parsed.accessibleParking).toBe("partial");
  });

  it("does NOT add a cost field to restaurants — they keep priceLevel", () => {
    // M-04-06 explicitly exempts restaurants: they are paid by nature, so the
    // free-vs-paid axis would be noise next to the $ price level.
    const parsed = restaurantSchema.parse({
      id: "test-cafe",
      name: "Test Cafe",
      cuisine: "Cafe",
      description: "Coffee.",
      address: "1 Main St",
      priceLevel: 2,
      tags: "",
      lat: 47.7966,
      lng: -122.4958,
      walkMinutesFromFerry: 2,
      cost: "free",
    });
    expect((parsed as Record<string, unknown>).cost).toBeUndefined();
    expect(parsed.priceLevel).toBe(2);
  });

  it("exposes every field to the E07 form engine, so the Chamber can edit them", () => {
    // If a field exists in the schema but not here, it is silently uneditable —
    // which is how "verified access facts" quietly becomes a dead field.
    const keys = accessFactsFields.map((f) => f.key);
    for (const k of [
      "stepFreeEntrance",
      "accessibleRestroom",
      "accessibleParking",
      "accessNotes",
      "accessVerifiedOn",
    ]) {
      expect(keys).toContain(k);
    }
  });
});

describe("readAccessFacts", () => {
  it("returns null when nothing has been checked — render no block at all", () => {
    expect(readAccessFacts({ id: "x" })).toBeNull();
    expect(
      readAccessFacts({ stepFreeEntrance: "unknown", accessibleRestroom: "unknown" }),
      "all-unknown must not render as a verdict",
    ).toBeNull();
  });

  it("returns facts once any real answer exists", () => {
    const facts = readAccessFacts({ stepFreeEntrance: "yes", accessibleRestroom: "unknown" });
    expect(facts).not.toBeNull();
    expect(facts!.stepFreeEntrance).toBe("yes");
  });

  it("treats a plain note as worth showing", () => {
    expect(readAccessFacts({ accessNotes: "Ramp at the side door." })).not.toBeNull();
  });

  it("counts 'no' as a real, useful answer", () => {
    // "No" is information a wheelchair user needs BEFORE they travel — it must
    // never be filtered out as if it were missing data.
    expect(hasAnyAccessFact({ stepFreeEntrance: "no" })).toBe(true);
  });

  it("ignores junk input rather than throwing", () => {
    expect(readAccessFacts(null)).toBeNull();
    expect(readAccessFacts("nope")).toBeNull();
    expect(readAccessFacts({ stepFreeEntrance: 42 })).toBeNull();
  });
});
