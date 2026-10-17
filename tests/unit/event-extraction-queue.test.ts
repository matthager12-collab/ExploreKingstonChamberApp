import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "../setup/pglite-db";
import { researchRequest, record } from "@/lib/db/schema";
import { claimResearch, finishResearch, claimPostExtraction, finishPostExtraction, listResearch, reviewResearch, createResearch } from "@/lib/db/research";
import { submitPostExtraction, readPostExtraction } from "@/lib/research/event-extraction-queue";
import { serializeDb, restoreDb } from "@/lib/db/export";
import { deleteResearchByEmail } from "@/lib/db/research-privacy";
import { __setDbForTests } from "@/lib/db/client";
import { MARKER_CATEGORIES } from "@/lib/map/types";
import type { AuthSubject } from "@/lib/auth/authz";
import type { ResearchContext } from "@/lib/research/context";
let tdb: TestDb;
beforeAll(async () => { tdb = await createTestDb(); });
afterAll(async () => { await tdb.close(); });
beforeEach(async () => { await tdb.db.delete(researchRequest); await tdb.db.delete(record); });
const user: AuthSubject = { id: "member-a", email: "a@example.test", name: "A", role: "member-business", orgId: "org-a", editableIds: ["cafe"], entitlements: {} };
const other = { ...user, id: "member-b", email: "b@example.test" };
const context: ResearchContext = { maps: [], events: [], calendar: [], views: [], categories: MARKER_CATEGORIES, now: new Date().toISOString(), timezone: "America/Los_Angeles" };
const good = { title: "Crab Feed", start: "2026-12-12T18:00", end: "", venue: "Fixture hall", description: "Public dinner.", category: "community", url: "", confidence: 0.9, notes: "" };
const input = () => ({ id: randomUUID(), ownerId: "cafe", text: "Crab Feed December 12, 2026 at 6pm" });
describe("submitter-scoped CLI extraction queue", () => {
  it("persists offline requests and deduplicates retries without disclosing input", async () => {
    const posted = input();
    const created = await submitPostExtraction(posted, user);
    expect(await submitPostExtraction(posted, user)).toEqual(created);
    expect(await readPostExtraction(created.id, user)).toEqual(created);
    expect(created).toEqual({ id: posted.id, state: "queued", revision: 1 });
    expect(await tdb.db.select().from(researchRequest)).toHaveLength(1);
    expect(await tdb.db.select().from(record)).toHaveLength(0);
  });
  it("denies other submitters, including staff, and revoked listing access", async () => {
    const job = await submitPostExtraction(input(), user);
    for (const caller of [other, { ...other, role: "admin" as const }, { ...user, editableIds: [] }]) {
      await expect(readPostExtraction(job.id, caller)).rejects.toThrow("unavailable");
      await expect(readPostExtraction(job.id, caller, true)).rejects.toThrow("unavailable");
    }
    expect((await readPostExtraction(job.id, user)).state).toBe("queued");
  });
  it("rejects another submitter's idempotency key and altered post/listing", async () => {
    const posted = input();
    await submitPostExtraction(posted, user);
    await expect(submitPostExtraction(posted, other)).rejects.toThrow("unavailable");
    await expect(submitPostExtraction({ ...posted, text: "Different post" }, user)).rejects.toThrow("already in use");
    await expect(submitPostExtraction({ ...posted, ownerId: "other" }, user)).rejects.toThrow("unavailable");
    await expect(submitPostExtraction({ ...posted, text: "x".repeat(8001) }, user)).rejects.toThrow();
  });
  it("keeps private extraction out of admin research and research id reuse", async () => {
    const posted = input();
    const job = await submitPostExtraction(posted, user);
    expect(await listResearch()).toHaveLength(0);
    await expect(createResearch({ id: job.id, prompt: posted.text }, user.email)).rejects.toThrow("already in use");
    await expect(reviewResearch({ action: "retry", id: job.id, revision: job.revision }, user.email, context)).rejects.toThrow("event form");
  });
  it("clamps a CLI result, removes raw input and never creates an event", async () => {
    const created = await submitPostExtraction(input(), user);
    const job = await claimResearch({ ...context, events: [{ id: "private-event", title: "Other draft", start: "2026-10-01T18:00", description: "private", venue: "Other hall", category: "community", organizer: "Other", status: "pending" }] });
    expect(job?.payload.baseline).toBeUndefined();
    await finishResearch(created.id, job!.leaseToken!, { ...good, url: "javascript:alert(1)", publish: true }, context);
    const status = await readPostExtraction(created.id, user);
    expect(status).toMatchObject({ state: "review", draft: { title: good.title, url: "" } });
    expect(status).not.toHaveProperty("leaseToken");
    expect(status).not.toHaveProperty("payload");
    const [stored] = await tdb.db.select().from(researchRequest);
    expect(stored.payload.prompt).toBe("");
    expect(await tdb.db.select().from(record)).toHaveLength(0);
    await expect(reviewResearch({ action: "publish", id: status.id, revision: status.revision, draftId: randomUUID() }, user.email, context)).rejects.toThrow("event form");
  });
  it("drops malformed model output to a recoverable failed state", async () => {
    const created = await submitPostExtraction(input(), user);
    const job = await claimResearch(context);
    await finishResearch(created.id, job!.leaseToken!, { ...good, category: "execute-shell" }, context);
    const status = await readPostExtraction(created.id, user);
    expect(status.state).toBe("failed");
    expect(status).not.toHaveProperty("draft");
    expect(status.error).toContain("fill the form");
  });
  it("scrubs cancelled text and refuses late worker completion or admin retry", async () => {
    const created = await submitPostExtraction(input(), user);
    const job = await claimResearch(context);
    expect((await readPostExtraction(created.id, user, true)).state).toBe("cancelled");
    await expect(finishResearch(created.id, job!.leaseToken!, good, context)).rejects.toThrow("expired");
    await expect(reviewResearch({ action: "retry", id: created.id, revision: job!.revision + 1 }, user.email, context)).rejects.toThrow("event form");
    const [stored] = await tdb.db.select().from(researchRequest);
    expect(stored.payload.prompt).toBe("");
    expect(stored.leaseToken).toBeNull();
  });
  it("rejects wrong leases without modifying the draft", async () => {
    const created = await submitPostExtraction(input(), user);
    await claimResearch(context);
    await expect(finishResearch(created.id, randomUUID(), good, context)).rejects.toThrow("expired");
    expect((await readPostExtraction(created.id, user)).state).toBe("researching");
  });
  it("expires and scrubs jobs on reads and worker sweeps", async () => {
    for (const viaRead of [true, false]) {
      const created = await submitPostExtraction(input(), user);
      const [row] = await tdb.db.select().from(researchRequest).where(eq(researchRequest.id, created.id));
      await tdb.db.update(researchRequest).set({ payload: { ...row.payload, extraction: { ...row.payload.extraction!, expiresAt: new Date(0).toISOString() } } }).where(eq(researchRequest.id, row.id));
      if (viaRead) expect((await readPostExtraction(created.id, user)).state).toBe("cancelled");
      else expect(await claimResearch(context)).toBeNull();
      const [stored] = await tdb.db.select().from(researchRequest).where(eq(researchRequest.id, row.id));
      expect(stored.state).toBe("cancelled");
      expect(stored.payload.prompt).toBe("");
    }
  });
  it("preserves submitter isolation after backup restore and supports privacy deletion", async () => {
    const job = await submitPostExtraction(input(), user);
    await claimResearch(context);
    const backup = await serializeDb();
    expect(backup.research_request![0]).not.toHaveProperty("leaseToken");
    const restored = await createTestDb();
    try {
      await restoreDb(backup, { force: false });
      expect((await readPostExtraction(job.id, user)).state).toBe("queued");
      await expect(readPostExtraction(job.id, other)).rejects.toThrow("unavailable");
      expect(await deleteResearchByEmail(user.email)).toBe(1);
      expect(await claimResearch(context)).toBeNull();
    } finally { await restored.close(); __setDbForTests(tdb.db); }
  });
});

describe("exact extraction job smoke selection", () => {
  it("selects only the named extraction while older research and other extraction jobs wait", async () => {
    const research = await createResearch({ id: randomUUID(), prompt: "ADMIN PRIVATE request" }, "admin@example.test");
    const otherJob = await submitPostExtraction(input(), other);
    const target = await submitPostExtraction(input(), user);
    const claimed = await claimPostExtraction(target.id);
    expect(claimed?.id).toBe(target.id);
    expect(claimed?.payload.baseline).toBeUndefined();
    for (const id of [research.id, otherJob.id]) {
      const [row] = await tdb.db.select().from(researchRequest).where(eq(researchRequest.id, id));
      expect(row.state).toBe("queued");
      expect(row.attempts).toBe(0);
      expect(row.leaseToken).toBeNull();
    }
    await finishPostExtraction(target.id, claimed!.leaseToken!, good);
    expect((await readPostExtraction(target.id, user)).state).toBe("review");
    expect(await tdb.db.select().from(record)).toHaveLength(0);
  });
  it("never falls back for missing, research, busy or completed target IDs", async () => {
    const research = await createResearch({ id: randomUUID(), prompt: "Admin research stays private" }, "admin");
    const otherJob = await submitPostExtraction(input(), other);
    expect(await claimPostExtraction(randomUUID())).toBeNull();
    expect(await claimPostExtraction(research.id)).toBeNull();
    await expect(claimPostExtraction("not-a-uuid")).rejects.toThrow();
    const target = await submitPostExtraction(input(), user);
    const claimed = await claimPostExtraction(target.id);
    expect(await claimPostExtraction(target.id)).toBeNull();
    await finishPostExtraction(target.id, claimed!.leaseToken!, good);
    expect(await claimPostExtraction(target.id)).toBeNull();
    expect((await readPostExtraction(otherJob.id, other)).state).toBe("queued");
    const [admin] = await tdb.db.select().from(researchRequest).where(eq(researchRequest.id, research.id));
    expect(admin.state).toBe("queued");
    expect(admin.leaseToken).toBeNull();
  });
  it("scrubs only the expired named job and never selects another job", async () => {
    const jobs = [await submitPostExtraction(input(), other), await submitPostExtraction(input(), user)];
    for (const job of jobs) {
      const [row] = await tdb.db.select().from(researchRequest).where(eq(researchRequest.id, job.id));
      await tdb.db.update(researchRequest).set({ payload: { ...row.payload, extraction: { ...row.payload.extraction!, expiresAt: new Date(0).toISOString() } } }).where(eq(researchRequest.id, row.id));
    }
    expect(await claimPostExtraction(jobs[1].id)).toBeNull();
    const rows = await tdb.db.select().from(researchRequest);
    expect(rows.find(r => r.id === jobs[0].id)?.state).toBe("queued");
    expect(rows.find(r => r.id === jobs[0].id)?.payload.prompt).not.toBe("");
    expect(rows.find(r => r.id === jobs[1].id)?.state).toBe("cancelled");
    expect(rows.find(r => r.id === jobs[1].id)?.payload.prompt).toBe("");
  });
  it("the targeted completion endpoint cannot complete or fail an admin research lease", async () => {
    const research = await createResearch({ id: randomUUID(), prompt: "Admin research" }, "admin");
    const claimed = await claimResearch(context);
    for (const failure of [true, false])
      await expect(finishPostExtraction(research.id, claimed!.leaseToken!, good, failure)).rejects.toThrow("not an extraction");
    const [row] = await tdb.db.select().from(researchRequest).where(eq(researchRequest.id, research.id));
    expect(row.state).toBe("researching");
    expect(row.leaseToken).toBe(claimed!.leaseToken);
  });
});
