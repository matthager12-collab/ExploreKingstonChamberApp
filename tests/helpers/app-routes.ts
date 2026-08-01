// Resolve a public URL path to the page file that serves it.
//
// E22 introduced route groups, and a route group is a directory whose name is
// wrapped in parentheses that Next STRIPS from the URL. So /eat is served by
// src/app/(site)/eat/page.tsx, and /kiosk by src/app/(kiosk)/kiosk/page.tsx,
// while /api and the file conventions stay ungrouped at the root. Groups can
// also NEST: "/" is served by src/app/(site)/(home)/page.tsx — the (home)
// group exists so the home page's instant-nav loading.tsx covers "/" alone
// (see tests/unit/hidden-page-404-guard.test.ts for why it must be scoped).
//
// Two CI tripwires assert "every entry in this list resolves to a real page":
// tests/unit/sw-contract.test.ts (a cached 404 outlives the deploy that caused
// it) and tests/unit/admin-nav.test.ts (a dead nav link should be a red build).
// Both used to join the URL straight onto src/app, which stopped being true the
// moment the site moved into (site). Sharing ONE resolver means the next group
// added to this app cannot silently blind either guard — which is exactly why
// this walks group directories recursively rather than only one level deep.

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const SRC_APP = path.join(process.cwd(), "src", "app");

/** Directory names of the form "(group)" directly under `dir` (on disk). */
function groupDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("(") && e.name.endsWith(")"))
    .map((e) => e.name);
}

/**
 * Every on-disk location that could serve `urlPath`: at each directory level a
 * route group may interpose without consuming a URL segment, so the candidates
 * are all interleavings of the URL's segments with existing group directories.
 * Returned as paths rather than just a boolean so a failing test can print
 * exactly where it looked.
 */
export function candidatePageFiles(urlPath: string): string[] {
  const rel = urlPath.replace(/[?#].*$/, "").replace(/^\//, "");
  const segments = rel === "" ? [] : rel.split("/");
  const out: string[] = [];
  const walk = (dir: string, remaining: string[]): void => {
    if (remaining.length === 0) {
      out.push(path.join(dir, "page.tsx"));
    } else {
      walk(path.join(dir, remaining[0]), remaining.slice(1));
    }
    // A group adds a directory level but no URL segment — recurse into each
    // one that exists with the SAME remaining segments.
    for (const g of groupDirs(dir)) walk(path.join(dir, g), remaining);
  };
  walk(SRC_APP, segments);
  return out;
}

/** True when some group chain (or the ungrouped root) really serves `urlPath`. */
export function resolvesToPage(urlPath: string): boolean {
  return candidatePageFiles(urlPath).some((f) => existsSync(f));
}
