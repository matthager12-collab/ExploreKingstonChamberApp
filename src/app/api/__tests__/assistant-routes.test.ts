import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getSessionUser: vi.fn(),
  createResearch: vi.fn(),
  listResearch: vi.fn(),
  reviewResearch: vi.fn(),
  claimResearch: vi.fn(),
  finishResearch: vi.fn(),
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
