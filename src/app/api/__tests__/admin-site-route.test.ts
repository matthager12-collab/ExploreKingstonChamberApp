// /api/admin/site — the two new behaviors on top of the copy/page actions:
//   1. action:"copy" accepts an optional auto-restore date (expiresAt), and
//      rejects a malformed or non-future one with a friendly message;
//   2. action:"request-permanent" files a GitHub issue, or 503s when GitHub is
//      not configured.
// Auth and the GitHub client are mocked; storage is in-memory PGlite, same as
// the other admin-route suites.

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "../../../../tests/setup/pglite-db";

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => null),
  getSessionUser: vi.fn(async () => ({
    id: "u1",
    role: "admin",
    orgId: null,
    editableIds: [],
    entitlements: {},
    name: "Test",
    email: "director@kingstonchamber.com",
  })),
}));

vi.mock("@/lib/github", () => ({
  githubConfigured: vi.fn(() => true),
  createGithubIssue: vi.fn(async () => ({
    url: "https://github.com/acme/repo/issues/7",
    number: 7,
  })),
}));

import { GET, POST } from "@/app/api/admin/site/route";
import { githubConfigured, createGithubIssue } from "@/lib/github";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/admin/site", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

/** A key guaranteed to be in the registry. */
const KEY = "eat.header.intro";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

describe("POST /api/admin/site — auto-restore date on action:copy", () => {
  it("saves an override with a future revert date and reads it back via GET", async () => {
    const res = await post({ action: "copy", key: KEY, text: "Hello", expiresAt: "2999-12-31" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; expiresAt: string | null };
    expect(data.ok).toBe(true);
    expect(data.expiresAt).toBe("2999-12-31");

    const getRes = await GET();
    const got = (await getRes.json()) as {
      copyOverridesDetailed: Record<string, { text: string; expiresAt?: string }>;
      githubEnabled: boolean;
    };
    expect(got.copyOverridesDetailed[KEY]).toEqual({ text: "Hello", expiresAt: "2999-12-31" });
    expect(got.githubEnabled).toBe(true);
  });

  it("rejects a malformed revert date", async () => {
    const res = await post({ action: "copy", key: KEY, text: "Hi", expiresAt: "09/30/2026" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Revert date must be YYYY-MM-DD");
  });

  it("rejects a revert date that isn't in the future", async () => {
    const res = await post({ action: "copy", key: KEY, text: "Hi", expiresAt: "2000-01-01" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Revert date must be in the future");
  });

  it("clears the revert date when omitted on a later save", async () => {
    await post({ action: "copy", key: KEY, text: "Hello", expiresAt: "2999-12-31" });
    const res = await post({ action: "copy", key: KEY, text: "Hello again" });
    expect(res.status).toBe(200);
    const getRes = await GET();
    const got = (await getRes.json()) as {
      copyOverridesDetailed: Record<string, { text: string; expiresAt?: string }>;
    };
    expect(got.copyOverridesDetailed[KEY]).toEqual({ text: "Hello again" });
  });
});

describe("POST /api/admin/site — action:request-permanent", () => {
  it("files a GitHub issue and returns its url", async () => {
    const res = await post({ action: "request-permanent", key: KEY, text: "New wording", note: "please" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; url: string };
    expect(data.ok).toBe(true);
    expect(data.url).toBe("https://github.com/acme/repo/issues/7");
    // The issue body should carry the requested wording and the block's key.
    const arg = vi.mocked(createGithubIssue).mock.calls.at(-1)?.[0];
    expect(arg?.title).toContain(KEY);
    expect(arg?.body).toContain("New wording");
  });

  it("503s when GitHub is not configured", async () => {
    vi.mocked(githubConfigured).mockReturnValueOnce(false);
    const res = await post({ action: "request-permanent", key: KEY, text: "New wording" });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/not set up/i);
  });

  it("rejects an unknown key", async () => {
    const res = await post({ action: "request-permanent", key: "not.a.real.key", text: "x" });
    expect(res.status).toBe(400);
  });
});
