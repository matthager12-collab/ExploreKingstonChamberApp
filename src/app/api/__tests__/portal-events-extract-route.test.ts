// POST /api/portal/events/extract — the gate in front of a metered LLM call.
//
// The extractor's own tests (tests/unit/events/extract-post.test.ts) cover what
// happens to a hostile or wrong model response. These cover who is allowed to
// spend money here at all, and what the route refuses before it calls out.
//
// No store, so no PGlite: this route reads nothing and writes nothing. That is
// itself the design — the LLM sits on a read path, and creating the event stays
// with the sibling POST and its moderation floor.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/portal/events/extract/route";
import { can, getSessionUser } from "@/lib/auth";
import { extractEventFromPost, MAX_POST_CHARS } from "@/lib/events/extract-post";
import { checkRateLimit } from "@/lib/rate-limit";

vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(async () => ({
    id: "u1",
    role: "member",
    orgId: "org-1",
    editableIds: ["owner-1"],
    entitlements: {},
    name: "Test",
    email: "t@t.t",
  })),
  can: vi.fn(() => true),
}));

vi.mock("@/lib/events/extract-post", async (importOriginal) => ({
  // MAX_POST_CHARS stays real — the size cap under test is the shipped one.
  ...(await importOriginal<typeof import("@/lib/events/extract-post")>()),
  extractEventFromPost: vi.fn(async () => ({
    title: "Crab Feed",
    start: "2026-10-03T17:00",
    end: "",
    venue: "Community Center",
    description: "",
    category: "community" as const,
    url: "",
    unsure: false,
    notes: "",
  })),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ ok: true, retryAfterSeconds: 0 })),
}));

const mockAuth = vi.mocked(getSessionUser);
const mockCan = vi.mocked(can);
const mockExtract = vi.mocked(extractEventFromPost);
const mockLimit = vi.mocked(checkRateLimit);

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/portal/events/extract", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

const BASE = { ownerId: "owner-1", text: "Crab feed Oct 3 at the community center!" };

beforeEach(() => {
  vi.clearAllMocks();
  mockCan.mockReturnValue(true);
  mockLimit.mockResolvedValue({ ok: true, retryAfterSeconds: 0 });
});

describe("POST /api/portal/events/extract", () => {
  it("returns a draft for a member who manages the listing", async () => {
    const res = await post(BASE);
    expect(res.status).toBe(200);
    expect((await res.json()).draft.title).toBe("Crab Feed");
  });

  // APP-AUTHN: no session, no spend.
  it("rejects an anonymous caller without calling the model", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await post(BASE);
    expect(res.status).toBe(401);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  // APP-AUTHZ: a signed-in member drafting against someone else's listing is
  // the horizontal case. `can` is the same check the sibling POST makes, so a
  // member cannot reach a listing they don't manage — and cannot bill us for
  // the attempt either.
  it("rejects a member who does not manage that listing", async () => {
    mockCan.mockReturnValue(false);
    const res = await post({ ...BASE, ownerId: "someone-elses-listing" });
    expect(res.status).toBe(403);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("requires an ownerId", async () => {
    const res = await post({ text: BASE.text });
    expect(res.status).toBe(400);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  // APP-INPUT: malformed and empty bodies fail closed, before the call.
  it("rejects malformed and empty input without calling the model", async () => {
    const bad = await POST(
      new NextRequest("http://localhost/api/portal/events/extract", {
        method: "POST",
        body: "{not json",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(bad.status).toBe(400);

    expect((await post({ ...BASE, text: "   " })).status).toBe(400);
    expect((await post({ ...BASE, text: 42 })).status).toBe(400);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  // Cost control: an oversized paste is refused at the boundary, so the bill
  // can't be run up by volume in a single request.
  it("refuses an oversized post with 413 and no call", async () => {
    const res = await post({ ...BASE, text: "x".repeat(MAX_POST_CHARS + 1) });
    expect(res.status).toBe(413);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  // ...or by repetition. Keyed on the account, which is the thing we can hold
  // still — a member on a rotating IP gets the same bucket.
  it("refuses once the per-account rate limit is spent", async () => {
    mockLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 90 });
    const res = await post(BASE);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("90");
    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockLimit.mock.calls[0][0]).toBe("event-extract:t@t.t");
  });

  // APP-SECRETS / APP-LOG: an upstream failure can carry request ids and key
  // fragments. The member gets a sentence; the detail stays in the server log.
  it("does not leak upstream error detail to the caller", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExtract.mockRejectedValueOnce(
      new Error("401 unauthorized: x-api-key sk-ant-SECRETCANARY request_id req_123"),
    );
    const res = await post(BASE);
    expect(res.status).toBe(502);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("SECRETCANARY");
    expect(text).not.toContain("req_123");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("says so plainly when the post holds no event", async () => {
    mockExtract.mockResolvedValueOnce(null);
    expect((await post(BASE)).status).toBe(422);
  });
});
