// Placement guard for loading.tsx vs the /es HTTP-404 floor.
//
// A loading.tsx starts the response STREAMING as soon as its fallback
// renders, and streaming pins the HTTP status at 200: a notFound() thrown
// inside the page after that point can only stream the not-found BODY — it
// can never set a 404 status (bundled Next docs, 03-api-reference/
// 03-file-conventions/loading.md §"Status Codes"). The E14 floor for the
// ships-dark /es page is a real HTTP 404 for anonymous visitors
// (tests/server/es-accessibility.test.ts, DEFAULT_HIDDEN_PAGES in
// src/lib/page-visibility.tsx) — unreviewed hand-authored Spanish safety
// copy must not be publicly reachable, and the status code is the contract.
//
// So no loading file may exist in ANY segment on the path from the app root
// to a fail-closed page. This failed in CI the first time someone added a
// well-meaning (site)/loading.tsx; this guard turns that server-suite failure
// into an instant unit failure with the reason attached. The instant-nav
// skeletons live in scoped segments instead: (site)/(home) and (site)/ferry.
//
// The segment chains are DERIVED from DEFAULT_HIDDEN_PAGES, not hardcoded:
// if a future fail-closed page lands under a segment that already carries a
// loading boundary, this guard flags it without anyone remembering to
// update a list.

import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { DEFAULT_HIDDEN_PAGES } from "@/lib/page-visibility";

const APP_ROOT = path.join("src", "app");
const PAGE_FILES = ["page.tsx", "page.ts", "page.jsx", "page.js"];
const LOADING_FILES = ["loading.tsx", "loading.ts", "loading.jsx", "loading.js"];

/** Route groups — `(name)` — are URL-transparent directory segments. */
function isRouteGroup(name: string): boolean {
  return name.startsWith("(") && name.endsWith(")");
}

/**
 * Every directory chain (app root → page dir, inclusive) whose page file
 * renders `urlPath`. Route groups don't appear in the URL, so one URL can
 * have several candidate chains; Next allows only one to actually resolve,
 * but a loading file anywhere along ANY matching chain is a hazard worth
 * flagging, so the guard checks them all.
 */
function segmentChainsFor(urlPath: string): string[][] {
  const chains: string[][] = [];
  const walk = (dirs: string[], remaining: string[]) => {
    const abs = path.join(process.cwd(), APP_ROOT, ...dirs);
    if (
      remaining.length === 0 &&
      PAGE_FILES.some((f) => fs.existsSync(path.join(abs, f)))
    ) {
      chains.push([
        APP_ROOT,
        ...dirs.map((_, i) => path.join(APP_ROOT, ...dirs.slice(0, i + 1))),
      ]);
    }
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (isRouteGroup(entry.name)) {
        walk([...dirs, entry.name], remaining);
      } else if (remaining.length > 0 && entry.name === remaining[0]) {
        walk([...dirs, entry.name], remaining.slice(1));
      }
    }
  };
  walk([], urlPath.split("/").filter(Boolean));
  return chains;
}

describe("hidden-page 404 floor vs loading.tsx placement", () => {
  it("keeps every segment above each fail-closed page free of loading files", () => {
    for (const urlPath of DEFAULT_HIDDEN_PAGES) {
      const chains = segmentChainsFor(urlPath);
      // Zero chains means the resolver lost the page (moved, renamed, or a
      // convention this walker doesn't know) — that would make the guard
      // silently vacuous, so fail loudly instead.
      expect(
        chains.length,
        `no page file found under ${APP_ROOT} for default-hidden path ` +
          `${urlPath} — fix segmentChainsFor() so this guard keeps teeth`,
      ).toBeGreaterThan(0);
      for (const chain of chains) {
        for (const segment of chain) {
          for (const file of LOADING_FILES) {
            const candidate = path.join(process.cwd(), segment, file);
            expect(
              fs.existsSync(candidate),
              `${segment}/${file} exists — a loading boundary above ${urlPath} makes its ` +
                "notFound() stream under HTTP 200, breaking the dark-page 404 floor " +
                "(tests/server/es-accessibility.test.ts). Scope the skeleton to a " +
                "segment that cannot 404, like (site)/(home) or (site)/ferry.",
            ).toBe(false);
          }
        }
      }
    }
  });

  it("still has the scoped instant-nav boundaries it exists to protect", () => {
    // If these move, re-run this suite mentally against the new shape —
    // this guard is only meaningful while the skeletons live in scoped segments.
    for (const p of [
      path.join("src", "app", "(site)", "(home)", "loading.tsx"),
      path.join("src", "app", "(site)", "ferry", "loading.tsx"),
    ]) {
      expect(fs.existsSync(path.join(process.cwd(), p)), `${p} is missing`).toBe(true);
    }
  });
});
