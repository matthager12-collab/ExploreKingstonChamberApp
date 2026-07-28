// E32b regression spec — the Map Builder (admin/maps) on MapLibre + terra-draw
// (V-2 of the epic's verification ladder; V-1 is the human interactive
// checklist). Companion to admin-map-editor.test.ts, which documents the
// harness quirks (Secure-cookie jar, viewport height, click pacing).
//
// Guards here: the editor shell renders with no Leaflet/OSM remnants; a
// no-touch save round-trips a trail's [lat,lng] open PATH byte-identically
// (the LineString face of FR-EDIT-06); and the draw-marker → save → delete
// loop hits the real admin API. Skips visibly when the tiles route has no
// R2_TILES_* (keyless CI).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { BASE_URL } from "./config";

const TRAIL_ID = "waterfront-boardwalk";
const TRAIL_TITLE = "Waterfront boardwalk stroll";

type Feature = {
  id: string;
  kind: string;
  title: string;
  views: string[];
  point?: [number, number];
  path?: [number, number][];
  polygon?: [number, number][];
};

let browser: Browser;
let context: BrowserContext;
let page: Page;
let tilesAvailable = false;

async function getFeature(id: string): Promise<Feature | undefined> {
  const features = (await page.evaluate(async () => {
    const res = await fetch("/api/admin/map-features");
    if (!res.ok) throw new Error(`GET /api/admin/map-features -> ${res.status}`);
    return (await res.json()).features;
  })) as Feature[];
  return features.find((f) => f.id === id);
}

async function putFeature(feature: Feature): Promise<void> {
  const status = await page.evaluate(async (f) => {
    const res = await fetch("/api/admin/map-features", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(f),
    });
    return res.status;
  }, feature);
  expect(status).toBe(200);
}

async function openBuilder(): Promise<void> {
  await page.goto(BASE_URL + "/admin/maps", { waitUntil: "load" });
  await page.waitForSelector('button:has-text("Draw marker"):not([disabled])', {
    timeout: 30_000,
  });
  await page
    .locator('[aria-label="Editable map canvas for the selected view"]')
    .scrollIntoViewIfNeeded();
}

beforeAll(async () => {
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const login = await context.request.post(BASE_URL + "/api/auth/login", {
    data: { email: "ci@example.test", password: "ci-admin-password" },
  });
  if (!login.ok()) throw new Error("admin login for the builder spec must succeed");
  const probe = await context.request.get(BASE_URL + "/api/map/tiles/kingston.pmtiles", {
    headers: { Range: "bytes=0-1023" },
  });
  tilesAvailable = probe.status() === 206 || probe.status() === 200;
  if (!tilesAvailable) {
    console.warn(
      "[admin-map-builder] vector tiles unavailable (no R2_TILES_*) — interactive tests skip; " +
        "run locally with tiles, and the E32 V-1 checklist covers the gap",
    );
  }
  // Opt into the builder's test hook (window.__vkDraw) so the suite can prove
  // geometry actually entered the terra-draw store (see the editor spec).
  await context.addInitScript(() => {
    (window as unknown as { __vkTestHooks?: boolean }).__vkTestHooks = true;
  });
  page = await context.newPage();
  page.on("dialog", (d) => void d.accept());
});

afterAll(async () => {
  await browser?.close();
});

describe("admin map builder (MapLibre + terra-draw)", () => {
  it("renders the builder shell with the views strip", async () => {
    await page.goto(BASE_URL + "/admin/maps", { waitUntil: "load" });
    await page.waitForSelector("text=Views", { timeout: 15_000 });
    expect(await page.locator('button:has-text("Draw marker")').count()).toBe(1);
    const html = await page.content();
    expect(html).not.toContain("tile.openstreetmap.org");
  });

  it("no-touch save round-trips a trail's stored path byte-identically", async (ctx) => {
    if (!tilesAvailable) return ctx.skip();
    await openBuilder();
    const pre = await getFeature(TRAIL_ID);
    expect(pre?.path?.length).toBeGreaterThanOrEqual(2);
    try {
      // The trail lives on the seeded "trails"/"explore" views.
      await page.click('button:has-text("Explore Kingston")');
      await page.click('button:has-text("Features (")');
      await page.click(`li button:has-text("${TRAIL_TITLE}")`);
      const title = page.locator(`input[value="${TRAIL_TITLE}"]`).first();
      await title.waitFor({ timeout: 10_000 });
      // Non-vacuity guard: the trail must actually be in the draw store
      // (otherwise the path identity below would pass via buildFeature's
      // stored-geometry fallback and prove nothing).
      const inStore = await page.evaluate(
        (id) => (window as unknown as { __vkDraw?: { hasFeature(i: string): boolean } }).__vkDraw?.hasFeature(id),
        TRAIL_ID,
      );
      expect(inStore).toBe(true);
      // Dirty the draft without changing anything: type + undo one character.
      await title.focus();
      await page.keyboard.press("End");
      await page.keyboard.type("X");
      await page.keyboard.press("Backspace");
      await page.click('button:has-text("Save feature")');
      await page.waitForSelector("text=Saved — live on the public map", { timeout: 10_000 });

      const post = await getFeature(TRAIL_ID);
      // Same open [lat,lng] path: no closing vertex grown, no axis flip,
      // no precision drift.
      expect(post!.path).toEqual(pre!.path);
      expect(post!.title).toBe(TRAIL_TITLE);
    } finally {
      if (pre) await putFeature(pre);
    }
  });

  it("draws, saves, and deletes a marker through the full API loop", async (ctx) => {
    if (!tilesAvailable) return ctx.skip();
    await openBuilder();
    const map = page.locator('[aria-label="Editable map canvas for the selected view"]');
    const mb = (await map.boundingBox())!;

    // Pick a pin-free spot: a click landing on an editable marker selects it
    // (its element stops propagation), silently disarming the draw.
    const spot = await page.evaluate(({ w, h }) => {
      const el = document.querySelector('[aria-label="Editable map canvas for the selected view"]')!;
      const base = el.getBoundingClientRect();
      const pins = [...document.querySelectorAll(".me-pin")].map((p) => {
        const r = p.getBoundingClientRect();
        return { x: r.x + r.width / 2 - base.x, y: r.y + r.height / 2 - base.y };
      });
      for (let fy = 0.2; fy <= 0.7; fy += 0.1) {
        for (let fx = 0.15; fx <= 0.8; fx += 0.1) {
          const x = w * fx;
          const y = h * fy;
          if (!pins.some((p) => Math.hypot(p.x - x, p.y - y) < 40)) return { x, y };
        }
      }
      return { x: w * 0.25, y: h * 0.3 };
    }, { w: mb.width, h: mb.height });

    await page.click('button:has-text("Draw marker")');
    await page.mouse.click(mb.x + spot.x, mb.y + spot.y);

    await page.waitForSelector("text=Shape drawn", { timeout: 8_000 });
    const idText = await page
      .locator("span.font-mono")
      .filter({ hasText: /^feat-/ })
      .first()
      .textContent();
    const newId = idText?.trim() ?? "";
    expect(newId.startsWith("feat-")).toBe(true);

    try {
      await page.click('button:has-text("Save feature")');
      await page.waitForSelector("text=Saved — live on the public map", { timeout: 10_000 });
      const saved = await getFeature(newId);
      expect(saved?.kind).toBe("marker");
      expect(saved?.point?.length).toBe(2);
      expect(saved?.views.length).toBeGreaterThanOrEqual(1);

      await page.click('button:has-text("Delete feature")'); // dialog auto-accepted
      await page.waitForSelector('text=Deleted "New marker"', { timeout: 10_000 });
      expect(await getFeature(newId)).toBeUndefined();
    } finally {
      // Never strand a test feature in the shared per-run DB for later suites.
      if (await getFeature(newId)) {
        await page.evaluate(
          (id) => fetch(`/api/admin/map-features?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
          newId,
        );
      }
    }
  });
});
