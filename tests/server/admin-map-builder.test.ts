// E32b regression spec — the Map Builder (admin/maps) on MapLibre + terra-draw
// (V-2 of the epic's verification ladder; V-1 is the human interactive
// checklist). Companion to admin-map-editor.test.ts, which documents the
// harness quirks (Secure-cookie jar, viewport height, click pacing).
//
// Guards here: the editor shell renders with no Leaflet/OSM remnants; a
// no-touch save round-trips a trail's [lat,lng] open PATH byte-identically
// (the LineString face of FR-EDIT-06); and the draw-marker → save → delete
// loop hits the real admin API. When the tiles route has no R2_TILES_*
// (keyless CI), the committed fixture archive serves the tiles via route
// interception instead, so the interactive tests run everywhere; the visible
// skip remains only if the fixture is also missing.

import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
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
  cost?: string;
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

/** A map-relative point clear of existing pins — a click landing on an
 *  editable marker selects it (its element stops propagation) and silently
 *  disarms the draw. */
async function clearSpot(mb: { width: number; height: number }): Promise<{ x: number; y: number }> {
  return page.evaluate(({ w, h }) => {
    const el = document.querySelector('[aria-label="Editable map canvas for the selected view"]')!;
    const base = el.getBoundingClientRect();
    const pins = [...document.querySelectorAll(".me-pin")].map((p) => {
      const r = p.getBoundingClientRect();
      return { x: r.x + r.width / 2 - base.x, y: r.y + r.height / 2 - base.y };
    });
    for (let fy = 0.2; fy <= 0.6; fy += 0.1) {
      for (let fx = 0.15; fx <= 0.6; fx += 0.1) {
        const x = w * fx;
        const y = h * fy;
        if (!pins.some((p) => Math.hypot(p.x - x, p.y - y) < 40)) return { x, y };
      }
    }
    return { x: w * 0.25, y: h * 0.3 };
  }, { w: mb.width, h: mb.height });
}

/** Screen coords of a lng/lat, via the map exposed under the test hook. */
async function atLngLat(lngLat: [number, number]): Promise<{ x: number; y: number }> {
  return page.evaluate((ll) => {
    const w = window as unknown as {
      __vkMap?: { project(c: [number, number]): { x: number; y: number }; getContainer(): HTMLElement };
    };
    const p = w.__vkMap!.project(ll);
    const r = w.__vkMap!.getContainer().getBoundingClientRect();
    return { x: r.x + p.x, y: r.y + p.y };
  }, lngLat);
}

/** The selected feature's geometry as terra-draw currently holds it. */
async function drawCoords(id: string): Promise<[number, number][]> {
  return page.evaluate((fid) => {
    const w = window as unknown as {
      __vkDraw?: { getSnapshotFeature(i: string): { geometry: { type: string; coordinates: unknown } } | undefined };
    };
    const g = w.__vkDraw!.getSnapshotFeature(fid)!.geometry;
    return (g.type === "Polygon" ? (g.coordinates as number[][][])[0] : g.coordinates) as [number, number][];
  }, id);
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
  // Local escape hatch (E31 P7): serve a kingston.pmtiles via route
  // interception so the interactive tests run without R2_TILES_*. Defaults to
  // the committed fixture (tests/fixtures/tiles/kingston.pmtiles, added by
  // #135); PMTILES_FILE still overrides it, e.g. with a fresh prod download.
  const pmtilesFile =
    process.env.PMTILES_FILE ??
    fileURLToPath(new URL("../fixtures/tiles/kingston.pmtiles", import.meta.url));
  if (!tilesAvailable && existsSync(pmtilesFile)) {
    const archive = readFileSync(pmtilesFile);
    await context.route("**/api/map/tiles/*", async (route) => {
      const m = /bytes=(\d+)-(\d+)?/.exec((await route.request().headerValue("range")) ?? "");
      const start = m ? Number(m[1]) : 0;
      const end = m?.[2] ? Math.min(Number(m[2]), archive.length - 1) : archive.length - 1;
      await route.fulfill({
        status: m ? 206 : 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Accept-Ranges": "bytes",
          ...(m ? { "Content-Range": `bytes ${start}-${end}/${archive.length}` } : {}),
          ETag: '"pmtiles-local-fixture"',
        },
        body: archive.subarray(start, end + 1),
      });
    });
    tilesAvailable = true;
  }
  if (!tilesAvailable) {
    console.warn(
      "[admin-map-builder] vector tiles unavailable (no R2_TILES_*) — interactive tests skip; " +
        "run locally with tiles (or set PMTILES_FILE), and the E32 V-1 checklist covers the gap",
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

    const spot = await clearSpot(mb);

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

  it("draws a line, switches it to a trail, and deletes it", async (ctx) => {
    if (!tilesAvailable) return ctx.skip();
    await openBuilder();
    const mb = (await page
      .locator('[aria-label="Editable map canvas for the selected view"]')
      .boundingBox())!;
    const spot = await clearSpot(mb);
    const at = (dx: number, dy: number) =>
      [mb.x + spot.x + dx, mb.y + spot.y + dy] as const;

    await page.click('button:has-text("Draw line")');
    // Paced clicks: the adapter discriminates double-clicks, so back-to-back
    // synthetic clicks get partially swallowed.
    const pts = [at(0, 0), at(90, 25), at(150, 95)];
    for (const [x, y] of pts) {
      await page.mouse.click(x, y);
      await page.waitForTimeout(400);
    }
    await page.mouse.click(...pts[2]); // click the last point again to finish

    await page.waitForSelector("text=Shape drawn", { timeout: 8_000 });
    const newId =
      (await page.locator("span.font-mono").filter({ hasText: /^feat-/ }).first().textContent())?.trim() ?? "";
    expect(newId.startsWith("feat-")).toBe(true);

    try {
      await page.click('button:has-text("Save feature")');
      await page.waitForSelector("text=Saved — live on the public map", { timeout: 10_000 });
      const asLine = await getFeature(newId);
      expect(asLine?.kind).toBe("line");
      expect(asLine?.path?.length).toBeGreaterThanOrEqual(2);
      expect(asLine?.polygon).toBeUndefined(); // exactly one geometry key

      // line -> trail keeps the SAME LineString in the draw store, so the save
      // must fall back to it rather than dropping the path (FR-EDIT-06).
      await page.selectOption("select >> nth=0", "trail");
      await page.click('button:has-text("Save feature")');
      await page.waitForSelector("text=Saved — live on the public map", { timeout: 10_000 });
      const asTrail = await getFeature(newId);
      expect(asTrail?.kind).toBe("trail");
      expect(asTrail?.path).toEqual(asLine!.path); // geometry survived the switch

      await page.click('button:has-text("Delete feature")'); // dialog auto-accepted
      await page.waitForSelector('text=Deleted "New line"', { timeout: 10_000 });
      expect(await getFeature(newId)).toBeUndefined();
    } finally {
      if (await getFeature(newId)) {
        await page.evaluate(
          (id) => fetch(`/api/admin/map-features?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
          newId,
        );
      }
    }
  });

  it("inserts a midpoint and right-click-deletes a vertex on a trail", async (ctx) => {
    if (!tilesAvailable) return ctx.skip();
    const pre = await (async () => {
      await openBuilder();
      return getFeature(TRAIL_ID);
    })();
    try {
      await page.click('button:has-text("Explore Kingston")');
      await page.click('button:has-text("Features (")');
      await page.click(`li button:has-text("${TRAIL_TITLE}")`);
      await page.locator(`input[value="${TRAIL_TITLE}"]`).first().waitFor({ timeout: 10_000 });

      const before = await drawCoords(TRAIL_ID);
      expect(before.length).toBe(pre!.path!.length);

      // Midpoint insert: terra-draw renders midpoints as store features while a
      // feature is selected; click one and the ring gains a vertex.
      const mid = await page.evaluate(() => {
        const w = window as unknown as {
          __vkDraw?: { getSnapshot(): { properties: Record<string, unknown>; geometry: { type: string; coordinates: [number, number] } }[] };
        };
        const m = w.__vkDraw!.getSnapshot().find((f) => f.properties.midPoint);
        return m ? m.geometry.coordinates : null;
      });
      expect(mid, "select mode must render midpoints").not.toBeNull();
      const midPx = await atLngLat(mid as [number, number]);
      await page.mouse.click(midPx.x, midPx.y);
      const afterInsert = await drawCoords(TRAIL_ID);
      expect(afterInsert.length).toBe(before.length + 1);

      // Right-click a vertex to remove it, back to the original count.
      const vtx = await atLngLat(afterInsert[1]);
      await page.mouse.click(vtx.x, vtx.y, { button: "right" });
      const afterDelete = await drawCoords(TRAIL_ID);
      expect(afterDelete.length).toBe(before.length);

      // Both gestures marked the draft dirty, and the edit persists as an OPEN
      // [lat,lng] path of the same length.
      await page.waitForSelector("text=unsaved changes", { timeout: 5_000 });
      await page.click('button:has-text("Save feature")');
      await page.waitForSelector("text=Saved — live on the public map", { timeout: 10_000 });
      const post = await getFeature(TRAIL_ID);
      expect(post!.path!.length).toBe(pre!.path!.length);
      for (const [lat, lng] of post!.path!) {
        expect(lat).toBeGreaterThan(47); // [lat,lng] order, not flipped
        expect(lng).toBeLessThan(-122);
      }
    } finally {
      if (pre) await putFeature(pre); // restore the seed geometry
    }
  });

  // Issue #80: MapFeature.cost. The API whitelists it (E27), but the editor
  // rebuilds its payload from the form draft, so the documented strip trap is
  // the EDITOR forgetting the field — a save must not silently drop it.
  it("round-trips cost at the API layer (runs keyless — no map needed)", async () => {
    await page.goto(BASE_URL + "/admin/maps", { waitUntil: "load" });
    const COST_ID = "e31p7-cost-api-spec";
    try {
      await putFeature({
        id: COST_ID,
        kind: "marker",
        title: "Cost spec pin",
        views: ["explore"],
        cost: "donation",
        point: [47.798, -122.498],
      });
      expect((await getFeature(COST_ID))?.cost).toBe("donation");
      // An invalid value must be dropped, not stored.
      await putFeature({
        id: COST_ID,
        kind: "marker",
        title: "Cost spec pin",
        views: ["explore"],
        cost: "expensive",
        point: [47.798, -122.498],
      });
      expect((await getFeature(COST_ID))?.cost).toBeUndefined();
    } finally {
      await page.evaluate(
        (id) => fetch(`/api/admin/map-features?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
        COST_ID,
      );
    }
  });

  it("editor save preserves cost untouched, and the select can change it", async (ctx) => {
    if (!tilesAvailable) return ctx.skip();
    const COST_ID = "e31p7-cost-ui-spec";
    const TITLE = "Cost UI spec pin";
    try {
      await openBuilder();
      await putFeature({
        id: COST_ID,
        kind: "marker",
        title: TITLE,
        views: ["explore"],
        cost: "free",
        point: [47.796, -122.51],
      });
      // Select it in the builder (fresh load so the new feature is in the list).
      await openBuilder();
      await page.click('button:has-text("Explore Kingston")');
      await page.click('button:has-text("Features (")');
      await page.click(`li button:has-text("${TITLE}")`);
      const title = page.locator(`input[value="${TITLE}"]`).first();
      await title.waitFor({ timeout: 10_000 });
      // .first(): the form body renders twice (overlay ≥lg + block <lg).
      const costSelect = page.locator('label:has-text("Cost for visitors") select').first();
      expect(await costSelect.inputValue()).toBe("free");

      // STRIP TRAP: a save that never touches cost must keep it.
      await title.focus();
      await page.keyboard.press("End");
      await page.keyboard.type("X");
      await page.keyboard.press("Backspace");
      await page.click('button:has-text("Save feature")');
      await page.waitForSelector("text=Saved — live on the public map", { timeout: 10_000 });
      expect((await getFeature(COST_ID))?.cost).toBe("free");

      // And the control actually edits it.
      await costSelect.selectOption("paid");
      await page.click('button:has-text("Save feature")');
      await page.waitForSelector("text=Saved — live on the public map", { timeout: 10_000 });
      expect((await getFeature(COST_ID))?.cost).toBe("paid");
    } finally {
      await page.evaluate(
        (id) => fetch(`/api/admin/map-features?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
        COST_ID,
      );
    }
  });

  it("creates and deletes a view", async (ctx) => {
    if (!tilesAvailable) return ctx.skip();
    await openBuilder();
    const listViews = async () =>
      (await page.evaluate(async () => (await (await fetch("/api/admin/map-views")).json()).views)) as {
        id: string;
        name: string;
      }[];
    const NAME = "E32 spec view";
    let id = "";
    try {
      await page.click('button:has-text("+ New view")');
      await page.fill('input[placeholder="e.g. Food & Drink"]', NAME);
      await page.click('button:has-text("Save view")');
      await page.waitForSelector(`button:has-text("${NAME}")`, { timeout: 10_000 });
      const created = (await listViews()).find((v) => v.name === NAME);
      expect(created, "the view must reach the API").toBeDefined();
      id = created!.id;

      // Saving makes it active, so Edit view targets it.
      await page.click('button:has-text("✎ Edit view")');
      await page.click('button:has-text("Delete view")'); // dialog auto-accepted
      await page.waitForSelector("text=Deleted", { timeout: 10_000 });
      expect((await listViews()).find((v) => v.id === id)).toBeUndefined();
    } finally {
      if (id && (await listViews()).some((v) => v.id === id)) {
        await page.evaluate(
          (vid) => fetch(`/api/admin/map-views?id=${encodeURIComponent(vid)}`, { method: "DELETE" }),
          id,
        );
      }
    }
  });
});
