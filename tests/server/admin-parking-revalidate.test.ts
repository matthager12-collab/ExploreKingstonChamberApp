// An admin parking edit must reach /parking immediately, not in up to a minute.
//
// /parking is prerendered with `revalidate = 60`. Before this, POST
// /api/admin/parking called no `revalidatePath`, so a Chamber admin who fixed a
// rate or attached a photo saw nothing change for up to a minute — which reads
// as "the save failed" and invites a second save. /api/admin/kiosk already
// revalidated; this closes the same gap for parking.
//
// The assertions deliberately read the PUBLIC HTML rather than the admin API:
// the API returning the new value proves the write, not the publish, and the
// publish is the whole point of this suite.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { BASE_URL } from "./config";
import { signInAdmin } from "./admin-session";

const ZONE_ID = "diamond-d515";
// Distinctive enough that it cannot collide with real copy on the page.
const MARKER = "REVALIDATE-PROBE-8f31";

type Zone = { id: string; name: string; summary: string; center: [number, number] };

let browser: Browser;
let context: BrowserContext;
let page: Page;

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

/** The public page's HTML, fetched fresh and WITHOUT the admin cookie — what an
 *  anonymous visitor would be served from the ISR cache right now. */
async function publicParkingHtml(): Promise<string> {
  const res = await fetch(`${BASE_URL}/parking`, { cache: "no-store" });
  expect(res.status).toBe(200);
  return await res.text();
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

describe("admin parking writes publish immediately", () => {
  it("a saved summary is on /parking on the very next request — no ISR wait", async () => {
    const pre = await getZone(ZONE_ID);
    expect(pre, `${ZONE_ID} must exist in the merged zones`).toBeDefined();

    // Prime the cache so the page is genuinely prerendered before the edit —
    // otherwise a first-ever render would mask a missing revalidate.
    const before = await publicParkingHtml();
    expect(before).not.toContain(MARKER);

    try {
      expect(await postZone({ ...pre, summary: `${pre!.summary} ${MARKER}` })).toBe(200);
      // NO waiting, NO retry loop: the point is that one request suffices.
      expect(await publicParkingHtml()).toContain(MARKER);
    } finally {
      await postZone(pre);
    }
  });

  it("and restoring it removes it again, so the fix is not one-way", async () => {
    const pre = await getZone(ZONE_ID);
    try {
      expect(await postZone({ ...pre, summary: `${pre!.summary} ${MARKER}` })).toBe(200);
      expect(await publicParkingHtml()).toContain(MARKER);

      expect(await postZone(pre)).toBe(200);
      expect(await publicParkingHtml()).not.toContain(MARKER);
    } finally {
      await postZone(pre);
    }
  });

  it("a REJECTED save does not disturb the published page", async () => {
    // revalidatePath runs only after a successful write — a validation error
    // must not cost the public site its cached render.
    const pre = await getZone(ZONE_ID);
    const before = await publicParkingHtml();
    expect(before).toContain(pre!.name);

    expect(await postZone({ ...pre, rule: "not-a-real-rule" })).toBe(400);
    const after = await publicParkingHtml();
    expect(after).toContain(pre!.name);
    expect(after).not.toContain(MARKER);
  });
});
