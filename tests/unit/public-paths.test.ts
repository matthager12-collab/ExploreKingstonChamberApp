// Guards src/lib/public-paths.ts against the only way it can fail: silently
// going stale. A map that is merely CORRECT TODAY buys nothing — someone adds
// a page that renders restaurants, forgets this file, and approvals stop
// refreshing it with no signal. So the test derives the truth from the source
// tree and fails when the map disagrees.
//
// This is the "manifest completeness" shape that E14's never-landed axe gate
// was missing: the value is in the test that fails, not in the list.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  COMPONENT_MEDIATED,
  PUBLIC_PATHS_BY_STORE,
  publicPathsForStore,
} from "@/lib/public-paths";

const SITE = join("src", "app", "(site)");

/** PUBLIC (live-only) getter → store. The *Admin variants are deliberately
 *  absent: an admin page rendering pending records is not a public surface. */
const PUBLIC_GETTERS: Record<string, string> = {
  getRestaurants: "restaurants",
  getLodging: "lodging",
  getCharities: "charities",
  getVolunteerNeeds: "volunteer-needs",
  getEvents: "events",
  getWebcams: "webcams",
  getItineraries: "itineraries",
  getDirectoryListings: "directory",
};

/** Route groups "(site)"/"(home)" contribute nothing to the URL. */
function routeForPageFile(file: string): string {
  const rel = file.slice(SITE.length).replace(/\/page\.tsx?$/, "");
  const segments = rel.split("/").filter((s) => s && !/^\(.*\)$/.test(s));
  return "/" + segments.join("/");
}

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...pageFiles(full));
    else if (entry === "page.tsx" || entry === "page.ts") out.push(full);
  }
  return out;
}

/** Public pages only: /admin and /portal are signed-in surfaces, and they are
 *  force-dynamic rather than ISR, so they have nothing to revalidate. */
function isPublicRoute(route: string): boolean {
  return !route.startsWith("/admin") && !route.startsWith("/portal");
}

describe("public-paths map completeness", () => {
  const pages = pageFiles(SITE);

  it("finds the site pages at all (guards against a silently empty scan)", () => {
    expect(pages.length).toBeGreaterThan(10);
  });

  it("every public page that reads a store's PUBLIC getter is listed for that store", () => {
    const missing: string[] = [];
    for (const file of pages) {
      const route = routeForPageFile(file);
      if (!isPublicRoute(route)) continue;
      const source = readFileSync(file, "utf8");
      for (const [getter, store] of Object.entries(PUBLIC_GETTERS)) {
        // Word boundary so getRestaurants does not match getRestaurantsAdmin.
        if (!new RegExp(`\\b${getter}\\b(?!Admin)`).test(source)) continue;
        if (!publicPathsForStore(store).includes(route)) {
          missing.push(
            `${route} reads ${getter}() but is not listed under '${store}' in PUBLIC_PATHS_BY_STORE`,
          );
        }
      }
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("every mapped path is a real route (no dead entries)", () => {
    const realRoutes = new Set(pages.map(routeForPageFile));
    const dead: string[] = [];
    for (const [store, paths] of Object.entries(PUBLIC_PATHS_BY_STORE)) {
      for (const path of paths) {
        if (!realRoutes.has(path)) dead.push(`'${store}' lists ${path}, which is not a route`);
      }
    }
    expect(dead, dead.join("\n")).toEqual([]);
  });

  it("every moderatable store has an entry, even if empty", () => {
    // Missing key vs empty array is the distinction that matters: an empty
    // array is a decision ("nothing public renders this yet"), a missing key
    // is an oversight. Mirrors the moderation engine's store list.
    const moderatable = [
      "restaurants",
      "lodging",
      "charities",
      "volunteer-needs",
      "events",
      "webcams",
      "itineraries",
      "directory",
    ];
    for (const store of moderatable) {
      expect(
        Object.hasOwn(PUBLIC_PATHS_BY_STORE, store),
        `'${store}' has no entry — add it, with [] if it has no public surface`,
      ).toBe(true);
    }
  });

  it("component-mediated reads point at paths the map already carries", () => {
    for (const entry of COMPONENT_MEDIATED) {
      expect(
        publicPathsForStore(entry.store),
        `${entry.path} (via ${entry.via}) is not listed under '${entry.store}'`,
      ).toContain(entry.path);
      // And the component named must still read that store, or the note is a lie.
      const source = readFileSync(entry.via, "utf8");
      const getter = Object.entries(PUBLIC_GETTERS).find(([, s]) => s === entry.store)?.[0];
      expect(
        new RegExp(`\\b${getter}\\b`).test(source),
        `${entry.via} no longer reads ${getter}() — update COMPONENT_MEDIATED`,
      ).toBe(true);
    }
  });

  it("unknown stores refresh nothing rather than throwing", () => {
    expect(publicPathsForStore("no-such-store")).toEqual([]);
  });
});
