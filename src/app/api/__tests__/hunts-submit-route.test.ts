import { mkdir, truncate, unlink, writeFile } from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// E05: hunt submissions are Postgres-only — run over PGlite.
import { createTestDb, type TestDb } from "../../../../tests/setup/pglite-db";
import { dataPath } from "@/lib/data-dir";
import { MAX_PHOTO_STORAGE_BYTES, invalidatePhotoStorageCache } from "@/lib/hunt-store";
import { POST } from "@/app/api/hunts/submit/route";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function emptyPost(ip: string) {
  return POST(
    new NextRequest("http://localhost/api/hunts/submit", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
    }),
  );
}

function submitPost(ip: string) {
  const form = new FormData();
  form.set("photo", new File([TINY_PNG], "photo.png", { type: "image/png" }));
  form.set("huntId", "downtown-discovery");
  form.set("stopId", "dd-ferry-overlook");
  return POST(
    new NextRequest("http://localhost/api/hunts/submit", {
      method: "POST",
      body: form,
      headers: { "x-forwarded-for": ip },
    }),
  );
}

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

describe("POST /api/hunts/submit abuse controls", () => {
  it("rate-limits before body parsing: 5 400s then a 429 from one IP", async () => {
    const ip = "203.0.113.30";
    for (let i = 0; i < 5; i++) {
      const res = await emptyPost(ip);
      expect(res.status).toBe(400);
    }
    const sixth = await emptyPost(ip);
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("Retry-After")).toBeTruthy();
  });

  it("returns 507 when photo storage is over quota, and succeeds once cleared", async () => {
    const dummyPath = dataPath("hunts", "photos", "___quota-filler.bin");
    await mkdir(path.dirname(dummyPath), { recursive: true });
    await writeFile(dummyPath, "");
    await truncate(dummyPath, MAX_PHOTO_STORAGE_BYTES + 1);
    invalidatePhotoStorageCache();

    const overQuota = await submitPost("203.0.113.31");
    expect(overQuota.status).toBe(507);

    await unlink(dummyPath);
    invalidatePhotoStorageCache();

    const ok = await submitPost("203.0.113.32");
    expect(ok.status).toBe(200);
    expect((await ok.json()).ok).toBe(true);
  });

  afterAll(async () => {
    await unlink(dataPath("hunts", "photos", "___quota-filler.bin")).catch(() => {});
  });
});
