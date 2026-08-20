// The pure seed-vs-overlay comparison. No DB — these are the rules that decide
// whether a save is worth writing at all.

import { describe, expect, it } from "vitest";
import { isSeedNoop, sameDoc } from "./seed-overlay";

const SEED = [
  { id: "a", title: "Rainy Day", stops: [{ t: "1", label: "one" }, { t: "2", label: "two" }] },
  { id: "b", title: "Other" },
];

describe("sameDoc", () => {
  it("ignores key order — the seed literal, a zod parse and a JSONB row all differ", () => {
    expect(sameDoc({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameDoc({ x: { p: 1, q: 2 } }, { x: { q: 2, p: 1 } })).toBe(true);
  });

  it("treats an explicit undefined as absent, because JSONB drops it", () => {
    expect(sameDoc({ a: 1, note: undefined }, { a: 1 })).toBe(true);
  });

  it("does NOT ignore array order — itinerary stop order is content", () => {
    expect(sameDoc({ s: [1, 2] }, { s: [2, 1] })).toBe(false);
  });

  it("still catches real differences, including nested and whitespace-only ones", () => {
    expect(sameDoc({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameDoc({ x: { p: 1 } }, { x: { p: 1, q: 1 } })).toBe(false);
    expect(sameDoc({ t: "Kingston" }, { t: "Kingston " })).toBe(false);
    expect(sameDoc({ a: 1 }, { a: "1" })).toBe(false);
    expect(sameDoc({ a: null }, {})).toBe(false);
  });
});

describe("isSeedNoop", () => {
  it("is true for a record byte-identical to its seed twin", () => {
    expect(isSeedNoop(SEED, { ...SEED[0] })).toBe(true);
  });

  it("is true when only key order differs (the no-op save signature)", () => {
    const reordered = { stops: SEED[0].stops, title: "Rainy Day", id: "a" };
    expect(isSeedNoop(SEED, reordered as (typeof SEED)[number])).toBe(true);
  });

  it("is false for a real edit", () => {
    expect(isSeedNoop(SEED, { ...SEED[0], title: "Rainy Day Redux" })).toBe(false);
  });

  it("is false for a record with no seed twin — nothing to fall back to", () => {
    expect(isSeedNoop(SEED, { id: "brand-new", title: "New" } as (typeof SEED)[number])).toBe(
      false,
    );
  });

  it("is false for a tombstone — hiding a seed record is a real decision", () => {
    expect(isSeedNoop(SEED, { ...SEED[0], _deleted: true })).toBe(false);
  });

  it("is false for null/undefined input", () => {
    expect(isSeedNoop(SEED, null)).toBe(false);
    expect(isSeedNoop(SEED, undefined)).toBe(false);
  });
});
