// POST /api/portal/events/extract — the gate in front of a metered LLM call.
//
// The extractor's own tests (tests/unit/events/extract-post.test.ts) cover what
// happens to a hostile or wrong model response. These cover who is allowed to
// spend money here at all, and what the route refuses before it calls out.
//
// No store, so no PGlite: this route reads nothing and writes nothing. That is
// itself the design — the LLM sits on a read path, and creating the event stays
// with the sibling POST and its moderation floor.

import util from "node:util";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "test-credential-placeholder";
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
      new Error("401 unauthorized: x-api-key CANARY-7f3a91 request_id req_123"),
    );
    const res = await post(BASE);
    expect(res.status).toBe(502);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("CANARY-7f3a91");
    expect(text).not.toContain("req_123");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("says so plainly when the post holds no event", async () => {
    mockExtract.mockResolvedValueOnce(null);
    expect((await post(BASE)).status).toBe(422);
  });

  // Same posture as the feedback guardrail: no key is "not switched on", said
  // plainly, not a crash. It is checked after auth, so a signed-out caller gets
  // the 401 and learns nothing about configuration.
  it("says it isn't switched on when no key is set, without calling the model", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await post(BASE);
    expect(res.status).toBe(503);
    expect(mockExtract).not.toHaveBeenCalled();

    mockAuth.mockResolvedValueOnce(null);
    expect((await post(BASE)).status).toBe(401);
  });

  // Outside review, 2026-09-28: the whole exception was logged. The SDK's errors
  // carry the upstream body, and an upstream 400 can echo what it was sent, so a
  // pasted post could end up in the logs. Name, status and request id are enough
  // to trace a failure.
  it("logs only the error's name, status and request id", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExtract.mockRejectedValueOnce(
      Object.assign(new Error("400 the upstream echoed CANARY-LOG-9921 from the post"), {
        name: "BadRequestError",
        status: 400,
        requestID: "req_abc",
      }),
    );
    expect((await post(BASE)).status).toBe(502);
    const logged = util.inspect(consoleError.mock.calls, { depth: 6 });
    expect(logged).not.toContain("CANARY-LOG-9921");
    expect(logged).not.toContain("the upstream echoed");
    expect(logged).toContain("BadRequestError");
    expect(logged).toContain("400");
    expect(logged).toContain("req_abc");
    consoleError.mockRestore();
  });

  // The body used to be read whole before anything else was checked, so a
  // signed-in caller could send very large bodies without spending any quota.
  it("refuses an oversized request body before the extractor or the limiter", async () => {
    const res = await post({ ...BASE, padding: "x".repeat(200_000) });
    expect(res.status).toBe(413);
    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockLimit).not.toHaveBeenCalled();
  });

  it("answers 400, not a crash, when the body is not an object", async () => {
    for (const raw of ["null", "[]", "42", '"text"']) {
      const res = await POST(
        new NextRequest("http://localhost/api/portal/events/extract", {
          method: "POST",
          body: raw,
          headers: { "content-type": "application/json" },
        }),
      );
      expect(res.status, raw).toBe(400);
    }
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("says how long to wait, rounded up to whole minutes", async () => {
    mockLimit.mockResolvedValueOnce({ ok: false, retryAfterSeconds: 90 });
    expect((await (await post(BASE)).json()).error).toContain("about 2 minutes");
    mockLimit.mockResolvedValueOnce({ ok: false, retryAfterSeconds: 20 });
    expect((await (await post(BASE)).json()).error).toContain("about 1 minute");
  });

  // The limiter and the listing check are mocked above, so these assert the
  // ARGUMENTS: a limit raised to 1,200 or a check against the wrong listing
  // would otherwise pass.
  it("holds every member to 12 pastes in 10 minutes, keyed on the account", async () => {
    await post(BASE);
    expect(mockLimit).toHaveBeenCalledWith("event-extract:t@t.t", { limit: 12, windowMs: 600_000 });
  });

  it("checks the member against the listing named in the request", async () => {
    await post(BASE);
    expect(mockCan).toHaveBeenCalledWith(expect.objectContaining({ email: "t@t.t" }), "edit-record", "owner-1");
  });

  // A dropped upload (the stream errors part way) used to throw out of the route.
  it("answers 400, not a crash, when the upload breaks part way", async () => {
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(new TextEncoder().encode('{"ownerId":"owner-1",'));
          return;
        }
        controller.error(new Error("connection reset"));
      },
    });
    const res = await POST(
      new NextRequest("http://localhost/api/portal/events/extract", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
        duplex: "half",
      } as RequestInit),
    );
    expect(res.status).toBe(400);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  // The cap has to bite while the bytes arrive. A body that never ends must be
  // refused after a few chunks; reading it whole and measuring after would hang.
  it("stops reading a body that never ends", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(10_000));
      },
    });
    const res = await POST(
      new NextRequest("http://localhost/api/portal/events/extract", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
        duplex: "half",
      } as RequestInit),
    );
    expect(res.status).toBe(413);
    expect(pulls).toBeLessThan(10);
  });

  // A short post with a huge unused field is not "longer than 8000 characters".
  it("uses a different sentence for a too-big request than for a too-long post", async () => {
    const big = await (await post({ ...BASE, padding: "x".repeat(200_000) })).json();
    expect(big.error).toContain("too much");
    expect(big.error).not.toContain("8000");
    const long = await (await post({ ...BASE, text: "x".repeat(MAX_POST_CHARS + 1) })).json();
    expect(long.error).toContain("8000");
  });

  // The other listing test uses the same constant the code is given, so it would
  // pass if the code hard-wired that constant. A different id closes that.
  it("checks the member against whichever listing the request names", async () => {
    await post({ ...BASE, ownerId: "listing-xyz" });
    expect(mockCan).toHaveBeenCalledWith(expect.objectContaining({ email: "t@t.t" }), "edit-record", "listing-xyz");
  });
});
