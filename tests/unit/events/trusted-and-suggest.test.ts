// E12 moderation-gate EXTENSION (criterion 9): the trusted-org auto-publish
// bypass (both event write paths, create + edit) and the anonymous suggest
// intake (always pending, no bypass of any kind). E08's original suite
// (tests/unit/moderation-gate.test.ts) keeps its assertions untouched — the
// non-trusted fixtures there prove the floor; this file proves the ONE
// doorway through it and the queue path around it.

import { NextRequest } from "next/server";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/db/schema";
import { charities as charitySeed } from "@/lib/data/charities";
import { restaurants as restaurantSeed } from "@/lib/data/restaurants";
import { approveModerationItem } from "@/lib/moderation";
import { getEventAdmin, getEvents } from "@/lib/stores/event-store";
import { listWorklistItems } from "@/lib/stores/worklist-store";
import { setUnifiedCalendarEnabled } from "@/lib/stores/unified-calendar-store";
import { createTestDb, type TestDb } from "../../setup/pglite-db";

// Switchable session + switchable ORG (the trusted flag lives on the org row;
// the routes read it through getOrg).
const authState = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    role: string;
    orgId: string | null;
    editableIds: string[];
    entitlements: Record<string, unknown>;
    name: string;
    email: string;
  },
  trustedOrg: false,
}));

vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(async () => authState.user),
  can: vi.fn(
    (u: { role: string; editableIds: string[] }, _a: string, r?: string) =>
      u.role === "admin" || (r != null && u.editableIds.includes(r)),
  ),
  getOrg: vi.fn(async (id: string) =>
    id === "org-x" ? { id, trustedAutoPublish: authState.trustedOrg } : undefined,
  ),
}));

import { POST as eventsPOST } from "@/app/api/portal/events/route";
import { POST as orgPOST } from "@/app/api/portal/org/route";
import { POST as suggestPOST } from "@/app/api/events/suggest/route";
import { GET as feedsEventsGET } from "@/app/api/feeds/events/route";

const seedRestaurant = restaurantSeed[0];
const seedCharity = charitySeed[0];
const ADMIN = { id: "admin-1", email: "admin@example.test" };

function asMember(...editableIds: string[]) {
  authState.user = {
    id: "member-1",
    role: "member-business",
    orgId: "org-x",
    editableIds,
    entitlements: {},
    name: "Member",
    email: "member@example.test",
  };
}

function jsonReq(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function openModerationFor(id: string) {
  const items = await listWorklistItems({ type: "moderation", state: "open" });
  return items.filter((i) => i.subjectStore === "events" && i.subjectId === id);
}

async function auditRowsFor(id: string): Promise<number> {
  const [row] = await tdb.db
    .select({ n: count() })
    .from(audit)
    .where(eq(audit.recordId, id));
  return Number(row.n);
}

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
  authState.user = null;
  await setUnifiedCalendarEnabled(true, "vitest"); // suggest surface is flag-gated
  authState.user = null;
});
afterAll(async () => {
  await tdb.close();
});

const NEW_EVENT = {
  ownerId: seedRestaurant.id,
  title: "Trusted Org Launch Party",
  start: "2026-09-01T18:00",
  category: "community",
  venue: "The Point",
  description: "Party",
};

describe("(e) trustedAutoPublish bypass — /api/portal/events", () => {
  it("a trusted org's CREATE goes live immediately, with an audit row and no queue item", async () => {
    asMember(seedRestaurant.id);
    authState.trustedOrg = true;
    const res = await eventsPOST(jsonReq("/api/portal/events", "POST", NEW_EVENT));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { event: { id: string }; pending?: boolean };
    expect(body.pending).toBeUndefined();
    const stored = await getEventAdmin(body.event.id);
    expect(stored?.status).toBe("live");
    expect(await openModerationFor(body.event.id)).toHaveLength(0);
    expect(await auditRowsFor(body.event.id)).toBeGreaterThanOrEqual(1);
  });

  it("a trusted org's EDIT of a live event applies directly to the live record", async () => {
    asMember(seedRestaurant.id);
    authState.trustedOrg = true;
    const created = await eventsPOST(jsonReq("/api/portal/events", "POST", NEW_EVENT));
    const { event } = (await created.json()) as { event: { id: string } };

    const res = await eventsPOST(
      jsonReq("/api/portal/events", "POST", {
        ...NEW_EVENT,
        id: event.id,
        title: "Trusted Org Launch Party (retitled)",
      }),
    );
    expect(res.status).toBe(200);
    const stored = await getEventAdmin(event.id);
    expect(stored?.status).toBe("live");
    expect(stored?.title).toBe("Trusted Org Launch Party (retitled)");
    expect(await openModerationFor(event.id)).toHaveLength(0);
  });

  it("(d) the SAME org without the flag lands pending — the flag is the only bypass", async () => {
    asMember(seedRestaurant.id);
    authState.trustedOrg = false;
    const res = await eventsPOST(
      jsonReq("/api/portal/events", "POST", { ...NEW_EVENT, title: "Untrusted Event" }),
    );
    const body = (await res.json()) as { event: { id: string }; pending?: boolean };
    expect(body.pending).toBe(true);
    expect((await getEventAdmin(body.event.id))?.status).toBe("pending");
    expect(await openModerationFor(body.event.id)).toHaveLength(1);
  });

  it("(d) a non-trusted edit of a LIVE event leaves the live record unchanged (proposed revision held)", async () => {
    asMember(seedRestaurant.id);
    authState.trustedOrg = true;
    const created = await eventsPOST(
      jsonReq("/api/portal/events", "POST", { ...NEW_EVENT, title: "Goes Live First" }),
    );
    const { event } = (await created.json()) as { event: { id: string } };
    authState.trustedOrg = false;
    const res = await eventsPOST(
      jsonReq("/api/portal/events", "POST", {
        ...NEW_EVENT,
        id: event.id,
        title: "Sneaky Unreviewed Retitle",
      }),
    );
    expect(((await res.json()) as { pending?: boolean }).pending).toBe(true);
    expect((await getEventAdmin(event.id))?.title).toBe("Goes Live First");
    expect(await openModerationFor(event.id)).toHaveLength(1);
  });
});

describe("(e) trustedAutoPublish bypass — /api/portal/org saveEvent", () => {
  const ORG_EVENT = {
    action: "saveEvent",
    orgId: seedCharity.id,
    event: {
      title: "Trusted Nonprofit Gala",
      date: "2026-09-12",
      startTime: "17:00",
      endTime: "20:00",
      venue: "Village Green",
    },
  };

  it("(d)+(e) create: pending without the flag, live with it — same route, same org", async () => {
    asMember(seedCharity.id);
    authState.trustedOrg = false;
    const held = await orgPOST(jsonReq("/api/portal/org", "POST", ORG_EVENT));
    const heldBody = (await held.json()) as { event: { id: string }; pending?: boolean };
    expect(heldBody.pending).toBe(true);
    expect((await getEventAdmin(heldBody.event.id))?.status).toBe("pending");

    authState.trustedOrg = true;
    const direct = await orgPOST(jsonReq("/api/portal/org", "POST", ORG_EVENT));
    const directBody = (await direct.json()) as { event: { id: string }; pending?: boolean };
    expect(directBody.pending).toBeUndefined();
    expect((await getEventAdmin(directBody.event.id))?.status).toBe("live");
    expect(await auditRowsFor(directBody.event.id)).toBeGreaterThanOrEqual(1);
  });

  it("(e) edit: a trusted org's edit via the org route applies to the live record directly", async () => {
    asMember(seedCharity.id);
    authState.trustedOrg = true;
    const created = await orgPOST(jsonReq("/api/portal/org", "POST", ORG_EVENT));
    const { event } = (await created.json()) as { event: { id: string } };
    const res = await orgPOST(
      jsonReq("/api/portal/org", "POST", {
        ...ORG_EVENT,
        event: { ...ORG_EVENT.event, id: event.id, title: "Gala (new venue)" },
      }),
    );
    expect(res.status).toBe(200);
    const stored = await getEventAdmin(event.id);
    expect(stored?.status).toBe("live");
    expect(stored?.title).toBe("Gala (new venue)");
    expect(await openModerationFor(event.id)).toHaveLength(0);
  });
});

describe("(a)-(c) anonymous suggest intake — always pending, no bypass", () => {
  const SUGGESTION = {
    title: "Beach Bonfire Storytelling Night",
    start: "2026-09-20T19:00",
    venue: "Arness Park",
    description: "Stories by the fire.",
    eventContact: "Firelight Arts · info@firelight.test",
    submitterName: "Pat Suggests",
    contact: "pat@example.test",
  };

  /** Multipart suggest request. Each call defaults to a UNIQUE client IP so
   *  the 5/hour bucket (keyed on IP) doesn't bleed across tests; the rate-limit
   *  test pins one IP on purpose. */
  let ipSeq = 0;
  function suggestReq(
    fields: Record<string, string>,
    files: { name: string; type: string; bytes: Uint8Array }[] = [],
    ip = `10.0.0.${++ipSeq}`,
  ) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    for (const f of files) {
      fd.append("attachments", new File([f.bytes as BlobPart], f.name, { type: f.type }));
    }
    return new NextRequest("http://localhost/api/events/suggest", {
      method: "POST",
      body: fd,
      headers: { "x-forwarded-for": ip },
    });
  }

  let suggestedId: string;

  it("(a) POST creates a pending record; the PUBLIC event carries eventContact, the PRIVATE submitter contact rides only in the payload", async () => {
    authState.user = null; // truly anonymous
    const res = await suggestPOST(suggestReq(SUGGESTION));
    expect(res.status).toBe(200);

    const pending = (await listWorklistItems({ type: "moderation", state: "open" })).filter(
      (i) => i.subjectStore === "events" && i.subjectLabel === SUGGESTION.title,
    );
    expect(pending).toHaveLength(1);
    suggestedId = pending[0].subjectId;
    const doc = await getEventAdmin(suggestedId);
    expect(doc?.status).toBe("pending");
    // Public field is on the event doc; private submitter contact is NOT.
    expect(doc?.eventContact).toBe(SUGGESTION.eventContact);
    expect(JSON.stringify(doc)).not.toContain(SUGGESTION.contact);
    const payload = pending[0].payload as {
      kind: string;
      suggest?: { submitterName: string; contact: string };
    };
    expect(payload.kind).toBe("new");
    expect(payload.suggest).toEqual({
      submitterName: SUGGESTION.submitterName,
      contact: SUGGESTION.contact,
    });
  });

  it("the public event contact is REQUIRED (400 without it)", async () => {
    authState.user = null;
    const { eventContact: _omit, ...noContact } = SUGGESTION;
    const res = await suggestPOST(suggestReq({ ...noContact, title: "No Contact Event" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/public contact/i);
  });

  it("(b) the public feed does NOT include the pending suggestion", async () => {
    authState.user = null;
    const res = await feedsEventsGET(jsonReq("/api/feeds/events", "GET"));
    const body = (await res.json()) as { events: { id: string }[] };
    expect(body.events.some((e) => e.id === suggestedId)).toBe(false);
    expect((await getEvents()).some((e) => e.id === suggestedId)).toBe(false);
  });

  it("(c) after approval the feed includes it AND surfaces the public eventContact", async () => {
    const [item] = await openModerationFor(suggestedId);
    expect(item).toBeDefined();
    await approveModerationItem(item, ADMIN);
    expect((await getEventAdmin(suggestedId))?.status).toBe("live");
    const res = await feedsEventsGET(jsonReq("/api/feeds/events", "GET"));
    const body = (await res.json()) as {
      events: { id: string; eventContact?: string }[];
    };
    const live = body.events.find((e) => e.id === suggestedId);
    expect(live).toBeDefined();
    expect(live!.eventContact).toBe(SUGGESTION.eventContact);
  });

  it("accepts image + PDF attachments and attaches their refs to the pending event", async () => {
    authState.user = null;
    const res = await suggestPOST(
      suggestReq({ ...SUGGESTION, title: "Gallery Opening" }, [
        { name: "flyer.png", type: "image/png", bytes: new Uint8Array([1, 2, 3]) },
        { name: "program.pdf", type: "application/pdf", bytes: new Uint8Array([4, 5, 6]) },
      ]),
    );
    expect(res.status).toBe(200);
    const item = (await listWorklistItems({ type: "moderation", state: "open" })).find(
      (i) => i.subjectLabel === "Gallery Opening",
    );
    const doc = await getEventAdmin(item!.subjectId);
    expect(doc?.attachments).toHaveLength(2);
    expect(doc?.attachments?.some((r) => r.endsWith(".png"))).toBe(true);
    expect(doc?.attachments?.some((r) => r.endsWith(".pdf"))).toBe(true);
  });

  it("rejects a disallowed file type (415) and an oversize file (413), storing nothing", async () => {
    authState.user = null;
    const bad = await suggestPOST(
      suggestReq({ ...SUGGESTION, title: "Zip Bomb" }, [
        { name: "evil.zip", type: "application/zip", bytes: new Uint8Array([1]) },
      ]),
    );
    expect(bad.status).toBe(415);

    const huge = await suggestPOST(
      suggestReq({ ...SUGGESTION, title: "Huge Poster" }, [
        { name: "poster.png", type: "image/png", bytes: new Uint8Array(8 * 1024 * 1024 + 1) },
      ]),
    );
    expect(huge.status).toBe(413);

    expect(
      (await listWorklistItems({ type: "moderation", state: "open" })).some(
        (i) => i.subjectLabel === "Zip Bomb" || i.subjectLabel === "Huge Poster",
      ),
    ).toBe(false);
  });

  it("a filled honeypot is a quiet no-op (200, nothing stored)", async () => {
    const before = (await listWorklistItems({ type: "moderation", state: "open" })).length;
    const res = await suggestPOST(
      suggestReq({ ...SUGGESTION, title: "Bot Event", website2: "https://spam.example" }),
    );
    expect(res.status).toBe(200);
    expect((await listWorklistItems({ type: "moderation", state: "open" })).length).toBe(before);
  });

  it("(criterion 10) the request after the limit inside the window is a 429 with Retry-After", async () => {
    authState.user = null;
    let last: Response | null = null;
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      // Same IP every iteration → the shared bucket fills and trips 429.
      last = await suggestPOST(suggestReq({ ...SUGGESTION, title: `Flood ${i}` }, [], "10.9.9.9"));
      statuses.push(last.status);
    }
    expect(statuses).toContain(429);
    expect(last!.status).toBe(429);
    expect(last!.headers.get("Retry-After")).toBeTruthy();
  });
});
