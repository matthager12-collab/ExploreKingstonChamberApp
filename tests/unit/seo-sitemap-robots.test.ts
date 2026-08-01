// E15 slice 5 — sitemap, robots and Event JSON-LD.
//
// The load-bearing property here is that NOTHING a visitor cannot see may be
// advertised to a crawler: an admin-hidden page 404s, so listing it in the
// sitemap hands search engines a dead URL and wastes crawl budget on it.

import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "../setup/pglite-db";

let tdb: TestDb;
beforeAll(async () => {
  tdb = await createTestDb();
});
afterAll(async () => {
  await tdb.close();
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.explorekingstonwa.com");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("siteUrl()", () => {
  it("strips a trailing slash so templating never double-slashes", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.test/");
    const { siteUrl, absoluteUrl } = await import("@/lib/site-url");
    expect(siteUrl()).toBe("https://example.test");
    expect(absoluteUrl("/ferry")).toBe("https://example.test/ferry");
    expect(absoluteUrl("ferry")).toBe("https://example.test/ferry");
  });

  it("falls back to localhost when unset — the dev posture, not a crash", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const { siteUrl } = await import("@/lib/site-url");
    expect(siteUrl()).toBe("http://localhost:3000");
  });
});

describe("robots.txt", () => {
  it("disallows the private surfaces and advertises an ABSOLUTE sitemap", async () => {
    const robots = (await import("@/app/robots")).default;
    const r = robots() as {
      rules: { userAgent: string; disallow: string | string[] };
      sitemap?: string;
    };
    expect(r.rules.disallow).toEqual(["/admin", "/portal", "/api"]);
    // A sitemap directive must be a full URL, and must match metadataBase.
    expect(r.sitemap).toBe("https://app.explorekingstonwa.com/sitemap.xml");
  });

  it("on staging (NOINDEX=1) disallows everything AND advertises no sitemap", async () => {
    vi.stubEnv("NOINDEX", "1");
    const robots = (await import("@/app/robots")).default;
    const r = robots() as { rules: { disallow: string | string[] }; sitemap?: string };
    expect(r.rules.disallow).toBe("/");
    // Pointing crawlers at a sitemap on the host we are hiding would undo it.
    expect(r.sitemap).toBeUndefined();
  });
});

describe("sitemap.xml", () => {
  it("lists the public pages as absolute URLs on the configured origin", async () => {
    const sitemap = (await import("@/app/sitemap")).default;
    const urls = (await sitemap()).map((e) => e.url);

    expect(urls).toContain("https://app.explorekingstonwa.com");
    for (const p of ["/ferry", "/eat", "/events", "/itineraries", "/stay", "/map", "/about"]) {
      expect(urls, `${p} missing from sitemap`).toContain(
        `https://app.explorekingstonwa.com${p}`,
      );
    }
    expect(urls).toContain("https://app.explorekingstonwa.com/ferry/plan");
    // Every entry must be absolute and on our origin — a relative <loc> is
    // invalid per the sitemap protocol.
    for (const u of urls) expect(u.startsWith("https://app.explorekingstonwa.com")).toBe(true);
  });

  it("never lists the private surfaces", async () => {
    const sitemap = (await import("@/app/sitemap")).default;
    const urls = (await sitemap()).map((e) => e.url);
    for (const u of urls) {
      expect(u).not.toContain("/admin");
      expect(u).not.toContain("/portal");
      expect(u).not.toContain("/api/");
    }
  });

  it("omits a page that ships dark (/es is DEFAULT_HIDDEN)", async () => {
    const sitemap = (await import("@/app/sitemap")).default;
    const urls = (await sitemap()).map((e) => e.url);
    // /es is hidden unless an explicit {hidden:false} row exists — advertising
    // it would send crawlers (and visitors) to a 404.
    expect(urls).not.toContain("https://app.explorekingstonwa.com/es");
  });

  it("omits an UNLISTED page even when it is explicitly visible (/line)", async () => {
    // Distinct from the /es case above, and the distinction is the whole point:
    // /es is omitted because it would 404. /line answers 200 — it is public,
    // reachable, and deliberately unadvertised, because entry is the QR code on
    // the physical SR-104 sign. Flipping it visible must NOT put it in search.
    const sitemap = (await import("@/app/sitemap")).default;
    const { setPageHidden } = await import("@/lib/stores/site-store");

    await setPageHidden("/line", false, { actor: "test", source: "admin" });

    const urls = (await sitemap()).map((e) => e.url);
    expect(
      urls,
      "/line is visible AND in the sitemap — an unlisted page leaked into search",
    ).not.toContain("https://app.explorekingstonwa.com/line");
    // The flip really did take, so the assertion above is not passing because
    // the page happens to be hidden.
    const { getEffectiveHiddenPaths } = await import("@/lib/page-visibility");
    expect(await getEffectiveHiddenPaths()).not.toContain("/line");
    // And a normal visible page is still listed — the filter is not over-broad.
    expect(urls).toContain("https://app.explorekingstonwa.com/ferry");
  });

  it("drops a page — and its detail URLs — as soon as an admin hides it", async () => {
    const sitemap = (await import("@/app/sitemap")).default;
    const { setPageHidden } = await import("@/lib/stores/site-store");

    // Present before hiding.
    let urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain("https://app.explorekingstonwa.com/itineraries");

    // Hide it through the SAME call Admin → Site content makes, rather than
    // mocking the seam — this proves the real path an operator would take.
    await setPageHidden("/itineraries", true, { actor: "test", source: "admin" });
    await setPageHidden("/eat", true, { actor: "test", source: "admin" });

    urls = (await sitemap()).map((e) => e.url);
    expect(urls).not.toContain("https://app.explorekingstonwa.com/itineraries");
    expect(urls).not.toContain("https://app.explorekingstonwa.com/eat");
    // The section is hidden, so its detail pages must not be listed either —
    // each would be a 404 for whoever followed it.
    expect(urls.some((u) => u.includes("/itineraries/"))).toBe(false);
    // Unrelated pages are unaffected.
    expect(urls).toContain("https://app.explorekingstonwa.com/ferry");

    // Restore so ordering between tests cannot matter.
    await setPageHidden("/itineraries", false, { actor: "test", source: "admin" });
    await setPageHidden("/eat", false, { actor: "test", source: "admin" });
  });
});
