import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasAnyUsers } from "@/lib/auth";
import { POST } from "@/app/api/auth/setup/route";

function post(ip: string, body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/auth/setup", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
    }),
  );
}

const VALID_FIELDS = { email: "admin@example.com", name: "Admin", password: "password123" };

describe("POST /api/auth/setup fail-closed bootstrap", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("403s a valid body when SETUP_TOKEN is unset", async () => {
    vi.stubEnv("SETUP_TOKEN", "");
    const res = await post("203.0.113.40", VALID_FIELDS);
    expect(res.status).toBe(403);
  });

  it("403s without/with the wrong token, once SETUP_TOKEN is set", async () => {
    vi.stubEnv("SETUP_TOKEN", "tok-123");

    const missing = await post("203.0.113.41", VALID_FIELDS);
    expect(missing.status).toBe(403);

    const wrong = await post("203.0.113.42", { ...VALID_FIELDS, setupToken: "wrong" });
    expect(wrong.status).toBe(403);
  });

  it("succeeds with the correct token, and locks out further setup afterward", async () => {
    vi.stubEnv("SETUP_TOKEN", "tok-123");

    const ok = await post("203.0.113.43", { ...VALID_FIELDS, setupToken: "tok-123" });
    expect(ok.status).toBe(200);
    expect(await hasAnyUsers()).toBe(true);

    const again = await post("203.0.113.44", {
      ...VALID_FIELDS,
      email: "second@example.com",
      setupToken: "tok-123",
    });
    expect(again.status).toBe(403);
    expect((await again.json()).error).toMatch(/already completed/);
  });
});
