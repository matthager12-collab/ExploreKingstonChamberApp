import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getSessionUser: vi.fn(),
  createResearch: vi.fn(),
  listResearch: vi.fn(),
  reviewResearch: vi.fn(),
  claimResearch: vi.fn(),
  finishResearch: vi.fn(),
  claimPostExtraction: vi.fn(),
  finishPostExtraction: vi.fn(),
  researchContext: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  requireAdmin: mocks.requireAdmin,
  getSessionUser: mocks.getSessionUser,
}));
vi.mock("@/lib/db/research", () => ({
  ...mocks,
  ResearchConflict: class extends Error {},
}));
vi.mock("@/lib/research/context", () => ({
  researchContext: mocks.researchContext,
}));
vi.mock("@/lib/public-paths", () => ({
  revalidatePublicPathsForStore: vi.fn(),
}));
import { GET, POST, PATCH } from "../portal/assistant/route";
import { POST as worker } from "../assistant-worker/route";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAdmin.mockResolvedValue(null);
  mocks.getSessionUser.mockResolvedValue({ email: "jen@example.org" });
  mocks.researchContext.mockResolvedValue({});
  delete process.env.CHAMBER_RESEARCH_TOKEN;
});
describe("research route authorization", () => {
  it.each([GET, POST, PATCH])(
    "gates every portal operation",
    async (handler) => {
      mocks.requireAdmin.mockResolvedValue(
        Response.json({ error: "forbidden" }, { status: 403 }),
      );
      expect(
        (await handler(new Request("https://app.example/api/portal/assistant")))
          .status,
      ).toBe(403);
      expect(mocks.createResearch).not.toHaveBeenCalled();
      expect(mocks.reviewResearch).not.toHaveBeenCalled();
    },
  );
  it("rejects cross-origin mutation", async () => {
    const response = await POST(
      new Request("https://app.example/api/portal/assistant", {
        method: "POST",
        headers: { origin: "https://evil.example" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.createResearch).not.toHaveBeenCalled();
  });
  it("worker rejects missing configuration and wrong tokens", async () => {
    const request = () =>
      new Request("https://app.example/api/assistant-worker", {
        method: "POST",
        headers: { authorization: "Bearer bad" },
        body: '{"action":"claim"}',
      });
    expect((await worker(request())).status).toBe(401);
    process.env.CHAMBER_RESEARCH_TOKEN = "a".repeat(40);
    expect((await worker(request())).status).toBe(401);
    expect(mocks.claimResearch).not.toHaveBeenCalled();
  });
  it("worker token cannot publish", async () => {
    process.env.CHAMBER_RESEARCH_TOKEN = "a".repeat(40);
    const response = await worker(
      new Request("https://app.example/api/assistant-worker", {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.CHAMBER_RESEARCH_TOKEN}`,
        },
        body: '{"action":"publish"}',
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.reviewResearch).not.toHaveBeenCalled();
  });
});

const targetId = "bfe3cce5-a432-4d1c-9a36-03cd5cc6fc05";
function targeted(body: unknown) {
  process.env.CHAMBER_RESEARCH_TOKEN = "a".repeat(40);
  return worker(new Request("https://app.example/api/assistant-worker", {
    method: "POST", headers: { authorization: `Bearer ${process.env.CHAMBER_RESEARCH_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}
describe("targeted extraction worker operations", () => {
  it("returns only exact-job text/lease and clock without reading admin context", async () => {
    mocks.researchContext.mockRejectedValue(new Error("Must not load private admin context"));
    mocks.claimPostExtraction.mockResolvedValue({ id: targetId, leaseToken: targetId,
      createdBy: "private@example.test", payload: { prompt: "Invented post", extraction: { requesterId: "secret-person", ownerId: "private-listing" }, baseline: { secret: "private map" } } });
    const response = await targeted({ action: "claim-extraction", id: targetId });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.job).toEqual({ id: targetId, leaseToken: targetId, payload: { prompt: "Invented post", extraction: {} } });
    expect(Object.keys(data.context).sort()).toEqual(["now", "timezone"]);
    expect(mocks.claimPostExtraction).toHaveBeenCalledWith(targetId);
    expect(mocks.researchContext).not.toHaveBeenCalled();
    expect(mocks.claimResearch).not.toHaveBeenCalled();
  });
  it("does not fall back when the target is unavailable", async () => {
    mocks.claimPostExtraction.mockResolvedValue(null);
    const response = await targeted({ action: "claim-extraction", id: targetId });
    expect((await response.json()).job).toBeNull();
    expect(mocks.claimResearch).not.toHaveBeenCalled();
    expect(mocks.researchContext).not.toHaveBeenCalled();
  });
  it.each([{ action: "claim-extraction" }, { action: "claim-extraction", id: "bad" }, { action: "claim-extraction", id: targetId, research: true }])("rejects malformed/extra targeted selection fields", async (body) => {
    expect((await targeted(body)).status).toBe(400);
    expect(mocks.claimPostExtraction).not.toHaveBeenCalled();
    expect(mocks.claimResearch).not.toHaveBeenCalled();
    expect(mocks.researchContext).not.toHaveBeenCalled();
  });
  it.each(["complete-extraction", "fail-extraction"])("uses only the typed extractor completion for %s", async (action) => {
    mocks.finishPostExtraction.mockResolvedValue({ id: targetId, state: "review", revision: 3, createdBy: "private@example.test", payload: { prompt: "private" } });
    const response = await targeted({ action, id: targetId, leaseToken: targetId, result: { title: "Draft" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ request: { id: targetId, state: "review", revision: 3 } });
    expect(mocks.finishPostExtraction).toHaveBeenCalledWith(targetId, targetId, { title: "Draft" }, action === "fail-extraction");
    expect(mocks.finishResearch).not.toHaveBeenCalled();
    expect(mocks.researchContext).not.toHaveBeenCalled();
  });
});
