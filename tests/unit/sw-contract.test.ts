// E13 service-worker contract guard. public/sw.js is a non-module browser
// script with nothing to import, and there is no IndexedDB/CacheStorage in the
// node test environment — so this suite guards it the way
// src/lib/__tests__/embed-guard.test.ts guards the events embed: by asserting
// on its source text.
//
// What is actually being protected here is a privacy floor, not a performance
// one. The worker must never grow a background-sync, periodic-sync, push or
// client-messaging listener (each is a permission surface with no operational
// story behind it), and it must never cache anything under /admin, /portal or
// /api — shared devices are normal in a ferry town, and /api/hunts/photo serves
// admin-only moderation photos.
//
// Every negative rule is API-shaped and anchored. A substring test cannot work:
// `expect(src).not.toContain("sync")` fails on the word "async", which is why
// the table below matches call sites and globals rather than words.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { candidatePageFiles, resolvesToPage } from "../helpers/app-routes";
import { KIOSK_SCREEN_IDS } from "@/lib/kiosk/screens";

const ROOT = process.cwd();
const SRC = readFileSync(path.join(ROOT, "public/sw.js"), "utf8");

// Break-glass mode. The kill-switch runbook (docs/PWA.md §3.2) tells an
// operator to replace this whole file with a tiny self-unregistering worker.
// That worker has no allowlist, no fetch handler and no caching branches, so
// every structural rule below would fail it — and because main requires a green
// `ci` check, a red build means the emergency fix CANNOT BE MERGED. A runbook
// you cannot execute at 9pm during an outage is not a runbook.
//
// So a file carrying this exact sentinel is held to the kill-switch contract
// instead of the normal one. The privacy floor is NOT waived: the FORBIDDEN
// table still runs, so even the emergency worker may not grow a sync, push or
// message listener.
const KILL_SWITCH_SENTINEL = "KILL SWITCH (E13)";
const IS_KILL_SWITCH = SRC.includes(KILL_SWITCH_SENTINEL);

/** Pull a `const NAME = ["a", "b"]` literal out of the worker source. */
function stringArray(name: string): string[] {
  const block = SRC.match(new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  if (!block) throw new Error(`public/sw.js no longer declares a ${name} array`);
  return Array.from(block[1].matchAll(/"([^"]*)"/g), (q) => q[1]);
}

// Placeholders in break-glass mode: the suites that read these are skipped, but
// it.each() still enumerates at collection time and rejects an empty array.
const NAV_ALLOWLIST = IS_KILL_SWITCH ? ["/"] : stringArray("NAV_ALLOWLIST");
const NAV_DENY_PREFIXES = IS_KILL_SWITCH ? [] : stringArray("NAV_DENY_PREFIXES");
const PRECACHE = IS_KILL_SWITCH ? [] : stringArray("PRECACHE");
// E22. Read with the same literal-scraping trick — note stringArray matches the
// FIRST `const NAME = [...]`, so this only works because the two allowlists have
// distinct names rather than one being a prefix of the other.
const KIOSK_NAV_ALLOWLIST = IS_KILL_SWITCH ? ["/kiosk"] : stringArray("KIOSK_NAV_ALLOWLIST");

// Named so a red build names the rule that tripped, not just a line number.
const FORBIDDEN: { name: string; re: RegExp }[] = [
  { name: "background-sync listener", re: /addEventListener\(\s*["'](?:sync|periodicsync)["']/ },
  { name: "push or message listener", re: /addEventListener\(\s*["'](?:push|message)["']/ },
  { name: "SyncManager registration", re: /\bregistration\.sync\b/ },
  { name: "SyncManager reference", re: /\bSyncManager\b/ },
  { name: "periodic background sync", re: /\bperiodicSync\b/ },
  { name: "PushManager reference (capitalised)", re: /\bPushManager\b/ },
  { name: "pushManager reference", re: /\bpushManager\b/ },
  // A prefix match here would swallow /api/ferry/observe and /api/ferry/accuracy,
  // which are state-MUTATING GETs — every offline retry would write to the DB.
  { name: "prefix match on /api/ferry", re: /startsWith\(\s*["']\/api\/ferry/ },
  // addAll is atomic: one 404 rejects the install and the worker silently never
  // activates. Per-entry cache.add().catch() is the only sanctioned form.
  { name: "atomic cache.addAll", re: /\baddAll\s*\(/ },
];

const REQUIRED: { name: string; re: RegExp }[] = [
  { name: "GET-only early return", re: /request\.method\s*!==\s*["']GET["']/ },
  { name: "same-origin guard", re: /url\.origin\s*!==\s*self\.location\.origin/ },
  { name: "skipWaiting on install", re: /\bskipWaiting\s*\(/ },
  { name: "clients.claim on activate", re: /\bclients\.claim\s*\(/ },
  // Exact membership, never a prefix: a prefix on "/events" swallows
  // /events/suggest (admin preview of unpublished events).
  { name: "exact-pathname allowlist membership", re: /NAV_ALLOWLIST\.includes\(/ },
  // Only cache a navigation that really is the page that was asked for. Any
  // allowlisted page can be hidden at runtime by an admin, turning it into a 404.
  { name: "navigation 200-only guard", re: /res\.status\s*===\s*200/ },
  { name: "navigation redirect guard", re: /!\s*res\.redirected\b/ },
  // A 500 from /api/ferry/status is a RESOLVED fetch; without res.ok it would
  // overwrite the last-known-good board with an error body.
  { name: "res.ok guard before caching ferry data", re: /\bres\.ok\b/ },
  { name: "exact /api/ferry/status equality", re: /===\s*FERRY_STATUS_PATH|FERRY_STATUS_PATH\s*=\s*["']\/api\/ferry\/status["']/ },
  { name: "staleness header stamped on the cached copy", re: /["']X-SW-Fetched-At["']/ },
  { name: "versioned cache names", re: /const VERSION\s*=\s*["']v\d+["']/ },
];

// The privacy floor, enforced in BOTH modes — an emergency worker is still a
// worker, and "we were mid-incident" is not a reason to ship a push listener.
describe("public/sw.js privacy floor", () => {
  it.each(FORBIDDEN.map((r) => [r.name, r.re] as const))(
    "does not contain: %s",
    (_name, re) => {
      expect(SRC).not.toMatch(re);
    },
  );
});

describe.runIf(IS_KILL_SWITCH)("public/sw.js kill-switch contract", () => {
  // Only reachable while the break-glass worker is deployed. These assertions
  // are what makes that worker actually recover a browser: without the cache
  // sweep it keeps serving stale HTML, and without unregister() it stays
  // installed and the next deploy has to fight it too.
  it("takes over immediately", () => {
    expect(SRC).toMatch(/\bskipWaiting\s*\(/);
  });

  it("deletes every cache", () => {
    expect(SRC).toMatch(/caches\s*\n?\s*\.?\s*keys\s*\(/);
    expect(SRC).toMatch(/caches\.delete\s*\(/);
  });

  it("unregisters itself", () => {
    expect(SRC).toMatch(/registration\.unregister\s*\(/);
  });

  it("does not serve traffic", () => {
    // A kill switch that still answers fetch events is not a kill switch.
    expect(SRC).not.toMatch(/addEventListener\(\s*["']fetch["']/);
  });
});

describe.skipIf(IS_KILL_SWITCH)("public/sw.js contract", () => {
  it("is a real worker, not an empty file (tripwire for the rules below)", () => {
    // Without this, every not.toMatch() below would pass vacuously on a
    // truncated or accidentally emptied file.
    expect(SRC.length).toBeGreaterThan(500);
    expect(SRC).toContain('addEventListener("fetch"');
    expect(SRC).toContain('addEventListener("install"');
    expect(SRC).toContain('addEventListener("activate"');
  });

  // The FORBIDDEN table lives in the privacy-floor suite above — it applies in
  // both modes, so it must not be gated behind skipIf.

  it.each(REQUIRED.map((r) => [r.name, r.re] as const))("keeps: %s", (_name, re) => {
    expect(SRC).toMatch(re);
  });

  it("checks the private prefixes before any caching branch", () => {
    const denyLine = SRC.indexOf("NAV_DENY_PREFIXES.some");
    const navigateBranch = SRC.indexOf('request.mode === "navigate"');
    const staticBranch = SRC.indexOf("STATIC_PREFIXES.some");
    expect(denyLine).toBeGreaterThan(0);
    // Ordering is the security property: a destination-based static branch
    // running first would put admin-only moderation images into a shared cache.
    expect(denyLine).toBeLessThan(navigateBranch);
    expect(denyLine).toBeLessThan(staticBranch);
  });
});

describe.skipIf(IS_KILL_SWITCH)("public/sw.js allowlists", () => {
  it("denies exactly the private surfaces robots.ts declares", () => {
    expect(NAV_DENY_PREFIXES).toEqual(["/admin", "/portal", "/api"]);
  });

  it("precaches the offline fallback", () => {
    // If /offline is missing from PRECACHE there is no last-resort page, and a
    // failed navigation to an uncached URL falls all the way through.
    expect(PRECACHE).toContain("/offline");
  });

  it("allowlists only pages worth having offline", () => {
    expect(NAV_ALLOWLIST.length).toBeGreaterThanOrEqual(6);
    // /ferry/plan 404s for the public today (prediction flag defaults off), and
    // /webcams and /map are useless offline. Caching any of them is a bug.
    expect(NAV_ALLOWLIST).not.toContain("/ferry/plan");
    expect(NAV_ALLOWLIST).not.toContain("/webcams");
    expect(NAV_ALLOWLIST).not.toContain("/map");
  });

  // The strongest rule in this file, and the one that would have caught both
  // /ferry/plan and a missing /offline automatically: a cached 404 outlives the
  // deploy that caused it, so a dead allowlist entry must be a red build.
  it.each(KIOSK_NAV_ALLOWLIST)("kiosk: %s resolves to a real page.tsx", (route) => {
    // Same rule as the visitor allowlist, and it matters more here: a cached
    // 404 on the kiosk sits on a wall in public with no address bar to correct
    // it, until somebody physically power-cycles the panel.
    expect(
      resolvesToPage(route),
      `${route} matched no page.tsx — looked in:\n  ${candidatePageFiles(route).join("\n  ")}`,
    ).toBe(true);
  });

  it("covers every screen in the kiosk catalogue", () => {
    // The coupling that would otherwise rot in silence. Adding a screen means
    // touching TWO places — src/lib/kiosk/screens.ts and this allowlist — and
    // forgetting the second costs that screen its offline support with nothing
    // failing: it works perfectly on a good network and goes blank on the
    // panel exactly when the venue Wi-Fi drops, which is the one moment nobody
    // is there to notice. Asserted from the catalogue itself, so a new screen
    // fails this the day it lands.
    const missing = KIOSK_SCREEN_IDS.map((id) => `/kiosk/${id}`).filter(
      (route) => !KIOSK_NAV_ALLOWLIST.includes(route),
    );
    expect(
      missing,
      `kiosk screens missing from the service worker allowlist: ${missing.join(", ")}`,
    ).toEqual([]);
    // …and the reverse: an allowlist entry for a screen that no longer exists
    // caches a 404 on a wall nobody can correct.
    const known = new Set<string>(KIOSK_SCREEN_IDS);
    const orphans = KIOSK_NAV_ALLOWLIST.filter(
      (route) => route !== "/kiosk" && !known.has(route.replace("/kiosk/", "")),
    );
    expect(orphans, `allowlisted kiosk routes with no screen: ${orphans.join(", ")}`).toEqual([]);
  });

  it("keeps the kiosk out of the visitor shell cache, and vice versa", () => {
    // The two lists must stay disjoint. If a kiosk path ever appeared in
    // NAV_ALLOWLIST it would be served network-first and, on failure, handed
    // /offline — a page carrying SiteNav, which is a working escape hatch off
    // a locked-down panel. That is a security-shaped bug, not a caching one.
    const overlap = KIOSK_NAV_ALLOWLIST.filter((r) => NAV_ALLOWLIST.includes(r));
    expect(overlap, `kiosk routes must not be in the visitor allowlist: ${overlap}`).toEqual([]);
    expect(NAV_ALLOWLIST.filter((r) => r.startsWith("/kiosk"))).toEqual([]);
  });

  it("evicts a kiosk page when the server starts answering 404", () => {
    // Without this the admin off-switch is a no-op ON THE DEVICE. Turning the
    // kiosk off makes /kiosk 404, but stale-while-revalidate serves the cached
    // copy first and a revalidation that merely declines to store leaves the
    // old page in the cache for ever — the panel keeps showing the directory
    // after staff switched it off, and the admin page gives no hint it did not
    // take. Network-first (the visitor path) does not need this; SWR does.
    const start = SRC.indexOf("async function kioskNavigate");
    const end = SRC.indexOf("\nasync function staticAsset", start);
    const body = SRC.slice(start, end > start ? end : undefined);
    expect(body).toMatch(/res\.status\s*===\s*404/);
    expect(body).toMatch(/dropFromCache\s*\(/);
    expect(SRC).toMatch(/function dropFromCache/);
    expect(SRC).toMatch(/cache\.delete\(/);
  });

  it("gives the kiosk cold-start fallback a way to retry itself", () => {
    // That document REPLACES the app, so none of KioskShell's recovery runs
    // from it — no heartbeat, no freshness reload, no self-heal, because that
    // JS is in a bundle the response does not load. Without a refresh the panel
    // sits there for ever once the network returns and only a human
    // power-cycling the mini PC clears it, which defeats the whole
    // unattended-recovery story the runbook promises.
    const start = SRC.indexOf("async function kioskNavigate");
    const end = SRC.indexOf("\nasync function staticAsset", start);
    const body = SRC.slice(start, end > start ? end : undefined);
    expect(body).toMatch(/http-equiv="refresh"/);
  });

  it("never falls back to /offline for a kiosk navigation", () => {
    // The fallback lives inside kioskNavigate(); assert that function exists and
    // that it does not reach for the shared offline document.
    const start = SRC.indexOf("async function kioskNavigate");
    expect(start, "public/sw.js no longer defines kioskNavigate").toBeGreaterThan(0);
    const end = SRC.indexOf("\nasync function staticAsset", start);
    const body = SRC.slice(start, end > start ? end : undefined);
    expect(body).not.toContain('match("/offline")');
  });

  it.each(NAV_ALLOWLIST)("%s resolves to a real page.tsx", (route) => {
    // Route-group aware since E22: /eat is served by src/app/(site)/eat/page.tsx
    // and /kiosk by src/app/(kiosk)/kiosk/page.tsx. Joining the URL straight
    // onto src/app would now fail for every site route while the worker is
    // perfectly correct — and, worse, would pass for a route that had been
    // deleted from a group but left behind at the root.
    expect(
      resolvesToPage(route),
      `${route} matched no page.tsx — looked in:\n  ${candidatePageFiles(route).join("\n  ")}`,
    ).toBe(true);
  });
});
