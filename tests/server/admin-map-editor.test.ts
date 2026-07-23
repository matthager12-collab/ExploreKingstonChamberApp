// E32a regression spec — the parking-zone editor on MapLibre + terra-draw
// (V-2 of the epic's verification ladder; V-1 is the human interactive
// checklist).
//
// The one invariant this suite exists to guard is the wire format
// (FR-EDIT-06): a save must emit stored [lat,lng] OPEN rings, r6-rounded —
// byte-identical when the geometry was not touched. A regression here silently
// corrupts the data every public map renders, so it is asserted through a real
// browser drive of the editor, not a unit test.
//
// The interactive tests need the self-hosted vector tiles (the map's `load`
// gates the editor's controls). CI is keyless (no R2_TILES_*), so when the
// tiles route cannot serve, those tests SKIP — visibly, not silently — and the
// V-1 checklist plus a local run with tiles cover them. The page-shell test
// always runs.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { BASE_URL } from "./config";

const ZONE_ID = "port-free-2hr-row";
const ZONE_NAME = "Free 2-hour row (Mike Wallace Park)";

type Zone = {
  id: string;
  name: string;
  center: [number, number];
  polygon?: [number, number][];
};

let browser: Browser;
let context: BrowserContext;
let page: Page;
let tilesAvailable = false;

// API calls go through the PAGE (not context.request): the session cookie is
// Secure (the standalone server runs NODE_ENV=production), and only Chromium's
// network stack grants localhost the trustworthy-origin exemption that sends
// it over plain http — Playwright's request-context jar does not.
async function getZone(id: string): Promise<Zone | undefined> {
  const zones = (await page.evaluate(async () => {
    const res = await fetch("/api/admin/parking");
    if (!res.ok) throw new Error(`GET /api/admin/parking -> ${res.status}`);
    return (await res.json()).zones;
  })) as Zone[];
  return zones.find((z) => z.id === id);
}

async function putZone(zone: Zone): Promise<void> {
  const status = await page.evaluate(async (z) => {
    const res = await fetch("/api/admin/parking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(z),
    });
    return res.status;
  }, zone);
  expect(status).toBe(200);
}

/** Load /admin/map and wait for the map (and terra-draw) to come up. */
async function openEditor(): Promise<void> {
  await page.goto(BASE_URL + "/admin/map", { waitUntil: "load" });
  await page.waitForSelector("text=" + ZONE_NAME, { timeout: 15_000 });
  // "Draw new zone" enables only after the MapLibre load event + terra-draw
  // start — it is the editor's own readiness signal.
  await page.waitForSelector('button:has-text("Draw new zone"):not([disabled])', {
    timeout: 30_000,
  });
  await page
    .locator('[aria-label="Editable map of Kingston parking zones"]')
    .scrollIntoViewIfNeeded();
}

beforeAll(async () => {
  browser = await chromium.launch();
  // Tall viewport: the 460px map sits under page chrome, and mouse events
  // aimed below the viewport's bottom edge silently hit nothing.
  context = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const login = await context.request.post(BASE_URL + "/api/auth/login", {
    data: { email: "ci@example.test", password: "ci-admin-password" },
  });
  if (!login.ok()) throw new Error("admin login for the editor spec must succeed");
  const probe = await context.request.get(BASE_URL + "/api/map/tiles/kingston.pmtiles", {
    headers: { Range: "bytes=0-1023" },
  });
  tilesAvailable = probe.status() === 206 || probe.status() === 200;
  if (!tilesAvailable) {
    console.warn(
      "[admin-map-editor] vector tiles unavailable (no R2_TILES_*) — interactive tests skip; " +
        "run locally with tiles, and the E32 V-1 checklist covers the gap",
    );
  }
  page = await context.newPage();
  page.on("dialog", (d) => void d.accept());
  page.on("console", (m) => {
    if (m.type() === "error") console.warn("[page console.error]", m.text());
  });
  page.on("pageerror", (e) => console.warn("[pageerror]", e.message));
});

afterAll(async () => {
  await browser?.close();
});

describe("admin parking-zone editor (MapLibre + terra-draw)", () => {
  it("renders the editor shell with the zone list", async () => {
    await page.goto(BASE_URL + "/admin/map", { waitUntil: "load" });
    await page.waitForSelector("text=" + ZONE_NAME, { timeout: 15_000 });
    expect(await page.locator('button:has-text("Draw new zone")').count()).toBe(1);
    // No Leaflet/geoman remnants in the served page.
    const html = await page.content();
    expect(html).not.toContain("tile.openstreetmap.org");
  });

  it("pin drag saves a moved center and round-trips the polygon byte-identically", async (ctx) => {
    if (!tilesAvailable) return ctx.skip();
    await openEditor();
    const pre = await getZone(ZONE_ID);
    expect(pre?.polygon?.length).toBeGreaterThanOrEqual(3);
    try {
      await page.click(`li button:has-text("${ZONE_NAME}")`);
      const pin = page.locator(".pe-pin--selected");
      // The wrapper is 0x0 (anchor center), which Playwright reports as
      // "hidden" — wait for attachment and read the anchor point directly.
      await pin.waitFor({ state: "attached", timeout: 10_000 });
      // Selection fitBounds ANIMATES; drag only once the pin stops moving.
      const box = await pin.evaluate(async (el) => {
        const at = () => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y };
        };
        let prev = at();
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 150));
          const cur = at();
          if (Math.abs(cur.x - prev.x) < 0.5 && Math.abs(cur.y - prev.y) < 0.5) return cur;
          prev = cur;
        }
        return prev;
      });
      await page.mouse.move(box.x, box.y);
      await page.mouse.down();
      await page.waitForTimeout(120); // let the marker's drag state arm
      for (let i = 1; i <= 10; i++) {
        await page.mouse.move(box.x + 4 * i, box.y + 3 * i);
        await page.waitForTimeout(30);
      }
      await page.mouse.up();

      try {
        await page.waitForSelector("text=Unsaved changes", { timeout: 5_000 });
      } catch (err) {
        await page.screenshot({ path: "/tmp/e32-drag-fail.png" });
        throw err;
      }
      await page.click('button:has-text("Save zone")');
      await page.waitForSelector("text=Saved — live on /parking", { timeout: 10_000 });

      const post = await getZone(ZONE_ID);
      expect(post).toBeDefined();
      // The center moved (the drag), the ring did not (nothing touched it):
      // same open [lat,lng] vertices, no closing duplicate, no axis flip.
      expect(post!.center).not.toEqual(pre!.center);
      expect(post!.polygon).toEqual(pre!.polygon);
      // r6 wire rounding on the moved center.
      for (const c of post!.center) expect(c).toBe(Math.round(c * 1e6) / 1e6);
    } finally {
      if (pre) await putZone(pre); // restore the seed geometry for later suites
    }
  });

  it("draws, saves, and deletes a new zone through the full API loop", async (ctx) => {
    if (!tilesAvailable) return ctx.skip();
    await openEditor();
    const map = page.locator('[aria-label="Editable map of Kingston parking zones"]');
    const mb = (await map.boundingBox())!;

    // Pick a pin-free region: a click that lands on a zone pin selects the
    // zone (its element stops propagation), silently disarming the draw.
    const region = await page.evaluate(({ w, h }) => {
      const el = document.querySelector('[aria-label="Editable map of Kingston parking zones"]')!;
      const base = el.getBoundingClientRect();
      const pins = [...document.querySelectorAll(".pe-pin")].map((p) => {
        const r = p.getBoundingClientRect();
        return { x: r.x + r.width / 2 - base.x, y: r.y + r.height / 2 - base.y };
      });
      const BOX = 120;
      for (let fy = 0.15; fy <= 0.75; fy += 0.1) {
        for (let fx = 0.1; fx <= 0.8; fx += 0.1) {
          const x0 = w * fx;
          const y0 = h * fy;
          const clear = !pins.some(
            (p) => p.x > x0 - 25 && p.x < x0 + BOX + 25 && p.y > y0 - 25 && p.y < y0 + BOX + 25,
          );
          if (clear) return { x0, y0 };
        }
      }
      return { x0: w * 0.1, y0: h * 0.15 }; // fall back to the corner
    }, { w: mb.width, h: mb.height });

    await page.click('button:has-text("Draw new zone")');
    const at = (dx: number, dy: number) =>
      [mb.x + region.x0 + dx, mb.y + region.y0 + dy] as const;
    const corners = [at(0, 0), at(110, 10), at(70, 90)];
    // Deliberate pacing: the terra-draw adapter discriminates double-clicks,
    // so back-to-back synthetic clicks get partially swallowed.
    for (const [x, y] of corners) {
      await page.mouse.click(x, y);
      await page.waitForTimeout(400);
    }
    await page.mouse.click(...corners[0]); // click the first corner to finish

    try {
      await page.waitForSelector("text=Shape drawn", { timeout: 8_000 });
    } catch (err) {
      await page.screenshot({ path: "/tmp/e32-draw-fail.png" });
      throw err;
    }
    const idText = await page.locator("p:has-text('Editing') span").first().textContent();
    const newId = idText?.trim() ?? "";
    expect(newId.startsWith("zone-")).toBe(true);

    await page.click('button:has-text("Save zone")');
    await page.waitForSelector("text=Saved — live on /parking", { timeout: 10_000 });
    const saved = await getZone(newId);
    expect(saved?.name).toBe("New zone");
    expect(saved?.polygon?.length).toBe(3);

    await page.click('button:has-text("Delete zone")'); // dialog auto-accepted
    await page.waitForSelector(`text=Deleted "New zone"`, { timeout: 10_000 });
    expect(await getZone(newId)).toBeUndefined();
  });
});
