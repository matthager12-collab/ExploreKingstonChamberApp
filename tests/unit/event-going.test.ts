// "I'm going" tallies. Two things are worth pinning: the ZIP validator (pure,
// and the only thing standing between the LTAC column and unusable values),
// and that the store COUNTS rather than logs — the property the whole privacy
// posture rests on.

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { count } from "drizzle-orm";

import { eventGoing } from "@/lib/db/schema";
import {
  getGoingByZip,
  getGoingCounts,
  normalizeZip,
  recordGoing,
} from "@/lib/stores/event-going-store";
import { createTestDb, type TestDb } from "../setup/pglite-db";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

describe("normalizeZip", () => {
  it("keeps a five-digit ZIP", () => {
    expect(normalizeZip("98346")).toBe("98346");
    expect(normalizeZip("  98346  ")).toBe("98346");
  });

  it('turns anything else into "they did not say"', () => {
    // Deliberately not "best effort": a half-typed ZIP in the LTAC column is
    // a number nobody can interpret, which is worse than a blank.
    expect(normalizeZip("983")).toBe("");
    expect(normalizeZip("9834X")).toBe("");
    expect(normalizeZip("")).toBe("");
    expect(normalizeZip(undefined)).toBe("");
    expect(normalizeZip(12345)).toBe("");
  });

  it("does not silently truncate a longer number into a valid-looking ZIP", () => {
    // "983461234" sliced to 5 reads as a real Kingston ZIP the visitor never
    // typed — the kind of wrong that looks right in a report. Refused whole.
    expect(normalizeZip("983461234")).toBe("");
  });

  it("accepts ZIP+4 and keeps only the five", () => {
    // A pasted ZIP+4 is a person answering the question; the last four are
    // finer than anything here needs.
    expect(normalizeZip("98346-1234")).toBe("98346");
  });
});

describe("the store counts, it does not log", () => {
  it("a second tap from the same ZIP increments rather than adding a row", async () => {
    await recordGoing("market", "98346");
    const total = await recordGoing("market", "98346");
    expect(total).toBe(2);

    const [{ n }] = await tdb.db.select({ n: count() }).from(eventGoing);
    expect(n).toBe(1); // one tally, not two taps
  });

  it("separate ZIPs are separate tallies, and the total is their sum", async () => {
    await recordGoing("market", "98110");
    expect((await getGoingCounts(["market"])).market).toBe(3);
    expect(await getGoingByZip("market")).toEqual([
      { zip: "98346", count: 2 },
      { zip: "98110", count: 1 },
    ]);
  });

  it('an unanswered ZIP still counts, under ""', async () => {
    // Dropping these would overstate how much origin data the Chamber has.
    await recordGoing("market", "");
    const byZip = await getGoingByZip("market");
    expect(byZip.find((r) => r.zip === "")).toEqual({ zip: "", count: 1 });
    expect(byZip.reduce((sum, r) => sum + r.count, 0)).toBe(4);
  });

  it("an event nobody tapped is absent, not zero", async () => {
    // "No one yet" must not render as a measured zero.
    expect(await getGoingCounts(["never-tapped"])).toEqual({});
  });

  it("asking about no events costs no query", async () => {
    expect(await getGoingCounts([])).toEqual({});
  });
});
