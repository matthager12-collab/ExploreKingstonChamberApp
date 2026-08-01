// /api/admin/photos — placing library photos into registered slots.
//
// The validation this suite cares about is the kind that only bites in
// production: a slot key nobody renders, or a photo name that is not in the
// library. Both would store cleanly and then show up as a broken image on the
// home page, so the route refuses them rather than letting the renderer cope.

import { readFileSync } from "fs";
import path from "path";
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

import { DELETE, GET, POST } from "@/app/api/admin/photos/route";
import { POST as UPLOAD } from "@/app/api/admin/media/route";
import { resolvePhoto } from "@/lib/photo-resolve";
import { photoSlot } from "@/lib/photo-slots";
import type { MediaItem } from "@/lib/media/refs";

type Ctx = {
  ok?: boolean;
  error?: string;
  overrides: Record<string, { id: string; name: string; alt?: string }>;
  library: Record<string, MediaItem>;
};

const FIXTURES = path.resolve(__dirname, "../../../../tests/fixtures/images");

async function uploadFixture(file: string, type: string): Promise<string> {
  const form = new FormData();
  const bytes = readFileSync(path.join(FIXTURES, file));
  form.append("image", new File([new Uint8Array(bytes)], file, { type }));
  const res = await UPLOAD(
    new NextRequest("http://localhost/api/admin/media", { method: "POST", body: form }),
  );
  return ((await res.json()) as { item: MediaItem }).item.id;
}

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/admin/photos", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );

let tdb: TestDb;
let photoId: string;
beforeAll(async () => {
  tdb = await createTestDb();
  photoId = await uploadFixture("gps.jpg", "image/jpeg");
});
afterAll(async () => {
  await tdb.close();
});

describe("POST /api/admin/photos", () => {
  it("places a library photo in a slot and returns the fresh context", async () => {
    const res = await post({ slot: "home.strip.1", name: photoId });
    expect(res.status).toBe(200);
    const data = (await res.json()) as Ctx;
    expect(data.overrides["home.strip.1"].name).toBe(photoId);

    // The resolved src must go through the proxy, never a bucket URL.
    const resolved = resolvePhoto("home.strip.1", data.overrides["home.strip.1"], data.library);
    expect(resolved.src).toBe(`/api/media/${photoId}`);
  });

  it("stores per-slot alt text, and blank alt clears it rather than pinning an empty string", async () => {
    await post({ slot: "home.strip.2", name: photoId, alt: "  Said   for this spot  " });
    let ctx = (await (await GET()).json()) as Ctx;
    // Whitespace is collapsed, not preserved.
    expect(ctx.overrides["home.strip.2"].alt).toBe("Said for this spot");

    await post({ slot: "home.strip.2", name: photoId, alt: "   " });
    ctx = (await (await GET()).json()) as Ctx;
    // Absent, not "" — so resolveAlt falls through to the library description
    // instead of reading as a deliberate "announce nothing".
    expect(ctx.overrides["home.strip.2"].alt).toBeUndefined();
  });

  it("refuses a slot key that is not in the registry", async () => {
    const res = await post({ slot: "home.nonexistent", name: photoId });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Ctx).error).toBe("Unknown photo slot");
  });

  it("refuses a photo that is not in the library", async () => {
    const res = await post({ slot: "home.strip.1", name: "deadbeefdeadbeef.jpg" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Ctx).error).toBe("That photo is not in the library");
  });

  it("refuses a malformed body", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/admin/photos", {
        method: "POST",
        body: "not json",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/admin/photos", () => {
  it("sends a slot back to the photo the code ships with", async () => {
    await post({ slot: "home.strip.3", name: photoId });
    const res = await DELETE(
      new NextRequest("http://localhost/api/admin/photos?slot=home.strip.3", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as Ctx;
    expect(data.overrides["home.strip.3"]).toBeUndefined();

    // "Reset to default" is only truthful if the default comes from the
    // registry — which is the whole reason the fallbacks moved out of the page.
    const resolved = resolvePhoto("home.strip.3", undefined, data.library);
    expect(resolved.src).toBe(photoSlot("home.strip.3").fallback);
    expect(resolved.alt).toBe(photoSlot("home.strip.3").fallbackAlt);
  });

  it("refuses an unknown slot", async () => {
    const res = await DELETE(
      new NextRequest("http://localhost/api/admin/photos?slot=nope", { method: "DELETE" }),
    );
    expect(res.status).toBe(400);
  });
});
