// E31 phase 6 — the admin parking API must ROUND-TRIP the curb model.
//
// The trap (docs/PARKING-PAY-LINKS.md §2): POST /api/admin/parking rebuilds the
// zone from a whitelist, so a field the handler doesn't know about is silently
// WIPED by any save — including a save that only dragged a pin. This suite
// saves a street zone back through the real API and proves `streetPaths` and
// `curb` survive byte-identically, then proves clearing and validation work.
//
// Pure API drive — no map, no tiles — so unlike the terra-draw editor spec it
// runs everywhere, including keyless CI.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { BASE_URL } from "./config";

// The one zone whose curb side is field-verified (PR #78).
const ZONE_ID = "street-washington-blvd-104-loop";

type Zone = {
  id: string;
  name: string;
  rule: string;
  curb?: string;
  streetPaths?: [number, number][][];
  center: [number, number];
};

let browser: Browser;
let context: BrowserContext;
let page: Page;

// API calls go through the PAGE, not context.request: the session cookie is
// Secure (standalone runs NODE_ENV=production) and only Chromium's network
// stack sends it to http://localhost (same constraint as admin-map-editor).
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
  const login = await context.request.post(BASE_URL + "/api/auth/login", {
    data: { email: "ci@example.test", password: "ci-admin-password" },
  });
  if (!login.ok()) throw new Error("admin login for the parking API spec must succeed");
  page = await context.newPage();
  await page.goto(BASE_URL + "/admin", { waitUntil: "domcontentloaded" });
});

afterAll(async () => {
  await browser?.close();
});

describe("admin parking API — curb model round-trip", () => {
  it("a plain save round-trips streetPaths and curb byte-identically (no wipe)", async () => {
    const pre = await getZone(ZONE_ID);
    expect(pre, `${ZONE_ID} must exist in the merged zones`).toBeDefined();
    expect(pre!.curb).toBe("both");
    expect(pre!.streetPaths?.length).toBeGreaterThanOrEqual(1);
    try {
      // The editor's save: the zone as read, posted back untouched.
      expect(await postZone(pre)).toBe(200);
      const post = await getZone(ZONE_ID);
      expect(post!.curb).toBe("both");
      expect(post!.streetPaths).toEqual(pre!.streetPaths);
    } finally {
      await postZone(pre); // restore for later suites regardless
    }
  });

  it("clearing the curb persists as absent, not as a stale value", async () => {
    const pre = await getZone(ZONE_ID);
    expect(pre).toBeDefined();
    try {
      const { curb: _dropped, ...cleared } = pre!;
      expect(await postZone(cleared)).toBe(200);
      const post = await getZone(ZONE_ID);
      expect(post!.curb).toBeUndefined();
      expect(post!.streetPaths).toEqual(pre!.streetPaths); // geometry untouched
    } finally {
      await postZone(pre);
    }
  });

  it("rejects junk instead of persisting it", async () => {
    const pre = await getZone(ZONE_ID);
    expect(pre).toBeDefined();
    expect(await postZone({ ...pre, curb: "left" })).toBe(400);
    expect(await postZone({ ...pre, streetPaths: [] })).toBe(400);
    expect(await postZone({ ...pre, streetPaths: [[[47.797, -122.496]]] })).toBe(400);
    expect(
      await postZone({ ...pre, streetPaths: [[[0, 0], [1, 1]]] }), // outside Kingston
    ).toBe(400);
    // Nothing stuck.
    const post = await getZone(ZONE_ID);
    expect(post!.curb).toBe(pre!.curb);
    expect(post!.streetPaths).toEqual(pre!.streetPaths);
  });
});
