// Parking-zone photos must ROUND-TRIP through the admin API.
//
// Same trap as the curb model (docs/PARKING-PAY-LINKS.md §2, and the suite in
// admin-parking-curb.test.ts): POST /api/admin/parking rebuilds the zone from a
// field whitelist, so a field the handler does not know about is silently WIPED
// by any save — including a save that only dragged a pin. A photo attached
// today and gone after an unrelated edit next week is exactly the bug that
// whitelist has produced before, so `images` gets pinned the same way.
//
// Also covers the gate: `images` becomes an <img src> on a PUBLIC page, so the
// API must accept only shared-library names and never a path.
//
// Pure API drive — no map, no tiles — so it runs everywhere, including keyless CI.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { BASE_URL } from "./config";
import { signInAdmin } from "./admin-session";

// A polygon zone (not a street zone), so this suite never contends with the
// curb suite over the same record.
const ZONE_ID = "diamond-d515";

// Well-formed library names. The bytes need not exist: the API gate is a NAME
// check, and resolveParkingPhotos() drops names the library does not hold — the
// public-render behaviour covered by the unit suite.
const PHOTO_A = "a1b2c3d4e5f60718.jpg";
const PHOTO_B = "0f1e2d3c4b5a6978.webp";

type Zone = {
  id: string;
  name: string;
  rule: string;
  center: [number, number];
  polygon?: [number, number][];
  images?: string[];
};

let browser: Browser;
let context: BrowserContext;
let page: Page;

// API calls go through the PAGE, not context.request: the session cookie is
// Secure (standalone runs NODE_ENV=production) and only Chromium's network
// stack sends it to http://localhost.
async function getZone(id: string): Promise<Zone | undefined> {
  const zones = (await page.evaluate(async () => {
    const res = await fetch("/api/admin/parking");
    if (!res.ok) throw new Error(`GET /api/admin/parking -> ${res.status}`);
    return (await res.json()).zones;
  })) as Zone[];
  return zones.find((z) => z.id === id);
}

async function postZone(zone: unknown): Promise<number> {
  return await page.evaluate(async (z) => {
    const res = await fetch("/api/admin/parking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(z),
    });
    return res.status;
  }, zone as Record<string, unknown>);
}

beforeAll(async () => {
  browser = await chromium.launch();
  context = await browser.newContext();
  await signInAdmin(context);
  page = await context.newPage();
  await page.goto(BASE_URL + "/admin", { waitUntil: "domcontentloaded" });
});

afterAll(async () => {
  await browser?.close();
});

describe("admin parking API — zone photos round-trip", () => {
  it("saves photos and reads them back in the admin's chosen order", async () => {
    const pre = await getZone(ZONE_ID);
    expect(pre, `${ZONE_ID} must exist in the merged zones`).toBeDefined();
    try {
      expect(await postZone({ ...pre, images: [PHOTO_A, PHOTO_B] })).toBe(200);
      const post = await getZone(ZONE_ID);
      // Order is meaningful: the map popup shows images[0] and only images[0].
      expect(post!.images).toEqual([PHOTO_A, PHOTO_B]);
    } finally {
      await postZone(pre);
    }
  });

  it("an unrelated save does NOT wipe the photos (the whitelist trap)", async () => {
    const pre = await getZone(ZONE_ID);
    try {
      expect(await postZone({ ...pre, images: [PHOTO_A] })).toBe(200);
      const withPhoto = await getZone(ZONE_ID);
      expect(withPhoto!.images).toEqual([PHOTO_A]);

      // The editor's ordinary save after, say, nudging the pin: the zone as
      // read, posted straight back.
      expect(await postZone(withPhoto)).toBe(200);
      expect((await getZone(ZONE_ID))!.images).toEqual([PHOTO_A]);
    } finally {
      await postZone(pre);
    }
  });

  it("removing every photo persists as absent, not as a stale list", async () => {
    const pre = await getZone(ZONE_ID);
    try {
      expect(await postZone({ ...pre, images: [PHOTO_A] })).toBe(200);
      expect((await getZone(ZONE_ID))!.images).toEqual([PHOTO_A]);

      // What the editor sends once the admin removes the last photo. An empty
      // array must clear, not be treated as "field absent, keep what you had".
      expect(await postZone({ ...pre, images: [] })).toBe(200);
      expect((await getZone(ZONE_ID))!.images).toBeUndefined();
    } finally {
      await postZone(pre);
    }
  });

  it("de-duplicates a repeated name", async () => {
    const pre = await getZone(ZONE_ID);
    try {
      expect(await postZone({ ...pre, images: [PHOTO_A, PHOTO_A] })).toBe(200);
      expect((await getZone(ZONE_ID))!.images).toEqual([PHOTO_A]);
    } finally {
      await postZone(pre);
    }
  });

  describe("rejects anything that is not a library name", () => {
    const bad: [string, unknown][] = [
      ["a traversal path", ["../../.env"]],
      ["a nested path", ["media/secret.jpg"]],
      ["an absolute URL", ["https://evil.test/x.jpg"]],
      ["a disallowed extension", ["a1b2c3d4e5f60718.svg"]],
      ["a non-array", "a1b2c3d4e5f60718.jpg"],
      ["a non-string member", [123]],
    ];

    for (const [label, images] of bad) {
      it(`400s on ${label}`, async () => {
        const pre = await getZone(ZONE_ID);
        try {
          expect(await postZone({ ...pre, images })).toBe(400);
          // And the rejected save changed nothing.
          expect((await getZone(ZONE_ID))!.images).toBeUndefined();
        } finally {
          await postZone(pre);
        }
      });
    }
  });
});
