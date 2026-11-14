// Member event page routes + cron (ADR-0009), against a real (PGlite) Postgres.
// Auth, fetch and the model are stubbed; the store, the SQL and the routes are real.

import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "../setup/pglite-db";

const state = vi.hoisted(() => ({
  user: null as null | { id: string; role: string; editableIds: string[] },
  fetchHtml: "<p>page</p>",
  events: [] as unknown[],
  extractThrows: false,
}));

vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(async () => state.user),
  can: vi.fn(
    (u: { role: string; editableIds: string[] }, _a: string, r?: string) =>
      u.role === "admin" || (r != null && u.editableIds.includes(r)),
  ),
  requireAdmin: vi.fn(async () =>
    state.user?.role === "admin"
      ? null
      : new Response(JSON.stringify({ error: "Sign in first" }), { status: state.user ? 403 : 401 }),
  ),
  timingSafeEqualStr: (a: string, b: string) => a === b,
}));

vi.mock("@/lib/events/member-page-fetch", async (orig) => ({
  ...(await orig<typeof import("@/lib/events/member-page-fetch")>()),
  fetchMemberPage: vi.fn(async () => ({ ok: true, html: state.fetchHtml })),
}));

vi.mock("@/lib/events/extract-page-events", () => ({
  extractPageEvents: vi.fn(async () => {
    if (state.extractThrows) throw new Error("boom");
    return { ok: true, events: state.events };
  }),
}));

import { GET, POST, PUT } from "@/app/api/portal/event-page/route";
import { POST as cronPOST } from "@/app/api/events/member-pages/route";
import { clearEventPage, saveEventPage } from "@/lib/stores/member-event-page-store";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(() => tdb.close());

const URL_A = "https://venue-a.example.com/events";
let n = 0;
/** A fresh owner id per test keeps tests independent (and the per-user rate limit key too). */
function fresh() {
  n += 1;
  return { a: `owner-a-${n}`, b: `owner-b-${n}` };
}
const asMember = (...ids: string[]) =>
  (state.user = { id: `member-${n}`, role: "member-business", editableIds: ids });

function req(method: string, body?: unknown, qs = "") {
  return new NextRequest(`http://localhost/api/portal/event-page${qs}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const ev = (title: string, date = "2099-01-05") => ({
  title,
  start: `${date}T19:00`,
  description: "d",
  category: "music",
});

beforeEach(() => {
  state.user = null;
  state.fetchHtml = "<p>page</p>";
  state.events = [];
  state.extractThrows = false;
});

describe("portal event-page route auth", () => {
  it("401 without a session on every verb", async () => {
    const { a } = fresh();
    expect((await GET(req("GET", undefined, `?ownerId=${a}`))).status).toBe(401);
    expect((await PUT(req("PUT", { ownerId: a, url: URL_A }))).status).toBe(401);
    expect((await POST(req("POST", { ownerId: a, action: "check" }))).status).toBe(401);
  });

  it("403 for another owner's listing on every verb", async () => {
    const { a, b } = fresh();
    asMember(b);
    expect((await GET(req("GET", undefined, `?ownerId=${a}`))).status).toBe(403);
    expect((await PUT(req("PUT", { ownerId: a, url: URL_A }))).status).toBe(403);
    expect((await POST(req("POST", { ownerId: a, action: "check" }))).status).toBe(403);
    expect((await POST(req("POST", { ownerId: a, action: "dismiss", draftId: "x" }))).status).toBe(403);
  });
});

describe("PUT", () => {
  it("saves a valid https url, rejects bad ones, and clears on empty string", async () => {
    const { a } = fresh();
    asMember(a);
    for (const bad of ["http://x.example.com/", "https://127.0.0.1/", "https://u:p@x.example.com/", "nope", "https://x.example.com:8443/"]) {
      expect((await PUT(req("PUT", { ownerId: a, url: bad }))).status, bad).toBe(400);
    }
    expect((await PUT(req("PUT", { ownerId: a, url: URL_A }))).status).toBe(200);
    const got = await (await GET(req("GET", undefined, `?ownerId=${a}`))).json();
    expect(got.page.url).toBe(URL_A);
    expect(got.page.lastCheckedAt).toBeNull();
    await PUT(req("PUT", { ownerId: a, url: "" }));
    expect((await (await GET(req("GET", undefined, `?ownerId=${a}`))).json()).page).toBeNull();
  });

  it("clearing the page keeps the drafts", async () => {
    const { a } = fresh();
    asMember(a);
    state.events = [ev("Keep me")];
    await PUT(req("PUT", { ownerId: a, url: URL_A }));
    await POST(req("POST", { ownerId: a, action: "check" }));
    await PUT(req("PUT", { ownerId: a, url: "" }));
    const got = await (await GET(req("GET", undefined, `?ownerId=${a}`))).json();
    expect(got.page).toBeNull();
    expect(got.drafts.map((d: { title: string }) => d.title)).toEqual(["Keep me"]);
  });
});

describe("POST check", () => {
  it("400 with no saved page", async () => {
    const { a } = fresh();
    asMember(a);
    expect((await POST(req("POST", { ownerId: a, action: "check" }))).status).toBe(400);
  });

  it("stores drafts sorted by start, returns counts, and rate limits to one check per 10 min", async () => {
    const { a } = fresh();
    asMember(a);
    state.events = [ev("Later", "2099-03-01"), ev("Sooner", "2099-02-01")];
    await PUT(req("PUT", { ownerId: a, url: URL_A }));
    const res = await POST(req("POST", { ownerId: a, action: "check" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect([body.found, body.added]).toEqual([2, 2]);
    expect(body.drafts.map((d: { title: string }) => d.title)).toEqual(["Sooner", "Later"]);
    const again = await POST(req("POST", { ownerId: a, action: "check" }));
    expect(again.status).toBe(429);
  });

  it("records a safe error when the fetch fails", async () => {
    const { a } = fresh();
    asMember(a);
    const { fetchMemberPage } = await import("@/lib/events/member-page-fetch");
    vi.mocked(fetchMemberPage).mockResolvedValueOnce({
      ok: false,
      code: "unreachable",
      message: "We couldn't reach that page",
    });
    await PUT(req("PUT", { ownerId: a, url: URL_A }));
    const body = await (await POST(req("POST", { ownerId: a, action: "check" }))).json();
    expect(body.ok).toBe(false);
    expect(body.page.lastError).toBe("We couldn't reach that page");
  });
});

describe("drafts: dismiss / published / no resurrection", () => {
  async function seed(a: string) {
    asMember(a);
    state.events = [ev("Quiz night")];
    await PUT(req("PUT", { ownerId: a, url: URL_A }));
    const r = await (await POST(req("POST", { ownerId: a, action: "check" }))).json();
    return r.drafts[0].id as string;
  }

  it("owner A's draft cannot be dismissed through owner B", async () => {
    const { a, b } = fresh();
    const draftId = await seed(a);
    asMember(b); // B is a legitimate member of B…
    const res = await POST(req("POST", { ownerId: b, action: "dismiss", draftId }));
    expect(res.status).toBe(404); // …but A's draft is not theirs
    asMember(a);
    const got = await (await GET(req("GET", undefined, `?ownerId=${a}`))).json();
    expect(got.drafts).toHaveLength(1);
  });

  it("a dismissed draft is not re-created by a re-check; neither is a published one", async () => {
    const { a } = fresh();
    const draftId = await seed(a);
    expect((await POST(req("POST", { ownerId: a, action: "dismiss", draftId }))).status).toBe(200);
    // second dismiss: no longer 'new'
    expect((await POST(req("POST", { ownerId: a, action: "dismiss", draftId }))).status).toBe(404);
    expect((await POST(req("POST", { ownerId: a, action: "published", draftId }))).status).toBe(404);

    // Re-save the page (resets the 10-minute window) and re-check the same event.
    await PUT(req("PUT", { ownerId: a, url: URL_A }));
    const r = await (await POST(req("POST", { ownerId: a, action: "check" }))).json();
    expect([r.found, r.added]).toEqual([1, 0]);
    expect(r.drafts).toEqual([]);
  });

  it("published retires a draft the same way", async () => {
    const { a } = fresh();
    const draftId = await seed(a);
    expect((await POST(req("POST", { ownerId: a, action: "published", draftId }))).status).toBe(200);
    await PUT(req("PUT", { ownerId: a, url: URL_A }));
    const r = await (await POST(req("POST", { ownerId: a, action: "check" }))).json();
    expect(r.added).toBe(0);
  });

  it("a dismissed series draft is not resurrected when a later day moves its first date", async () => {
    const { a } = fresh();
    asMember(a);
    const series = (start: string) => ({
      title: "Fridays with Bruce",
      start,
      description: "d",
      category: "music",
      rrule: "FREQ=WEEKLY;BYDAY=FR",
      timeMissing: false,
    });
    state.events = [series("2099-01-02T18:30")];
    await PUT(req("PUT", { ownerId: a, url: URL_A }));
    const first = await (await POST(req("POST", { ownerId: a, action: "check" }))).json();
    expect(first.drafts[0].rrule).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(first.drafts[0].timeMissing).toBe(false);
    await POST(req("POST", { ownerId: a, action: "dismiss", draftId: first.drafts[0].id }));

    state.events = [series("2099-01-09T18:30")]; // a week later: same series, new first date
    await PUT(req("PUT", { ownerId: a, url: URL_A }));
    const again = await (await POST(req("POST", { ownerId: a, action: "check" }))).json();
    expect([again.found, again.added]).toEqual([1, 0]);
    expect(again.drafts).toEqual([]);
  });

  it("untimed and ticketed drafts round-trip through the payload", async () => {
    const { a } = fresh();
    asMember(a);
    state.events = [
      { ...ev("Untimed"), start: "2099-01-05T00:00", timeMissing: true, ticketUrl: "https://t.example.com/1" },
    ];
    await PUT(req("PUT", { ownerId: a, url: URL_A }));
    const body = await (await POST(req("POST", { ownerId: a, action: "check" }))).json();
    expect(body.drafts[0]).toMatchObject({
      timeMissing: true,
      ticketUrl: "https://t.example.com/1",
      rrule: null,
    });
  });

  it("unknown action is 400", async () => {
    const { a } = fresh();
    asMember(a);
    expect((await POST(req("POST", { ownerId: a, action: "nuke" }))).status).toBe(400);
  });
});

describe("cron route /api/events/member-pages", () => {
  const cron = (token?: string) =>
    cronPOST(
      new NextRequest("http://localhost/api/events/member-pages", {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
    );

  beforeEach(() => {
    process.env.EVENTS_INGEST_TOKEN = "cron-test-token";
  });

  it("refuses without a token or admin (401), and with a wrong token", async () => {
    expect((await cron()).status).toBe(401);
    expect((await cron("wrong")).status).toBe(401);
    asMember("x");
    expect((await cron()).status).toBe(403);
  });

  it("fails closed when the token is unset: 503 in production, never open", async () => {
    delete process.env.EVENTS_INGEST_TOKEN;
    vi.stubEnv("NODE_ENV", "production");
    expect((await cron()).status).toBe(503);
    expect((await cron("anything")).status).toBe(503);
    vi.stubEnv("NODE_ENV", "test");
    expect((await cron("anything")).status).toBe(401);
    vi.unstubAllEnvs();
  });

  it("works with the token: checks due pages, survives one failure", async () => {
    // Clean slate: only the pages this test creates are due.
    const { getDb } = await import("@/lib/db/client");
    const { memberEventPage } = await import("@/lib/db/schema");
    await getDb().delete(memberEventPage);

    const { a, b } = fresh();
    await saveEventPage(a, URL_A);
    await saveEventPage(b, "https://venue-b.example.com/events");
    state.events = [ev("Cron night")];

    const { extractPageEvents } = await import("@/lib/events/extract-page-events");
    vi.mocked(extractPageEvents).mockRejectedValueOnce(new Error("first page blows up"));

    const res = await cron("cron-test-token");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, checked: 1, failed: 1, added: 1 });

    // Both were stamped just now, so an immediate second run has nothing due.
    expect(await (await cron("cron-test-token")).json()).toEqual({ ok: true, checked: 0, failed: 0, added: 0 });
    await clearEventPage(a);
    await clearEventPage(b);
  });

  it("an admin session works without the token", async () => {
    state.user = { id: "adm", role: "admin", editableIds: [] };
    expect((await cron()).status).toBe(200);
  });
});
