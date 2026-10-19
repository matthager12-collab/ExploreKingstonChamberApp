import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "../setup/pglite-db";
import {
  claimResearch,
  createResearch,
  finishResearch,
  listResearch,
  reviewResearch,
} from "@/lib/db/research";
import { researchRequest, record } from "@/lib/db/schema";
import { writeRecord } from "@/lib/db/records";
import { MARKER_CATEGORIES } from "@/lib/map/types";
import type { Proposal } from "@/lib/research/schema";
import type { ResearchContext } from "@/lib/research/context";
import { __setDbForTests } from "@/lib/db/client";
import { serializeDb, restoreDb } from "@/lib/db/export";
import {
  deleteResearchByEmail,
  findResearchByEmail,
} from "@/lib/db/research-privacy";
let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});
beforeEach(async () => {
  await tdb.db.delete(researchRequest);
  await tdb.db.delete(record);
});
const context: ResearchContext = {
  maps: [],
  events: [],
  calendar: [],
  views: [
    {
      id: "trails",
      name: "Trails",
      center: [47.8, -122.5],
      zoom: 12,
      sources: [],
      published: true,
    },
  ],
  categories: MARKER_CATEGORIES,
  now: new Date().toISOString(),
  timezone: "America/Los_Angeles",
};
const proposal: Proposal = {
  kind: "map" as const,
  title: "Test launch",
  body: "Public kayak launch",
  sources: [{ title: "Official site", url: "https://example.org/launch" }],
  questions: [],
  targetId: "",
  data: {
    kind: "marker",
    category: "kayak",
    point: [47.8, -122.5],
    views: ["trails"],
  },
};
async function ready(p = proposal, c = context) {
  const created = await createResearch(
    { id: randomUUID(), prompt: "Research the launch" },
    "jen@example.org",
  );
  const job = await claimResearch(c);
  expect(job?.id).toBe(created.id);
  return finishResearch(
    job!.id,
    job!.leaseToken!,
    { summary: "Checked official source", drafts: [p] },
    c,
  );
}
describe("Chamber research workflow", () => {
  it("publishes calendar events with Pacific times and rejects a connected-calendar duplicate", async () => {
    const event: Proposal = {
      ...proposal,
      kind: "event",
      title: "Autumn festival",
      data: {
        start: "2026-10-30T17:00",
        end: "2026-10-30T19:00",
        venue: "Town park",
        organizer: "Chamber",
        category: "festival",
        ownerId: "untrusted-owner",
      },
    };
    const job = await ready(event);
    await reviewResearch(
      {
        action: "publish",
        id: job.id,
        revision: job.revision,
        draftId: job.payload.drafts[0].id,
      },
      "jen",
      context,
    );
    const [row] = await tdb.db.select().from(record);
    expect(row.doc.start).toBe("2026-10-30T17:00:00-07:00");
    expect(row.doc).not.toHaveProperty("ownerId");
    const other = await ready({ ...event, title: "Garden festival" });
    const calendar = {
      ...context,
      calendar: [
        {
          title: "Garden festival",
          startIso: "2026-10-31T00:00:00Z",
          venue: "Garden",
          description: "",
          allDay: false,
          source: "tribe-portofkingston" as const,
          externalId: "external",
          occurrenceKey: "external-1",
        },
      ],
    };
    await expect(
      reviewResearch(
        {
          action: "publish",
          id: other.id,
          revision: other.revision,
          draftId: other.payload.drafts[0].id,
        },
        "jen",
        calendar,
      ),
    ).rejects.toThrow("connected calendar");
  });

  it("deduplicates request retries and withholds lease credentials", async () => {
    const input = { id: randomUUID(), prompt: "Add a kayak launch" };
    await createResearch(input, "jen@example.org");
    await createResearch(input, "jen@example.org");
    const job = await claimResearch(context);
    expect(job?.leaseToken).toBeTruthy();
    expect(await claimResearch(context)).toBeNull();
    const list = await listResearch();
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty("leaseToken");
    expect(list[0].payload).not.toHaveProperty("baseline");
  });
  it("keeps research invisible publicly and atomically publishes the approved revision", async () => {
    const job = await ready();
    expect(await tdb.db.select().from(record)).toHaveLength(0);
    const command = {
      action: "publish",
      id: job.id,
      revision: job.revision,
      draftId: job.payload.drafts[0].id,
    };
    const saved = await reviewResearch(command, "jen@example.org", context);
    expect(saved.state).toBe("complete");
    expect((await tdb.db.select().from(record))[0].doc.title).toBe(
      "Test launch",
    );
    await expect(
      reviewResearch(command, "jen@example.org", context),
    ).rejects.toThrow("changed");
    expect(await tdb.db.select().from(record)).toHaveLength(1);
  });
  it("blocks unresolved facts, bad coordinates, and duplicate places", async () => {
    const uncertain = await ready({
      ...proposal,
      questions: ["Where is the entrance?"],
    });
    await expect(
      reviewResearch(
        {
          action: "publish",
          id: uncertain.id,
          revision: uncertain.revision,
          draftId: uncertain.payload.drafts[0].id,
        },
        "jen",
        context,
      ),
    ).rejects.toThrow("questions");
    const bad = await ready({
      ...proposal,
      data: { ...proposal.data, point: [0, 0] },
    });
    await expect(
      reviewResearch(
        {
          action: "publish",
          id: bad.id,
          revision: bad.revision,
          draftId: bad.payload.drafts[0].id,
        },
        "jen",
        context,
      ),
    ).rejects.toThrow();
    await writeRecord("map-features", {
      id: "already-there",
      title: proposal.title,
      kind: "marker",
    });
    const duplicate = await ready();
    await expect(
      reviewResearch(
        {
          action: "publish",
          id: duplicate.id,
          revision: duplicate.revision,
          draftId: duplicate.payload.drafts[0].id,
        },
        "jen",
        context,
      ),
    ).rejects.toThrow("matching listing");
  });
  it("rejects stale updates using the content snapshot from BEFORE research", async () => {
    const original = {
      id: "launch",
      kind: "marker" as const,
      title: "Old title",
      views: ["trails"],
      point: [47.8, -122.5] as [number, number],
      status: "live" as const,
    };
    const oldContext = { ...context, maps: [original] };
    const created = await createResearch(
      { id: randomUUID(), prompt: "Update launch" },
      "jen",
    );
    const claimed = await claimResearch(oldContext);
    await writeRecord("map-features", {
      ...original,
      title: "Someone else's edit",
    });
    const ready = await finishResearch(
      created.id,
      claimed!.leaseToken!,
      { summary: "done", drafts: [{ ...proposal, targetId: "launch" }] },
      { ...context, maps: [{ ...original, title: "Someone else's edit" }] },
    );
    await expect(
      reviewResearch(
        {
          action: "publish",
          id: ready.id,
          revision: ready.revision,
          draftId: ready.payload.drafts[0].id,
        },
        "jen",
        oldContext,
      ),
    ).rejects.toThrow("live record changed");
  });
  it("rejects expired workers and ignores results after cancellation", async () => {
    const created = await createResearch(
      { id: randomUUID(), prompt: "Research" },
      "jen",
    );
    const claimed = await claimResearch(context);
    await tdb.db
      .update(researchRequest)
      .set({ leaseUntil: new Date(0) })
      .where(eq(researchRequest.id, created.id));
    await expect(
      finishResearch(
        created.id,
        claimed!.leaseToken!,
        { summary: "", drafts: [] },
        context,
      ),
    ).rejects.toThrow("expired");
    const reclaimed = await claimResearch(context);
    expect(reclaimed!.leaseToken).not.toBe(claimed!.leaseToken);
    await reviewResearch(
      { action: "cancel", id: created.id, revision: reclaimed!.revision },
      "jen",
      context,
    );
    await expect(
      finishResearch(
        created.id,
        reclaimed!.leaseToken!,
        { summary: "", drafts: [] },
        context,
      ),
    ).rejects.toThrow("expired");
  });
  it("approves post copy without creating live content and backs up requests without tokens", async () => {
    const job = await ready({ ...proposal, kind: "post", data: {} });
    await reviewResearch(
      {
        action: "publish",
        id: job.id,
        revision: job.revision,
        draftId: job.payload.drafts[0].id,
      },
      "jen",
      context,
    );
    expect(await tdb.db.select().from(record)).toHaveLength(0);
    const backup = await serializeDb();
    expect(backup.research_request).toHaveLength(1);
    expect(backup.research_request![0]).not.toHaveProperty("leaseToken");
    const restored = await createTestDb();
    try {
      await restoreDb(backup, { force: false });
      expect(await listResearch()).toHaveLength(1);
    } finally {
      await restored.close();
      __setDbForTests(tdb.db);
    }
    expect(await findResearchByEmail("jen@example.org")).toHaveLength(1);
    expect(await deleteResearchByEmail("jen@example.org")).toBe(1);
  });
});
