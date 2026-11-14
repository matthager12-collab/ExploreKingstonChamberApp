// Member event pages: artwork pulled from the page (ADR-0009), against a real
// (PGlite) Postgres. Auth, the page/image fetch, the model and the attachment
// store are stubbed; the check, the store, the SQL and the routes are real.

import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "../setup/pglite-db";

const state = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    role: string;
    orgId: string | null;
    editableIds: string[];
    entitlements: Record<string, unknown>;
    name: string;
    email: string;
  },
  events: [] as unknown[],
  image: { ok: true, bytes: new Uint8Array(12_000), ext: "png" } as
    | { ok: true; bytes: Uint8Array; ext: string }
    | { ok: false; code: string },
  saveThrows: false,
  imageCalls: [] as { url: string; at: number }[],
  saved: [] as { id: string; ext: string; ref: string }[],
  deleted: [] as string[],
}));

vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(async () => state.user),
  can: vi.fn(
    (u: { role: string; editableIds: string[] }, _a: string, r?: string) =>
      u.role === "admin" || (r != null && u.editableIds.includes(r)),
  ),
  getOrg: vi.fn(async () => undefined),
}));

vi.mock("@/lib/events/member-page-fetch", async (orig) => ({
  ...(await orig<typeof import("@/lib/events/member-page-fetch")>()),
  fetchMemberPage: vi.fn(async () => ({ ok: true, html: "<p>page</p>", finalUrl: "https://venue.example.com/events" })),
  fetchMemberImage: vi.fn(async (url: string) => {
    state.imageCalls.push({ url, at: Date.now() });
    return state.image;
  }),
}));

vi.mock("@/lib/events/extract-page-events", () => ({
  extractPageEvents: vi.fn(async () => ({ ok: true, events: state.events })),
}));

vi.mock("@/lib/events/attachment-store", async (orig) => ({
  ...(await orig<typeof import("@/lib/events/attachment-store")>()),
  attachmentStorageBytes: vi.fn(async () => 0),
  saveAttachment: vi.fn(async (id: string, _bytes: Uint8Array, ext: string) => {
    if (state.saveThrows) throw new Error("disk full");
    const ref = `${id}/1700000000000-abc123.${ext}`;
    state.saved.push({ id, ext, ref });
    return ref;
  }),
  deleteAttachment: vi.fn(async (ref: string) => {
    state.deleted.push(ref);
  }),
}));

import { GET, POST, PUT } from "@/app/api/portal/event-page/route";
import { POST as eventsPOST } from "@/app/api/portal/events/route";
import { getEventAdmin } from "@/lib/stores/event-store";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(() => tdb.close());

const URL_A = "https://venue.example.com/events";
let n = 0;
function fresh() {
  n += 1;
  return { a: `art-owner-a-${n}`, b: `art-owner-b-${n}` };
}
const asMember = (...ids: string[]) =>
  (state.user = {
    id: `art-member-${n}`,
    role: "member-business",
    orgId: "org-x",
    editableIds: ids,
    entitlements: {},
    name: "Member",
    email: "member@example.test",
  });

function req(method: string, body?: unknown, qs = "") {
  return new NextRequest(`http://localhost/api/portal/event-page${qs}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const eventReq = (body: unknown) =>
  new NextRequest("http://localhost/api/portal/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ev = (title: string, imageUrl?: string, date = "2099-01-05") => ({
  title,
  start: `${date}T19:00`,
  description: "d",
  category: "music",
  ...(imageUrl ? { imageUrl } : {}),
});

type Draft = { id: string; title: string; artworkRef: string | null };
async function check(ownerId: string): Promise<{ drafts: Draft[]; ok: boolean }> {
  await PUT(req("PUT", { ownerId, url: URL_A })); // resets the 10-minute window
  return (await POST(req("POST", { ownerId, action: "check" }))).json();
}

beforeEach(() => {
  state.user = null;
  state.events = [];
  state.image = { ok: true, bytes: new Uint8Array(12_000), ext: "png" };
  state.saveThrows = false;
  state.imageCalls = [];
  state.saved = [];
  state.deleted = [];
});

describe("check pulls in artwork", () => {
  it("downloads, stores and records one image for a newly inserted draft", async () => {
    const { a } = fresh();
    asMember(a);
    state.events = [ev("Fiddle night", "https://venue.example.com/img/fiddle.png")];
    const body = await check(a);
    expect(state.imageCalls.map((c) => c.url)).toEqual(["https://venue.example.com/img/fiddle.png"]);
    expect(state.saved).toHaveLength(1);
    const [draft] = body.drafts;
    // stored under an id derived from the draft's own (server-generated) id
    expect(state.saved[0].id).toBe(`draft-${draft.id}`);
    expect(draft.artworkRef).toBe(state.saved[0].ref);
  });

  it("an image failure leaves the draft with no artwork and the check still succeeds", async () => {
    const { a } = fresh();
    asMember(a);
    state.events = [ev("Too small", "https://venue.example.com/img/tiny.png")];
    state.image = { ok: false, code: "too-small" };
    const body = await check(a);
    expect(body.ok).toBe(true);
    expect(body.drafts.map((d) => [d.title, d.artworkRef])).toEqual([["Too small", null]]);
    expect(state.saved).toHaveLength(0);
  });

  it("a storage failure (sanitizer or disk) also leaves the draft without artwork", async () => {
    const { a } = fresh();
    asMember(a);
    state.events = [ev("Storage fails", "https://venue.example.com/img/x.png")];
    state.saveThrows = true;
    const body = await check(a);
    expect(body.ok).toBe(true);
    expect(body.drafts[0].artworkRef).toBeNull();
  });

  it("only NEW drafts download: a re-check of the same event does not fetch again", async () => {
    const { a } = fresh();
    asMember(a);
    state.events = [ev("Once only", "https://venue.example.com/img/once.png")];
    await check(a);
    await check(a);
    expect(state.imageCalls).toHaveLength(1);
  });

  it("downloads one at a time, at least 300 ms apart", async () => {
    const { a } = fresh();
    asMember(a);
    state.events = [
      ev("One", "https://venue.example.com/img/1.png", "2099-02-01"),
      ev("Two", "https://venue.example.com/img/2.png", "2099-02-02"),
    ];
    await check(a);
    expect(state.imageCalls).toHaveLength(2);
    expect(state.imageCalls[1].at - state.imageCalls[0].at).toBeGreaterThanOrEqual(290);
  });

  it("an event with no imageUrl never triggers a download", async () => {
    const { a } = fresh();
    asMember(a);
    state.events = [ev("Plain")];
    await check(a);
    expect(state.imageCalls).toHaveLength(0);
  });
});

describe("dismiss / publish and the stored artwork", () => {
  async function seed(a: string) {
    asMember(a);
    state.events = [ev("Has art", "https://venue.example.com/img/art.png")];
    const body = await check(a);
    return body.drafts[0];
  }

  it("dismiss deletes the stored artwork", async () => {
    const { a } = fresh();
    const d = await seed(a);
    expect((await POST(req("POST", { ownerId: a, action: "dismiss", draftId: d.id }))).status).toBe(200);
    expect(state.deleted).toEqual([d.artworkRef]);
  });

  it("publishing hands the artwork to the event: nothing is deleted", async () => {
    const { a } = fresh();
    const d = await seed(a);
    expect((await POST(req("POST", { ownerId: a, action: "published", draftId: d.id }))).status).toBe(200);
    expect(state.deleted).toEqual([]);
  });

  it("another owner cannot dismiss a draft (and so cannot delete its artwork)", async () => {
    const { a, b } = fresh();
    const d = await seed(a);
    asMember(b);
    expect((await POST(req("POST", { ownerId: b, action: "dismiss", draftId: d.id }))).status).toBe(404);
    expect(state.deleted).toEqual([]);
  });

  it("clearing the page keeps drafts, and so their artwork", async () => {
    const { a } = fresh();
    const d = await seed(a);
    await PUT(req("PUT", { ownerId: a, url: "" }));
    expect(state.deleted).toEqual([]);
    const got = await (await GET(req("GET", undefined, `?ownerId=${a}`))).json();
    expect(got.drafts[0].artworkRef).toBe(d.artworkRef);
  });
});

describe("POST /api/portal/events attachments", () => {
  const NEW = {
    title: "Fiddle night",
    start: "2099-03-01T19:00",
    description: "d",
    category: "music",
  };
  async function ownerWithArtwork() {
    const { a, b } = fresh();
    asMember(a);
    state.events = [ev("Art draft", "https://venue.example.com/img/a.png")];
    const d = (await check(a)).drafts[0];
    return { a, b, ref: d.artworkRef! };
  }

  it("accepts the ref only when it is that owner's draft artwork", async () => {
    const { a, ref } = await ownerWithArtwork();
    const res = await eventsPOST(eventReq({ ...NEW, ownerId: a, attachments: [ref] }));
    expect(res.status).toBe(200);
    expect((await res.json()).event.attachments).toEqual([ref]);
  });

  it("another owner's artwork ref is a 400", async () => {
    const { b, ref } = await ownerWithArtwork();
    asMember(b);
    const res = await eventsPOST(eventReq({ ...NEW, ownerId: b, attachments: [ref] }));
    expect(res.status).toBe(400);
  });

  it("a dismissed draft's ref is a 400 (the file is gone)", async () => {
    const { a, ref } = await ownerWithArtwork();
    const id = (await (await GET(req("GET", undefined, `?ownerId=${a}`))).json()).drafts[0].id;
    await POST(req("POST", { ownerId: a, action: "dismiss", draftId: id }));
    expect((await eventsPOST(eventReq({ ...NEW, ownerId: a, attachments: [ref] }))).status).toBe(400);
  });

  it.each([
    ["an arbitrary string", ["nope"]],
    ["a path traversal", ["../../etc/passwd.png"]],
    ["another event's stored file", ["some-event-abc123/1700000000000-aaaaaa.jpg"]],
    ["an untrusted https url", ["https://evil.test/x.png"]],
    ["two refs", ["a/1.png", "b/2.png"]],
    ["a non-string entry", [42]],
    ["not an array", "a/1.png"],
  ])("rejects %s with 400 and creates nothing", async (_n, attachments) => {
    const { a } = fresh();
    asMember(a);
    const res = await eventsPOST(eventReq({ ...NEW, ownerId: a, attachments }));
    expect(res.status).toBe(400);
  });

  it("no attachments field: unchanged behaviour (200, no attachments)", async () => {
    const { a } = fresh();
    asMember(a);
    const res = await eventsPOST(eventReq({ ...NEW, ownerId: a }));
    expect(res.status).toBe(200);
    expect((await res.json()).event.attachments).toBeUndefined();
    expect((await eventsPOST(eventReq({ ...NEW, ownerId: a, attachments: [] }))).status).toBe(200);
  });

  it("editing an existing event keeps its attachments unless new ones are given", async () => {
    const { a, ref } = await ownerWithArtwork();
    const created = (await (await eventsPOST(eventReq({ ...NEW, ownerId: a, attachments: [ref] }))).json()).event;
    const edited = await eventsPOST(eventReq({ ...NEW, title: "Fiddle night, new title", id: created.id, ownerId: a }));
    expect(edited.status).toBe(200);
    expect((await edited.json()).event.attachments).toEqual([ref]);
    expect((await getEventAdmin(created.id))?.attachments).toEqual([ref]);
  });
});
