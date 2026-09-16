// Public suggestions carry the submitter's name and contact so the Chamber
// can follow up. Until 2026-09 those were never scrubbed: stripRequestContact
// knew the privacy/accuracy/claim request types but not `moderation`, so an
// event suggester's contact sat in the resolved row and in the never-purged
// audit table indefinitely. The Scarecrow Crawl registrations would have
// added more of the same. These tests hold the fix.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { stripRequestContact } from "@/lib/db/worklist";
import { audit } from "@/lib/db/schema";
import { PII_STORES } from "@/lib/privacy/pii-inventory";
import {
  createWorklistItem,
  getWorklistItem,
  resolveItem,
} from "@/lib/stores/worklist-store";
import { createTestDb, type TestDb } from "../setup/pglite-db";

const CONTACT = "pat.submitter@example.test";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

describe("stripRequestContact for public suggestions", () => {
  it("drops the whole suggest block from a moderation payload", () => {
    const stripped = stripRequestContact("moderation", {
      kind: "new",
      suggest: { submitterName: "Pat", contact: CONTACT },
    });
    expect(stripped).toEqual({ kind: "new" });
  });

  it("leaves a moderation payload with no suggest block exactly as it was", () => {
    const payload = { kind: "takedown", note: "wrong address" };
    expect(stripRequestContact("moderation", payload)).toEqual(payload);
  });
});

describe("a suggestion's contact, end to end", () => {
  it("is findable while the item is open, and gone from the row and the audit trail once resolved", async () => {
    const worklist = PII_STORES.find((s) => s.store === "worklist_item")!;

    const { item } = await createWorklistItem(
      {
        type: "moderation",
        subjectStore: "events",
        subjectId: "suggested-event-under-test",
        subjectLabel: "A suggested event",
        payload: { kind: "new", suggest: { submitterName: "Pat Submitter", contact: CONTACT } },
      },
      { actor: "public", source: "public" },
    );

    // A person asking what we hold on them must be told about the open item.
    expect(await worklist.findByIdentifier(CONTACT)).toHaveLength(1);

    await resolveItem(
      item.id,
      { resolution: "rejected", note: "test", resolvedBy: "admin-under-test" },
      { actor: "admin@example.test", source: "admin" },
    );

    const resolved = await getWorklistItem(item.id);
    expect(resolved?.payload).not.toHaveProperty("suggest");

    // The audit table is append-only and never purged: the contact must never
    // have reached it — not at creation, not at resolution.
    const rows = await tdb.db.select().from(audit);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(JSON.stringify(row)).not.toContain(CONTACT);
      expect(JSON.stringify(row)).not.toContain("Pat Submitter");
    }

    expect(await worklist.findByIdentifier(CONTACT)).toHaveLength(0);
  });
});
