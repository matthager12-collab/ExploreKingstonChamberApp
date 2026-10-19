import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST, PATCH } from "@/app/api/portal/events/extract/route";
import { can, getSessionUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { extractionConfigured, readPostExtraction, submitPostExtraction, ExtractionUnavailable } from "@/lib/research/event-extraction-queue";
vi.mock("@/lib/auth", () => ({ getSessionUser: vi.fn(), can: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/research/event-extraction-queue", () => ({
  extractionConfigured: vi.fn(), readPostExtraction: vi.fn(), submitPostExtraction: vi.fn(),
  ExtractionUnavailable: class ExtractionUnavailable extends Error {},
}));
const user = { id: "member", role: "member-business" as const, orgId: "org-1", editableIds: ["cafe"], entitlements: {}, name: "Test", email: "member@example.test", orgName: "Test", lastLoginAt: null, createdAt: new Date() };
const base = { id: randomUUID(), ownerId: "cafe", text: "Crab feed October 3, 2026 at 5pm" };
function req(method = "POST", body: unknown = base, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/portal/events/extract", { method, body: method === "GET" ? undefined : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue(user);
  vi.mocked(can).mockReturnValue(true);
  vi.mocked(checkRateLimit).mockResolvedValue({ ok: true, retryAfterSeconds: 0 });
  vi.mocked(extractionConfigured).mockReturnValue(true);
  vi.mocked(submitPostExtraction).mockResolvedValue({ id: base.id, state: "queued", revision: 1 });
  vi.mocked(readPostExtraction).mockResolvedValue({ id: base.id, state: "queued", revision: 1 });
});
describe("private post extraction queue HTTP boundary", () => {
  it("requires sign-in for every operation", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    for (const handler of [POST, PATCH, GET]) expect((await handler(req())).status).toBe(401);
    expect(submitPostExtraction).not.toHaveBeenCalled();
    expect(readPostExtraction).not.toHaveBeenCalled();
  });
  it("checks listing permission before configuration or metering", async () => {
    vi.mocked(can).mockReturnValue(false);
    expect((await POST(req())).status).toBe(403);
    expect(extractionConfigured).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
  it("accepts loopback Host despite Next normalizing the URL", async () => {
    const request = new NextRequest("http://localhost:3114/api/portal/events/extract", { method: "POST", headers: { host: "127.0.0.1:3114", origin: "http://127.0.0.1:3114", "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(base) });
    const res = await POST(request);
    expect(res.status).toBe(202);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ job: { id: base.id, state: "queued", revision: 1 } });
    expect(submitPostExtraction).toHaveBeenCalledWith(base, user);
  });
  it("rejects cross-origin and simple-content-type mutations", async () => {
    for (const handler of [POST, PATCH]) {
      expect((await handler(req("POST", base, { origin: "https://other.example" }))).status).toBe(403);
      expect((await handler(req("POST", base, { "content-type": "text/plain" }))).status).toBe(415);
    }
    expect(submitPostExtraction).not.toHaveBeenCalled();
    expect(readPostExtraction).not.toHaveBeenCalled();
  });
  it("keeps manual fallback available when disconnected", async () => {
    vi.mocked(extractionConfigured).mockReturnValue(false);
    expect((await POST(req())).status).toBe(503);
    expect(submitPostExtraction).not.toHaveBeenCalled();
  });
  it("rejects malformed envelopes and missing request IDs", async () => {
    for (const body of [null, [], 42, "post", {}, { ...base, id: "bad" }, { ...base, text: " " }])
      expect((await POST(req("POST", body))).status).toBe(400);
    expect(submitPostExtraction).not.toHaveBeenCalled();
  });
  it("enforces bytes and characters before queue creation", async () => {
    expect((await POST(req("POST", { ...base, text: "x".repeat(8001) }))).status).toBe(413);
    expect((await POST(req("POST", { ...base, unused: "x".repeat(40001) }))).status).toBe(413);
    expect(submitPostExtraction).not.toHaveBeenCalled();
  });
  it("counts actual bytes without trusting Content-Length", async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ ...base, extra: "x".repeat(40001) }))); controller.close(); } });
    const request = new NextRequest("http://localhost/api/portal/events/extract", { method: "POST", headers: { "content-type": "application/json", "content-length": "1" }, body: stream, duplex: "half" } as ConstructorParameters<typeof NextRequest>[1]);
    expect((await POST(request)).status).toBe(413);
    expect(submitPostExtraction).not.toHaveBeenCalled();
  });
  it("meters requests per account before enqueueing", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ ok: false, retryAfterSeconds: 75 });
    const res = await POST(req());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("75");
    expect(checkRateLimit).toHaveBeenCalledWith("event-extract:member@example.test", { limit: 12, windowMs: 600000 });
    expect(submitPostExtraction).not.toHaveBeenCalled();
  });
  it("reads only through the current authenticated subject", async () => {
    const request = new NextRequest(`http://localhost/api/portal/events/extract?id=${base.id}`);
    expect((await GET(request)).status).toBe(200);
    expect(readPostExtraction).toHaveBeenCalledWith(base.id, user);
  });
  it("does not reveal inaccessible requests even to an authenticated caller", async () => {
    vi.mocked(readPostExtraction).mockRejectedValue(new ExtractionUnavailable("This post request is unavailable."));
    expect((await GET(new NextRequest(`http://localhost/api/portal/events/extract?id=${base.id}`))).status).toBe(404);
    expect((await PATCH(req("PATCH", { id: base.id }))).status).toBe(404);
  });
  it("cancels through the scoped helper and returns no-store", async () => {
    const res = await PATCH(req("PATCH", { id: base.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(readPostExtraction).toHaveBeenCalledWith(base.id, user, true);
  });
});
