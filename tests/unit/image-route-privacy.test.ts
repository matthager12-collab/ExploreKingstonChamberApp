// E15 slice 1 — the image-serving routes under R2, with NO filesystem present.
//
// This is the privacy half of the R2 move. Under the old public-blob mode a
// stored photo could be a full public URL, and the route serving it skipped
// its admin check for URL values entirely — "unguessable but public", as that
// route's own comment admitted. With a PRIVATE bucket the stored value stays
// the fs-relative "photos/…" string, so the gate applies on every read. These
// tests are what keep that true.
//
// The scavenger hunt was the original case here; it was removed on 2026-09-22
// and its cases went with it, leaving the map image route to hold the line.
//
// Hermetic: dummy R2_IMAGES_* env plus a stubbed fetch standing in for the
// bucket. No DATA_DIR files are created, so any 200 here was served from R2.

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState: { admin: boolean } = { admin: false };

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () =>
    authState.admin ? null : new Response("Unauthorized", { status: 401 }),
  ),
  getSessionUser: vi.fn(async () => (authState.admin ? { role: "admin" } : null)),
}));

import { putObject } from "@/lib/blob-store";
import { GET as mapImageGet } from "@/app/api/map/image/route";

const ENDPOINT = "https://acct123.r2.cloudflarestorage.com";
const BUCKET = "explore-kingston-images-test";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let bucket: Map<string, { bytes: Uint8Array; contentType: string }>;

beforeEach(async () => {
  authState.admin = false;
  vi.stubEnv("R2_IMAGES_ENDPOINT", ENDPOINT);
  vi.stubEnv("R2_IMAGES_BUCKET", BUCKET);
  vi.stubEnv("R2_IMAGES_ACCESS_KEY_ID", "test-access-key");
  vi.stubEnv("R2_IMAGES_SECRET_ACCESS_KEY", "test-secret-key");

  bucket = new Map();
  vi.stubGlobal("fetch", async (input: Request | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const key = new URL(req.url).pathname
      .replace(`/${BUCKET}/`, "")
      .split("/")
      .map(decodeURIComponent)
      .join("/");
    if (req.method === "PUT") {
      bucket.set(key, {
        bytes: new Uint8Array(await req.arrayBuffer()),
        contentType: req.headers.get("content-type") ?? "",
      });
      return new Response(null, { status: 200 });
    }
    const hit = bucket.get(key);
    if (!hit) return new Response("no such key", { status: 404 });
    return new Response(hit.bytes as BodyInit, {
      status: 200,
      headers: { "Content-Type": hit.contentType },
    });
  });

  await putObject("map/images/abcdef0123456789.jpg", PNG, "image/jpeg");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const get = (route: string, p: string) =>
  new NextRequest(`http://localhost${route}?p=${encodeURIComponent(p)}`);

/** A private bucket must never surface in anything a visitor can see. */
async function expectNoBucketLeak(res: Response) {
  const headers = JSON.stringify(Object.fromEntries(res.headers));
  expect(headers).not.toContain("r2.cloudflarestorage.com");
  expect(headers).not.toContain("r2.dev");
  expect(headers).not.toContain(BUCKET);
  if (res.headers.get("content-type")?.startsWith("image/")) return;
  const body = await res.clone().text();
  expect(body).not.toContain("r2.cloudflarestorage.com");
  expect(body).not.toContain("r2.dev");
  expect(body).not.toContain(BUCKET);
}

describe("/api/map/image — public, cacheable, R2-backed", () => {
  it("serves a feature image with the documented cache header", async () => {
    const res = await mapImageGet(get("/api/map/image", "abcdef0123456789.jpg"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it("404s an invalid or traversing name", async () => {
    for (const bad of ["../secret.jpg", "no-slashes/allowed.jpg", "short.jpg", "abcdef0123456789.exe"]) {
      const res = await mapImageGet(get("/api/map/image", bad));
      expect(res.status, `${bad} was not rejected`).toBe(404);
    }
  });
});
