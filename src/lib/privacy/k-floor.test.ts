// E11: the k-floor helper — collapse semantics, ordering, totals.

import { describe, expect, it } from "vitest";

import { applyKFloor } from "./k-floor";

interface Row {
  key: string;
  count: number;
  sessions: number;
}

const collapse = (below: readonly Row[]): Row => ({
  key: "below-threshold",
  count: below.reduce((s, r) => s + r.count, 0),
  sessions: below.reduce((s, r) => s + r.sessions, 0),
});

const floor = (rows: Row[], k = 5) => applyKFloor(rows, k, (r) => r.sessions, collapse);

describe("applyKFloor", () => {
  it("collapses buckets below k into one row, appended last", () => {
    const rows: Row[] = [
      { key: "ferry-terminal", count: 40, sessions: 12 },
      { key: "marina", count: 9, sessions: 3 },
      { key: "village-green", count: 20, sessions: 8 },
      { key: "west-kingston", count: 2, sessions: 1 },
    ];
    const out = floor(rows);
    expect(out.map((r) => r.key)).toEqual(["ferry-terminal", "village-green", "below-threshold"]);
    // A bucket with 1 session is ABSENT from the output:
    expect(out.some((r) => r.key === "west-kingston")).toBe(false);
    expect(out.some((r) => r.key === "marina")).toBe(false);
  });

  it("preserves totals exactly", () => {
    const rows: Row[] = [
      { key: "a", count: 40, sessions: 12 },
      { key: "b", count: 9, sessions: 3 },
      { key: "c", count: 2, sessions: 1 },
    ];
    const out = floor(rows);
    const totalBefore = rows.reduce((s, r) => s + r.count, 0);
    const totalAfter = out.reduce((s, r) => s + r.count, 0);
    expect(totalAfter).toBe(totalBefore);
    expect(out.find((r) => r.key === "below-threshold")?.count).toBe(11);
  });

  it("keeps input order for surviving rows (stable)", () => {
    const rows: Row[] = [
      { key: "second", count: 5, sessions: 6 },
      { key: "first", count: 50, sessions: 20 },
      { key: "tiny", count: 1, sessions: 1 },
    ];
    expect(floor(rows).map((r) => r.key)).toEqual(["second", "first", "below-threshold"]);
  });

  it("emits no collapsed row when everything clears the floor", () => {
    const rows: Row[] = [
      { key: "a", count: 40, sessions: 12 },
      { key: "b", count: 20, sessions: 5 },
    ];
    const out = floor(rows);
    expect(out).toHaveLength(2);
    expect(out.some((r) => r.key === "below-threshold")).toBe(false);
  });

  it("handles empty input", () => {
    expect(floor([])).toEqual([]);
  });

  it("boundary: exactly k sessions survives; k-1 collapses", () => {
    const rows: Row[] = [
      { key: "at-floor", count: 10, sessions: 5 },
      { key: "under-floor", count: 10, sessions: 4 },
    ];
    const out = floor(rows);
    expect(out.map((r) => r.key)).toEqual(["at-floor", "below-threshold"]);
  });
});
