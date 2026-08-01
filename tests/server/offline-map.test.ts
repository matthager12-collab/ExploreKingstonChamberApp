// E31 Phase 7 (charter AC 9) — the END-TO-END offline-map proof.
//
// tests/unit/sw-contract.test.ts pins the worker's SOURCE (the precache list,
// the 206/Content-Range machinery, the byte budget). This file proves the
// actual promise: a visitor who loaded /parking once, then lost the network
// entirely, reloads and still gets a map with real basemap tiles on it.
//
// "Lost the network" is not an emulation flag here. The suite boots its OWN
// standalone server (port 3106, so the shared 3105 server keeps serving the
// other suites) and then KILLS it mid-test — every later request meets a dead
// socket, which is the E13/E26 precedent for honest offline claims and does
// not depend on Chromium's offline emulation reaching service-worker fetches.
// context.setOffline(true) is ALSO applied, but only for its side effect of
// flipping navigator.onLine, which is the signal basemapArchiveUrl() reads to
// pick the precached slice.
//
// Why the assertion is queryRenderedFeatures and not a screenshot: the style's
// background layer paints with zero tiles, so "the canvas is not blank" proves
// nothing. Features from the vector source's own layers (roads, water) can
// only exist if PMTiles bytes were fetched, ranged, decoded and rendered — and
// with the server dead, the only possible source of those bytes is the
// worker's precached slice.
//
// Deliberately keyless, like CI: no R2_TILES_* means the ONLINE map here never
// loads tiles at all (the /api/map/tiles proxy 502s). The offline slice is a
// same-origin static file, so the offline path is the one that works — which
// is exactly the claim under test, and nothing else.

import { spawn, type ChildProcess } from "child_process";
import { cpSync, mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { OFFLINE_TILES_PATH } from "../../src/lib/map/basemap";

// Own port: the global-setup server on 3105 must stay up for the other suites.
const PORT = 3106;
const BASE = `http://127.0.0.1:${PORT}`;

let child: ChildProcess | null = null;
let dataDir = "";
let scratchDir = "";
let browser: Browser;
let context: BrowserContext;
let page: Page;

async function serverIsDead(): Promise<boolean> {
  try {
    await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2_000) });
    return false;
  } catch {
    return true;
  }
}

beforeAll(async () => {
  const root = process.cwd();
  // This suite's server runs from a PRIVATE COPY of the standalone bundle, not
  // the checkout's .next/standalone. Two reasons, both learned the hard way:
  //  - the shared 3105 server owns .next/standalone/.next/cache (ISR + fetch
  //    cache); a second process churning the same directory is exactly the
  //    kind of interference the fileParallelism:false rule exists to prevent;
  //  - global-setup's public/ copy happens once per RUN, so serving from the
  //    shared dir means this suite's sw.js could be a stale copy of the file
  //    it exists to test.
  // The cache subtree is excluded from the copy — this server starts cold on
  // purpose (its pages are exercised by exactly one browser).
  scratchDir = mkdtempSync(path.join(os.tmpdir(), "vk-offline-standalone-"));
  const standaloneDir = path.join(scratchDir, "standalone");
  cpSync(path.join(root, ".next", "standalone"), standaloneDir, {
    recursive: true,
    filter: (src) => !src.includes(path.join(".next", "cache")),
  });
  cpSync(path.join(root, ".next", "static"), path.join(standaloneDir, ".next", "static"), {
    recursive: true,
  });
  cpSync(path.join(root, "public"), path.join(standaloneDir, "public"), { recursive: true });
  dataDir = mkdtempSync(path.join(os.tmpdir(), "vk-offline-test-"));

  // Same env recipe as tests/server/global-setup.ts (which has already
  // migrated the schema and seeded the test database this child reads).
  const env: Record<string, string | undefined> = { ...process.env };
  env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  delete env.UPSTASH_REDIS_REST_URL;
  delete env.UPSTASH_REDIS_REST_TOKEN;
  env.PORT = String(PORT);
  env.HOSTNAME = "127.0.0.1";
  env.DATA_DIR = dataDir;
  env.AUTH_SECRET = "vitest-only-secret";
  env.NEXT_TELEMETRY_DISABLED = "1";
  env.NODE_ENV = "production";

  child = spawn("node", ["server.js"], {
    cwd: standaloneDir,
    env: env as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout?.on("data", (d) => (log += String(d)));
  child.stderr?.on("data", (d) => (log += String(d)));

  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.status === 200) {
        ready = true;
        break;
      }
    } catch {
      // not accepting connections yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) {
    child.kill("SIGKILL");
    throw new Error(`offline-map server did not become healthy on :${PORT}.\n${log}`);
  }

  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  // Opt into the map components' test hook (window.__vkMaps) so the suite can
  // reach the MapLibre instance — the same pattern as the admin editor specs.
  await context.addInitScript(() => {
    (window as unknown as { __vkTestHooks?: boolean }).__vkTestHooks = true;
  });
  page = await context.newPage();
});

afterAll(async () => {
  await browser?.close();
  child?.kill("SIGKILL");
  try {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(scratchDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe("offline basemap (E31 Phase 7 / AC 9)", () => {
  it(
    "reloading a map page with the network gone still renders basemap tiles",
    async () => {
      // ---- 1. First visit, online: the worker installs and precaches. -----
      await page.goto(`${BASE}/parking`, { waitUntil: "load" });
      await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, {
        timeout: 60_000,
      });
      // Install fetched the ~1 MB slice; wait until it is really in CacheStorage
      // (cache.add resolves after the worker claims, not before).
      await page.waitForFunction(
        async (p) => (await caches.match(p)) !== undefined,
        OFFLINE_TILES_PATH,
        { timeout: 60_000 },
      );

      // ---- 2. Warm reload, still online and now worker-controlled: this is
      // the load that files /parking into the shell cache and every chunk the
      // map needs into the static cache. -------------------------------------
      await page.reload({ waitUntil: "load" });
      await page.waitForFunction(
        () => ((window as unknown as { __vkMaps?: unknown[] }).__vkMaps?.length ?? 0) > 0,
        undefined,
        { timeout: 60_000 },
      );
      await page.waitForFunction(async () => (await caches.match("/parking")) !== undefined, undefined, {
        timeout: 60_000,
      });

      // ---- 3. Kill the network for real. -----------------------------------
      // setOffline flips navigator.onLine (what basemapArchiveUrl() reads);
      // killing the server guarantees no request can be answered by anything
      // but the worker, whatever the emulation does or does not cover.
      await context.setOffline(true);
      child!.kill("SIGKILL");
      await expect.poll(serverIsDead, { timeout: 15_000 }).toBe(true);

      // ---- 4. The offline reload under test. -------------------------------
      await page.reload({ waitUntil: "load" });

      // The page itself came from the shell cache.
      await page.waitForSelector('[role="region"][aria-label^="Map:"]', { timeout: 30_000 });

      // Tripwire that the harness is honest: a deny-prefix path is never
      // intercepted, so this fetch reaches (only) the network — it must FAIL.
      const healthFailed = await page.evaluate(async () => {
        try {
          await fetch("/api/health");
          return false;
        } catch {
          return true;
        }
      });
      expect(healthFailed, "/api/health resolved — the 'offline' network is not actually gone").toBe(
        true,
      );

      // The worker serves honest ranges from the precached slice: 206, correct
      // Content-Range, and the PMTiles v3 magic in the first seven bytes.
      const probe = await page.evaluate(async (p) => {
        const res = await fetch(p, { headers: { range: "bytes=0-6" } });
        return {
          status: res.status,
          contentRange: res.headers.get("Content-Range"),
          magic: new TextDecoder().decode(await res.arrayBuffer()),
        };
      }, OFFLINE_TILES_PATH);
      expect(probe.status).toBe(206);
      expect(probe.contentRange).toMatch(/^bytes 0-6\/\d+$/);
      expect(probe.magic).toBe("PMTiles");

      // And the map actually painted vector features from those bytes: rendered
      // features on the basemap source's own layers (roads/water/earth) cannot
      // exist unless tiles were fetched, range-served, decoded and drawn.
      // NOTE the single-argument form: `queryRenderedFeatures({ layers })` is
      // the whole-viewport query. The two-argument `(undefined, { layers })`
      // form silently returns [] in maplibre v4 — it cost this test its first
      // green run, so it is named here.
      await page.waitForFunction(
        () => {
          const maps = (window as unknown as {
            __vkMaps?: {
              isStyleLoaded(): boolean;
              getLayer(id: string): unknown;
              queryRenderedFeatures(options?: { layers: string[] }): unknown[];
            }[];
          }).__vkMaps;
          const m = maps?.[maps.length - 1];
          if (!m || !m.isStyleLoaded()) return false;
          const layers = ["roads", "water", "earth", "buildings"].filter((l) => m.getLayer(l));
          return m.queryRenderedFeatures({ layers }).length > 0;
        },
        undefined,
        { timeout: 60_000 },
      );

      const rendered = await page.evaluate(() => {
        const maps = (window as unknown as {
          __vkMaps?: {
            queryRenderedFeatures(options?: { layers: string[] }): unknown[];
            getLayer(id: string): unknown;
          }[];
        }).__vkMaps!;
        const m = maps[maps.length - 1];
        const count = (l: string) =>
          m.getLayer(l) ? m.queryRenderedFeatures({ layers: [l] }).length : 0;
        return { roads: count("roads"), water: count("water") };
      });
      // Downtown Kingston without roads would be a decode failure, not a map.
      expect(rendered.roads).toBeGreaterThan(0);
    },
    240_000,
  );
});
