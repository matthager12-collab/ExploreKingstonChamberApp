// /line is LIVE but UNLISTED: it answers 200 to anyone with the URL, and is
// kept out of search. Entry is meant to be the QR code on the physical SR-104
// sign — the page's framing ("you're in the line") is wrong for anyone who
// isn't, and it would compete with /ferry for queries /ferry should win.
//
// Three separate mechanisms have to agree, and the interesting failure is that
// each looks fine alone:
//   1. UNLISTED_PAGES keeps it out of sitemap.xml   (stop advertising)
//   2. `robots: { index: false }` on the page        (stop indexing)
//   3. NO robots.txt Disallow                        (see below)
//
// (3) is the counter-intuitive one and the reason this file exists. Adding
// `Disallow: /line` looks like belt-and-braces but is actively harmful: it
// blocks CRAWLING, so the crawler never fetches the page, never sees the
// noindex, and Google can still list a bare URL it learned from an inbound
// link — with no snippet, and no way for us to suppress it. "Crawlable +
// noindex" is the combination that actually keeps a page out of results.

import { describe, expect, it, vi } from "vitest";

import { DEFAULT_HIDDEN_PAGES, HIDEABLE_PAGES, UNLISTED_PAGES } from "@/lib/page-visibility";

describe("UNLISTED_PAGES", () => {
  it("covers /line", () => {
    expect(UNLISTED_PAGES).toContain("/line");
  });

  it("only names paths the visibility system actually knows about", () => {
    // A typo here fails silently — the page would just keep being listed.
    const known = new Set(HIDEABLE_PAGES.map((p) => p.path));
    for (const path of UNLISTED_PAGES) {
      expect(known, `${path} is not in HIDEABLE_PAGES`).toContain(path);
    }
  });

  it("keeps /line in DEFAULT_HIDDEN_PAGES as a restore-safety net", () => {
    // Unlisted and hidden are different things, and /line is currently both
    // "public via an explicit record" and "fail-closed if that record is lost".
    // Removing it from DEFAULT_HIDDEN_PAGES makes it PUBLIC BY DEFAULT the next
    // time the store is empty — a restore, a wipe, a fresh database.
    expect(DEFAULT_HIDDEN_PAGES).toContain("/line");
  });
});

describe("robots.txt must NOT disallow an unlisted page", () => {
  it("blocks only the private surfaces", async () => {
    vi.stubEnv("NOINDEX", "");
    const { default: robots } = await import("@/app/robots");
    const rules = robots().rules as { disallow?: string | string[] };
    const disallow = [rules.disallow ?? []].flat();

    expect(disallow.sort()).toEqual(["/admin", "/api", "/portal"]);
    for (const path of UNLISTED_PAGES) {
      expect(
        disallow,
        `robots.txt disallows ${path}. That blocks crawling, so the crawler never ` +
          "reads the noindex and the bare URL can still be indexed. Remove the " +
          "Disallow and rely on noindex + the sitemap omission instead.",
      ).not.toContain(path);
    }
    vi.unstubAllEnvs();
  });

  it("still shuts everything out on staging", async () => {
    // The unlisted rule above must not have loosened the staging blanket block.
    vi.stubEnv("NOINDEX", "1");
    vi.resetModules();
    const { default: robots } = await import("@/app/robots");
    expect((robots().rules as { disallow?: string }).disallow).toBe("/");
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe("/line page metadata", () => {
  it("carries noindex, but stays followable", async () => {
    const { metadata } = await import("@/app/(site)/line/page");
    const robots = metadata.robots as { index?: boolean; follow?: boolean };
    expect(robots?.index).toBe(false);
    // follow stays true: the page links to /parking and /ferry, which we DO
    // want crawled, so there is no reason to dead-end a crawler that lands here.
    expect(robots?.follow).toBe(true);
  });
});
