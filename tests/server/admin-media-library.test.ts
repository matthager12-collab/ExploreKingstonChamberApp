// The photo library (/admin/media) driven through a real browser, against the
// standalone build the container actually ships.
//
// The route tests already cover the API contract. What only a browser can prove
// is the part most likely to break silently: the page is a Server Component
// rendering a "use client" grid that imports media helpers, and if those
// helpers ever pull the store (fs/promises) into the client bundle the page
// still TYPECHECKS and still BUILDS — it fails at request time. So this walks
// the actual upload → appears in the grid → gets a description → is removed
// loop, which is exactly what a Chamber staffer does.
//
// Harness quirks are documented in admin-map-editor.test.ts; the relevant one
// here is that the session cookie belongs to the context, so the login goes
// through context.request before any page is created.

import { readFileSync } from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { BASE_URL } from "./config";
import { signInAdmin } from "./admin-session";

let browser: Browser;
let context: BrowserContext;
let page: Page;

const FIXTURE = path.resolve(__dirname, "../fixtures/images/gps.jpg");

/** Deliberately NOT a substring of the editor's placeholder copy. An assertion
 *  that overlaps the placeholder matches an empty form and proves nothing. */
const ALT = "Wooden pier railing with gulls";

beforeAll(async () => {
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  // Minted, not logged in — see tests/server/admin-session.ts (shared
  // login rate-limit budget).
  await signInAdmin(context);
  page = await context.newPage();
  page.on("dialog", (d) => void d.accept());
});

afterAll(async () => {
  await browser?.close();
});

describe("admin photo library", () => {
  it("renders without dragging the server store into the client bundle", async () => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(BASE_URL + "/admin/media", { waitUntil: "load" });
    await page.waitForSelector('text=Add photos', { timeout: 15_000 });

    // A client bundle that reached for fs/promises surfaces here, not at build.
    expect(errors).toEqual([]);
    expect(await page.locator('input[type="file"]').count()).toBe(1);
  });

  it("uploads a photo, shows it in the grid, and flags the missing description", async () => {
    await page.goto(BASE_URL + "/admin/media", { waitUntil: "load" });
    await page.setInputFiles('input[type="file"]', FIXTURE);

    await page.waitForSelector("text=/1 photo added|1 photos added/", { timeout: 20_000 });

    // The uploaded photo is rendered from the proxy route, never from a bucket
    // URL — the private-R2 posture depends on that being the only read path.
    const src = await page.locator('img[src^="/api/media/"]').first().getAttribute("src");
    // Path segment, no query string — next/image refuses a local src carrying
    // one, and the page rendering it 500s. Pinned here so the shape cannot
    // drift back; see api/media/[name]/route.ts.
    expect(src).toMatch(/^\/api\/media\/[a-f0-9]{16}\.jpg$/);
    expect(src).not.toContain("?");

    // Alt is empty until someone writes one, and the UI says so rather than
    // letting an undescribed photo look finished.
    expect(await page.locator("text=Needs a description").count()).toBeGreaterThan(0);

    // Assert the banner's rendered TEXT, not just that it exists. JSX silently
    // swallows a space between `}` and text that wraps to the next line, which
    // shipped "photos needa description" — invisible to every structural check.
    const banner = await page.locator("text=Descriptions needed").locator("..").innerText();
    expect(banner).toContain("1 photo needs a description.");
    expect(banner).not.toMatch(/need[as]\s*description/);

    // And the bytes really are served (200, image content type).
    const res = await context.request.get(BASE_URL + src!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/jpeg");
  });

  it("saves a description and clears the warning", async () => {
    await page.goto(BASE_URL + "/admin/media", { waitUntil: "load" });
    await page.locator('button:has-text("Edit details")').first().click();
    await page.locator("textarea").first().fill(ALT);
    await page.locator('button:has-text("Save")').first().click();

    // Wait on the SUCCESS CONFIRMATION, not on the alt text appearing.
    // Playwright's text engine is substring-matching, so waiting for the alt
    // itself can match the still-open edit form (its placeholder, or the
    // textarea we just filled) the instant Save is clicked — and the reload
    // below would then abort the PATCH still in flight and silently prove
    // nothing. "Saved." is only rendered after the response lands.
    await page.waitForSelector("text=Saved.", { timeout: 15_000 });
    // Only meaningful once the form has closed; in edit mode the badge is not
    // rendered at all, so asserting it earlier passes for the wrong reason.
    expect(await page.locator("textarea").count()).toBe(0);
    expect(await page.locator("text=Needs a description").count()).toBe(0);

    // Survives a reload — i.e. it was persisted, not just held in React state.
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(`text=${ALT}`, { timeout: 15_000 });
  });

  it("re-uploading the same file does not create a second tile", async () => {
    await page.goto(BASE_URL + "/admin/media", { waitUntil: "load" });
    const before = await page.locator('img[src^="/api/media/"]').count();

    await page.setInputFiles('input[type="file"]', FIXTURE);
    await page.waitForSelector("text=/1 photo added|1 photos added/", { timeout: 20_000 });

    expect(await page.locator('img[src^="/api/media/"]').count()).toBe(before);
    // The description written above must still be there — a re-upload that
    // blanked it would quietly undo accessibility work.
    expect(await page.locator(`text=${ALT}`).count()).toBe(1);
  });

  it("places a photo on the home page, and resets it back to the default", async () => {
    // The end-to-end claim of the whole feature: something chosen in admin
    // actually changes what a visitor sees, with no deploy.
    await page.goto(BASE_URL + "/admin/media", { waitUntil: "load" });
    await page.locator('button:has-text("Choose photo"), button:has-text("Change photo")').first().click();
    await page.locator('button:has(img[src^="/api/media/"])').first().click();
    await page.waitForSelector("text=Photo placed.", { timeout: 15_000 });

    // The home page is ISR (revalidate 60), so assert against a fresh render
    // rather than whatever the cache is holding.
    const home = await context.request.get(BASE_URL + "/", {
      headers: { "cache-control": "no-cache" },
    });
    expect(home.status()).toBe(200);
    expect(await home.text()).toContain("/api/media/");

    // And "use the default" genuinely restores the shipped asset.
    await page.goto(BASE_URL + "/admin/media", { waitUntil: "load" });
    await page.locator('button:has-text("Use the default")').first().click();
    await page.waitForSelector("text=Back to the default photo.", { timeout: 15_000 });
  });

  it("removes a photo from the library", async () => {
    await page.goto(BASE_URL + "/admin/media", { waitUntil: "load" });
    const before = await page.locator('img[src^="/api/media/"]').count();

    await page.locator('button:has-text("Remove")').first().click();
    await page.waitForSelector("text=Removed from the library", { timeout: 15_000 });

    expect(await page.locator('img[src^="/api/media/"]').count()).toBe(before - 1);
  });
});

/** The fixture is one of the GPS-tagged images from the sanitiser suite, so a
 *  passing upload above also means the browser path strips location data. The
 *  byte-level assertion lives in the route suite; this is the reminder that the
 *  same file is deliberately used on both sides. */
it("uses a location-tagged fixture on purpose", () => {
  expect(readFileSync(FIXTURE).byteLength).toBeGreaterThan(0);
});
