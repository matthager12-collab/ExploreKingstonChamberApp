// Resolve a public URL path to the page file that serves it.
//
// E22 introduced route groups, and a route group is a directory whose name is
// wrapped in parentheses that Next STRIPS from the URL. So /eat is served by
// src/app/(site)/eat/page.tsx, and /kiosk by src/app/(kiosk)/kiosk/page.tsx,
// while /api and the file conventions stay ungrouped at the root.
//
// Two CI tripwires assert "every entry in this list resolves to a real page":
// tests/unit/sw-contract.test.ts (a cached 404 outlives the deploy that caused
// it) and tests/unit/admin-nav.test.ts (a dead nav link should be a red build).
// Both used to join the URL straight onto src/app, which stopped being true the
// moment the site moved into (site). Sharing ONE resolver means the next group
// added to this app cannot silently blind either guard.

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const SRC_APP = path.join(process.cwd(), "src", "app");

/** Directory names of the form "(group)" directly under src/app. */
function routeGroups(): string[] {
  return readdirSync(SRC_APP, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("(") && e.name.endsWith(")"))
    .map((e) => e.name);
}

/**
 * Every on-disk location that could serve `urlPath` — the ungrouped one first,
 * then one per route group. Returned rather than just a boolean so a failing
 * test can print exactly where it looked.
 */
export function candidatePageFiles(urlPath: string): string[] {
  const rel = urlPath.replace(/[?#].*$/, "").replace(/^\//, "");
  return [
    path.join(SRC_APP, rel, "page.tsx"),
    ...routeGroups().map((g) => path.join(SRC_APP, g, rel, "page.tsx")),
  ];
}

/** True when some group (or the root) really serves `urlPath`. */
export function resolvesToPage(urlPath: string): boolean {
  return candidatePageFiles(urlPath).some((f) => existsSync(f));
}
