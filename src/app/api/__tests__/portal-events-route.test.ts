import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/portal/events/route";

vi.mock("@/lib/auth", () => ({
  getSessionUser: vi.fn(async () => ({
    id: "u1",
    role: "admin",
    linkedIds: [],
    name: "Test",
    email: "t@t.t",
  })),
  canEdit: vi.fn(() => true),
}));

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/portal/events", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

const BASE = {
  ownerId: "owner-1",
  title: "Farmers Market",
  start: "2026-08-01T15:00",
  category: "market" as const,
};

describe("POST /api/portal/events validation", () => {
  it("drops a javascript: url instead of storing it", async () => {
    const res = await post({ ...BASE, url: "javascript:alert(1)" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.event.url).toBeUndefined();
  });

  it("keeps a well-formed https url", async () => {
    const res = await post({ ...BASE, url: "https://example.com/market" });
    const json = await res.json();
    expect(json.event.url).toBe("https://example.com/market");
  });

  it("caps description at 2000 chars", async () => {
    const res = await post({ ...BASE, description: "x".repeat(3000) });
    const json = await res.json();
    expect((json.event.description as string).length).toBe(2000);
  });

  it("normalizes a naive start into a Pacific-offset instant", async () => {
    const res = await post(BASE);
    const json = await res.json();
    expect(json.event.start).toBe("2026-08-01T15:00:00-07:00");
  });
});
