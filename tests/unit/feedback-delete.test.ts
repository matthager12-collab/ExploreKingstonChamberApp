// Deleting a single feedback submission on request.
//
// This is the mechanism behind a PUBLISHED PROMISE — the privacy notice
// (version 2026-08) tells visitors they can have a comment removed before the
// 12-month window elapses. feedback_response holds no identifier for the
// PERSON, so the row is found by the wording the visitor quotes and then
// addressed by its surrogate id. These tests pin the two properties that make
// that promise safe to have made: the right row goes, and ONLY the right row
// goes.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc } from "drizzle-orm";

import { appendFeedbackResponse } from "@/lib/db/append";
import { getDb } from "@/lib/db/client";
import { audit } from "@/lib/db/schema";
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

async function seed(comment: string, path = "/eat") {
  await appendFeedbackResponse({
    submittedAt: new Date().toISOString(),
    rating: 3,
    comment,
    path,
  } satisfies FeedbackResponse);
}

describe("deleting one feedback submission", () => {
  it("removes exactly the requested row and leaves its neighbours alone", async () => {
    await seed("KEEP-before");
    await seed("DELETE-this");
    await seed("KEEP-after");

    const rows = await feedbackStore.listRows();
    const target = rows.find((r) => r.response.comment === "DELETE-this")!;
    expect(target).toBeDefined();

    expect(await feedbackStore.remove(target.id)).toBe(true);

    const after = await feedbackStore.listRows();
    const comments = after.map((r) => r.response.comment);
    expect(comments).not.toContain("DELETE-this");
    // The blast-radius check, and the reason feedback_response has a surrogate
    // key at all: `ts` is transaction_timestamp(), so rows written in the same
    // instant share it exactly. Addressing by timestamp took the neighbours
    // with it — destroying feedback nobody asked us to destroy — which is a
    // data-loss bug wearing a privacy feature's clothes.
    expect(comments).toContain("KEEP-before");
    expect(comments).toContain("KEEP-after");
  });

  it("reports false for a row that is already gone, rather than pretending", async () => {
    await seed("ONLY-ONCE");
    const row = (await feedbackStore.listRows()).find(
      (r) => r.response.comment === "ONLY-ONCE",
    )!;

    expect(await feedbackStore.remove(row.id)).toBe(true);
    // Retention may have got there first, or an admin double-clicked. That is a
    // different answer to give the person who asked than "deleted it".
    expect(await feedbackStore.remove(row.id)).toBe(false);
  });

  it("does not delete anything for an id that matches no row", async () => {
    const before = (await feedbackStore.listRows()).length;
    expect(await feedbackStore.remove(999_999)).toBe(false);
    expect((await feedbackStore.listRows()).length).toBe(before);
  });

  it("gives rows written in the SAME instant distinct ids", async () => {
    // The regression this file exists for. Three rows appended back-to-back
    // share a transaction_timestamp(), so any timestamp-based handle addresses
    // all three at once. Distinct ids are what make "delete this one comment"
    // mean one comment.
    await seed("SAME-INSTANT-a");
    await seed("SAME-INSTANT-b");
    const rows = (await feedbackStore.listRows()).filter((r) =>
      r.response.comment?.startsWith("SAME-INSTANT"),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].id).not.toBe(rows[1].id);

    await feedbackStore.remove(rows[0].id);
    const left = (await feedbackStore.listRows()).filter((r) =>
      r.response.comment?.startsWith("SAME-INSTANT"),
    );
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe(rows[1].id);
  });

  it("keeps the deleted words out of the append-only audit trail", async () => {
    // The audit table is never purged. Writing the comment into it would
    // re-immortalize the exact text the visitor just asked us to destroy — the
    // same trap scrubRecordDocFields avoids for charity contact emails.
    await seed("SECRET-my-phone-is-3605550100");
    const row = (await feedbackStore.listRows()).find((r) =>
      r.response.comment?.startsWith("SECRET-"),
    )!;
    await feedbackStore.remove(row.id);

    const rows = await getDb().select().from(audit).orderBy(asc(audit.id));
    expect(JSON.stringify(rows)).not.toContain("3605550100");
    expect(JSON.stringify(rows)).not.toContain("SECRET-");
  });

  it("listRows carries an id for every row", async () => {
    // Seeds its own row: the cases above delete what they create, so by here
    // the log can legitimately be empty.
    await seed("HANDLE-shape");
    const rows = await feedbackStore.listRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(typeof r.id).toBe("number");
      expect(Number.isInteger(r.id)).toBe(true);
    }
  });
});
