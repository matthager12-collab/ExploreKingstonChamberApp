// Two guards over the admin show/hide gates. They compose, and neither
// subsumes the other:
//
//   RULE 1 (below): a page that HAS a gate and is ISR must use the
//                   cookie-free variant — which gate.
//   RULE 2 (below): a page UNDER a hideable section must have a gate at all.
//
// Rule 2 exists because Rule 1 is vacuous on a page that calls nothing. That
// was the /itineraries/<slug> find (2026-08-19): hiding "/itineraries" 404'd
// the list page and dropped the detail URLs from the sitemap, but every
// existing /itineraries/<slug> URL still rendered to anyone who had one. CI
// was green throughout — Rule 1 only ever inspected pages that already
// called a gate.
//
// ── RULE 1 ──────────────────────────────────────────────────────────────
// An ISR page must use the cookie-free visibility gate.
//
// THE TRAP (found live 2026-08-03: /give hidden in admin yet serving 200):
// `assertPageVisible` reads the admin session — cookies() — on its hidden
// branch. A page with `export const revalidate` prerenders VISIBLE at build
// time (the build store is empty), so the route is static; when an admin
// later hides it, the hidden branch's cookies() read cannot work during
// background revalidation, the 404 never bakes, and the stale visible page
// keeps serving to everyone. The admin "hide" toggle — the Chamber's
// emergency lever for a misbehaving page — silently does nothing.
//
// `assertPageVisibleStatic` never touches the session, so revalidation
// re-runs the check and bakes the 404 within the revalidate window (the
// mechanism /line's live↔dark flips proved in production, E33).
//
// Rule: a page file that exports `revalidate` may not call the bare
// `assertPageVisible(`. Exemptions are pages that are DYNAMIC for reasons
// independent of (or accepted despite) their inert revalidate export — on a
// dynamic route the bare gate runs per-request and its admin preview
// genuinely works:
//   - (site)/ferry + (site)/ferry/plan: getSide() reads the side cookie on
//     every request (the known-inert revalidate, memory
//     `visit-kingston-ferry-perf` item 3 — accepted by design).
//   - (site)/es: DEFAULT_HIDDEN_PAGES member — hidden AT BUILD TIME, so the
//     bare gate's cookies() fires during prerender and the route ships
//     dynamic; accepted on-demand rendering (page-visibility.tsx doc).
//
// Removing a page from the exemption list (e.g. after making /ferry truly
// static) should flip it to the static gate in the same change.

import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { HIDEABLE_PAGES } from "@/lib/page-visibility";

const APP_ROOT = path.join("src", "app");

const EXEMPT = new Set([
  path.join(APP_ROOT, "(site)", "ferry", "page.tsx"),
  path.join(APP_ROOT, "(site)", "ferry", "plan", "page.tsx"),
  path.join(APP_ROOT, "(site)", "es", "page.tsx"),
]);

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pageFiles(full));
    else if (/^page\.(tsx|ts|jsx|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("ISR pages use the cookie-free visibility gate", () => {
  const offenders: string[] = [];
  const exemptStillPresent = new Set<string>();

  for (const file of pageFiles(APP_ROOT)) {
    const src = fs.readFileSync(file, "utf8");
    const isr = /export const revalidate\b/.test(src);
    const bareGate = /await assertPageVisible\(/.test(src);
    if (!(isr && bareGate)) continue;
    if (EXEMPT.has(file)) exemptStillPresent.add(file);
    else offenders.push(file);
  }

  it("no ISR page calls the bare assertPageVisible", () => {
    expect(offenders, "swap these to assertPageVisibleStatic (see this file's header)").toEqual(
      [],
    );
  });

  it("the exemption list matches reality (stale entries get removed)", () => {
    expect([...exemptStillPresent].sort()).toEqual([...EXEMPT].sort());
  });
});


// ── RULE 2 ──────────────────────────────────────────────────────────────
// Every page under a hideable section must actually call a gate.
//
// Hiding a section from Admin → Site content has to hide the whole section,
// not just its index. A detail route that reads its own store and 404s only
// on "no such record" stays fully reachable while the section is hidden —
// the list page 404s, sitemap.xml drops the URLs, and the pages keep serving
// to anyone holding a link, a bookmark, or a search result. That is what
// /itineraries/<slug> and /hunt/<slug> both did until 2026-08-19.
//
// The rule is DERIVED from HIDEABLE_PAGES rather than a hand-kept list, so a
// detail route added under a future hideable section is covered without
// anyone remembering this file exists. The gate's ARGUMENT is checked too: a
// child gates on its parent section path (/ferry/plan → "/ferry"), and a
// copy-pasted wrong path is exactly as broken as no gate at all.

/** Pages under a hideable section that are ungated ON PURPOSE. Each entry is
 *  a decision someone wrote down in the page file itself — read that header
 *  before removing one. Adding an entry here means "hiding the parent section
 *  deliberately does NOT hide this URL". */
const UNGATED_BY_DESIGN = new Map<string, string>([
  [
    path.join(APP_ROOT, "(site)", "map", "restrooms", "page.tsx"),
    'a permanent basic, not a seasonal page the Chamber toggles; staying gate-free ' +
      "keeps the tree free of cookies() so the route prerenders and E13's service " +
      "worker can precache it (the visitor who needs it most has one bar of signal)",
  ],
  [
    path.join(APP_ROOT, "(site)", "line", "preview", "page.tsx"),
    "rendering while /line is hidden is the entire point — it is the admin preview " +
      "that assertPageVisibleStatic gives up; it does its own admin-only check",
  ],
]);

/** app-router URL for a page file: drop src/app, drop `(group)` segments. */
function urlForPageFile(file: string): string {
  const segments = path
    .relative(APP_ROOT, path.dirname(file))
    .split(path.sep)
    .filter((s) => s && s !== "." && !(s.startsWith("(") && s.endsWith(")")));
  return "/" + segments.join("/");
}

/** The hideable section a URL belongs to, or null. Longest match wins, and
 *  matching is on SEGMENT boundaries so /eat never claims a future /eatery. */
function sectionFor(url: string): string | null {
  const hits = HIDEABLE_PAGES.map((p) => p.path).filter(
    (p) => url === p || url.startsWith(p + "/"),
  );
  return hits.sort((a, b) => b.length - a.length)[0] ?? null;
}

/** Every section path a page file gates on, either gate variant. */
function gatedPaths(src: string): string[] {
  return [...src.matchAll(/assertPageVisible(?:Static)?\(\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("pages under a hideable section call a visibility gate", () => {
  const ungated: string[] = [];
  const wrongSection: string[] = [];
  const exemptStillPresent = new Set<string>();
  const sectionsWithPages = new Set<string>();

  for (const file of pageFiles(APP_ROOT)) {
    const section = sectionFor(urlForPageFile(file));
    if (!section) continue;
    sectionsWithPages.add(section);
    if (UNGATED_BY_DESIGN.has(file)) {
      exemptStillPresent.add(file);
      continue;
    }
    const gates = gatedPaths(fs.readFileSync(file, "utf8"));
    if (gates.length === 0) ungated.push(`${file} (needs a gate on "${section}")`);
    else if (!gates.includes(section))
      wrongSection.push(`${file} gates on ${gates.join(", ")} but sits under "${section}"`);
  }

  it("no page under a hideable section is missing its gate", () => {
    expect(
      ungated,
      "hiding the parent section would leave these URLs serving. Add " +
        "assertPageVisible(section) — or assertPageVisibleStatic(section) if the page " +
        "exports revalidate — above the page's own data reads, so the section 404s " +
        "uniformly instead of leaking which records exist. Genuinely-public sub-routes " +
        "go in UNGATED_BY_DESIGN with the reason.",
    ).toEqual([]);
  });

  it("no page gates on the wrong section path", () => {
    expect(
      wrongSection,
      "a gate on the wrong path is as broken as no gate — it watches a toggle nobody flips",
    ).toEqual([]);
  });

  it("the by-design exemptions still exist (stale entries get removed)", () => {
    expect([...exemptStillPresent].sort()).toEqual([...UNGATED_BY_DESIGN.keys()].sort());
  });

  it("every hideable section still resolves to a page (the guard keeps teeth)", () => {
    // A renamed or moved section would silently drop out of the sweep above and
    // leave this guard passing over nothing, so assert the mapping still lands.
    expect(
      HIDEABLE_PAGES.map((p) => p.path).filter((p) => !sectionsWithPages.has(p)),
      "these HIDEABLE_PAGES paths matched no page file — fix urlForPageFile()/sectionFor() " +
        "or drop the stale entry from HIDEABLE_PAGES",
    ).toEqual([]);
  });
});
