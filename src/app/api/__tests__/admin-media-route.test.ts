// /api/admin/media — the shared photo library's upload/edit/delete surface.
//
// The load-bearing claims here are:
//   1. a GPS-tagged photo loses its GPS on the way in (M-16-02 reaches this
//      route too, not just the map-feature one);
//   2. ids are CONTENT hashes of the STRIPPED bytes, so re-uploading the same
//      photo updates one row instead of making a second copy;
//   3. a re-upload never silently wipes alt text somebody already wrote.
//
// Auth is mocked; storage is in-memory PGlite, same as the other admin-route
// suites. Bytes go to a temp DATA_DIR because R2 is not configured in tests, so
// the store takes its filesystem branch.

import { readFileSync, readdirSync } from "fs";
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

// media-store freezes IMAGE_DIR at import time via dataPath(), and ES imports
// are hoisted above any assignment written here — so a DATA_DIR set in this
// file would arrive too late and be silently ignored. tests/setup/unit-env.ts
// already established a scratch dir before any store module loaded; read that
// one rather than racing it.
const DATA_DIR = process.env.DATA_DIR!;

import { DELETE, GET, PATCH, POST } from "@/app/api/admin/media/route";
import { mediaImagePath } from "@/lib/stores/media-store";
import type { MediaItem } from "@/lib/media/refs";

const FIXTURES = path.resolve(__dirname, "../../../../tests/fixtures/images");
const fixtureBytes = (name: string) => readFileSync(path.join(FIXTURES, name));

function upload(bytes: Buffer, filename: string, type: string, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.append("image", new File([new Uint8Array(bytes)], filename, { type }));
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return POST(new NextRequest("http://localhost/api/admin/media", { method: "POST", body: form }));
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

describe("POST /api/admin/media", () => {
  it("stores an upload and returns a content-hashed id", async () => {
    const res = await upload(fixtureBytes("gps.jpg"), "harbor.jpg", "image/jpeg");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; item: MediaItem; duplicate: boolean };
    expect(data.ok).toBe(true);
    expect(data.item.id).toMatch(/^[a-f0-9]{16}\.jpg$/);
    // Title defaults to the filename minus its extension, supplied by the client.
    expect(data.item.title).toBe("harbor.jpg");
    expect(data.duplicate).toBe(false);
  });

  it("strips GPS metadata before the bytes ever hit storage", async () => {
    const res = await upload(fixtureBytes("gps.png"), "tagged.png", "image/png");
    const { item } = (await res.json()) as { item: MediaItem };

    const stored = new Uint8Array(readFileSync(mediaImagePath(item.id)!));
    // The fixtures carry 47°48'0"N 122°30'0"W in every channel their container
    // supports. If any of these survive, a member's home address is being
    // served from the Chamber's own domain.
    for (const sig of ["Exif\0\0", "adobe:ns:meta", "GPSLatitude", "shot at home"]) {
      expect(indexOfBytes(stored, new TextEncoder().encode(sig))).toBe(-1);
    }
  });

  it("re-uploading the same photo reuses the row instead of duplicating it", async () => {
    const bytes = fixtureBytes("gps.webp");
    const first = (await (await upload(bytes, "a.webp", "image/webp")).json()) as {
      item: MediaItem;
    };

    // Give it alt text, the way an admin would after uploading.
    await PATCH(
      new NextRequest("http://localhost/api/admin/media", {
        method: "PATCH",
        body: JSON.stringify({ id: first.item.id, title: "Harbor", alt: "The ferry dock" }),
        headers: { "content-type": "application/json" },
      }),
    );

    // Same bytes, different filename — the exact "did I already add this?" case.
    const second = (await (await upload(bytes, "copy-of-a.webp", "image/webp")).json()) as {
      item: MediaItem;
      duplicate: boolean;
    };

    expect(second.duplicate).toBe(true);
    expect(second.item.id).toBe(first.item.id);
    // The whole point: a re-upload must not blank alt text already written.
    expect(second.item.alt).toBe("The ferry dock");

    const listed = (await (await GET()).json()) as { items: MediaItem[] };
    expect(listed.items.filter((i) => i.id === first.item.id)).toHaveLength(1);
  });

  it("rejects a type that is not an allowed image", async () => {
    const res = await upload(Buffer.from("%PDF-1.4"), "menu.pdf", "application/pdf");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/JPEG, PNG, WebP, or GIF/);
  });

  it("rejects an empty file", async () => {
    const res = await upload(Buffer.alloc(0), "empty.jpg", "image/jpeg");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/empty/);
  });

  it("rejects a file whose container cannot be parsed, rather than storing it intact", async () => {
    // Fail-closed: a JPEG magic number followed by junk. Storing this would
    // mean storing metadata we could not prove was removed.
    const res = await upload(
      Buffer.from([0xff, 0xd8, 0x00, 0x01, 0x02, 0x03]),
      "broken.jpg",
      "image/jpeg",
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/could not be read/);
  });
});

describe("PATCH /api/admin/media", () => {
  it("edits details and requires a name", async () => {
    const { item } = (await (
      await upload(fixtureBytes("gps.gif"), "g.gif", "image/gif")
    ).json()) as { item: MediaItem };

    const ok = await PATCH(
      new NextRequest("http://localhost/api/admin/media", {
        method: "PATCH",
        body: JSON.stringify({
          id: item.id,
          title: "Sunset",
          alt: "Sun setting behind the ferry",
          credit: "J. Doe",
        }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(ok.status).toBe(200);
    const saved = (await ok.json()) as { item: MediaItem };
    expect(saved.item.alt).toBe("Sun setting behind the ferry");
    expect(saved.item.credit).toBe("J. Doe");

    const bad = await PATCH(
      new NextRequest("http://localhost/api/admin/media", {
        method: "PATCH",
        body: JSON.stringify({ id: item.id, title: "   " }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(bad.status).toBe(400);
  });

  it("404s an unknown id", async () => {
    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/media", {
        method: "PATCH",
        body: JSON.stringify({ id: "deadbeefdeadbeef.jpg", title: "x" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/admin/media", () => {
  it("removes the row but keeps the bytes, so an audit restore is not broken", async () => {
    const { item } = (await (
      await upload(fixtureBytes("gps.jpg"), "bye.jpg", "image/jpeg")
    ).json()) as { item: MediaItem };

    const res = await DELETE(
      new NextRequest(`http://localhost/api/admin/media?id=${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(200);

    const listed = (await (await GET()).json()) as { items: MediaItem[] };
    expect(listed.items.some((i) => i.id === item.id)).toBe(false);

    // Bytes deliberately retained — see deleteMediaItem's comment.
    expect(readdirSync(path.join(DATA_DIR, "media"))).toContain(item.id);
  });
});

describe("mediaImagePath", () => {
  it("refuses traversal, separators, and unknown extensions", () => {
    for (const bad of [
      "",
      "../../etc/passwd",
      "sub/dir/abc123.jpg",
      "abc123.svg",
      "abc123",
      "..%2Fabc123.jpg",
      "nothex.jpg",
    ]) {
      expect(mediaImagePath(bad)).toBeNull();
    }
    expect(mediaImagePath("abcdef0123456789.jpg")).toContain("abcdef0123456789.jpg");
  });
});
