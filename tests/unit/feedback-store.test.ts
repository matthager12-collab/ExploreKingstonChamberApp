// feedback-store summarize(): the numbers the Chamber's /admin/feedback page
// renders. Everything here is about not lying on that page — an average that
// silently counts a malformed row, or a distribution that drops one, turns a
// dashboard into a wrong dashboard, which is worse than an empty one.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { appendFeedbackResponse } from "@/lib/db/append";
import { feedbackStore } from "@/lib/feedback-store";
import type { FeedbackResponse } from "@/lib/types";
import { createTestDb, type TestDb } from "../setup/pglite-db";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

async function seed(rows: Partial<FeedbackResponse>[]) {
  for (const r of rows) {
    await appendFeedbackResponse({
      submittedAt: new Date().toISOString(),
      rating: 5,
      path: "/eat",
      ...r,
    });
  }
}

describe("feedbackStore.summarize", () => {
  it("reports null, not zero, for the average of an empty log", async () => {
    const summary = await feedbackStore.summarize();
    expect(summary.total).toBe(0);
    // 0 would render as a real, terrible score on a site nobody has rated yet.
    expect(summary.averageRating).toBeNull();
  });

  it("renders a full five-star axis even when most buckets are empty", async () => {
    await seed([{ rating: 5 }]);
    const summary = await feedbackStore.summarize();
    // All five keys present, so the distribution bars don't collapse to one row.
    expect(Object.keys(summary.byRating).sort()).toEqual(["1", "2", "3", "4", "5"]);
    expect(summary.byRating[5]).toBe(1);
    expect(summary.byRating[1]).toBe(0);
  });

  it("averages, counts comments, and groups by source page", async () => {
    await seed([
      { rating: 1, path: "/parking", comment: "no spaces marked" },
      { rating: 3, path: "/parking" },
      { rating: 5, path: "/ferry", comment: "great board" },
    ]);
    const summary = await feedbackStore.summarize();

    // 5 (previous case) + 1 + 3 + 5 = 14 over 4 rows = 3.5
    expect(summary.total).toBe(4);
    expect(summary.averageRating).toBe(3.5);
    expect(summary.withComment).toBe(2);

    const parking = summary.byPath.find((p) => p.path === "/parking")!;
    expect(parking.count).toBe(2);
    expect(parking.averageRating).toBe(2);
    // Busiest page first — the ordering the admin table depends on.
    expect(summary.byPath[0].path).toBe("/parking");
  });

  it("counts a malformed row in the total but keeps it out of the average and distribution", async () => {
    // A row is whatever some past version of the route wrote into the JSONB
    // column. A rating of 9 must not become a ninth bar or drag the mean —
    // but it did happen, so hiding it from the total would be its own lie.
    const before = await feedbackStore.summarize();
    await seed([{ rating: 9 }]);
    const after = await feedbackStore.summarize();

    expect(after.total).toBe(before.total + 1);
    expect(after.averageRating).toBe(before.averageRating);
    expect(Object.keys(after.byRating).sort()).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("buckets a row with no path rather than dropping it", async () => {
    await seed([{ rating: 4, path: undefined }]);
    const summary = await feedbackStore.summarize();
    expect(summary.byPath.some((p) => p.path === "(unknown)")).toBe(true);
  });
});

describe("feedbackStore.list", () => {
  it("returns newest first — the useful end of a free-text log", async () => {
    await seed([{ rating: 2, comment: "MARKER-newest", path: "/stay" }]);
    const rows = await feedbackStore.list();
    expect(rows[0].comment).toBe("MARKER-newest");
  });

  it("bounds how much free text one page load pulls", async () => {
    const rows = await feedbackStore.list(undefined, 2);
    expect(rows).toHaveLength(2);
  });
});
