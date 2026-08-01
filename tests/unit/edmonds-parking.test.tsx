// The Edmonds-side parking section on /parking (feat/edmonds-side-parking).
//
// Four things are worth locking down, and each maps to a data-honesty rule:
//
//   1. The section actually renders, with its deep-link anchor (#edmonds —
//      /ferry's cross-link depends on it).
//   2. The fare token interpolates: the figure comes from the E27 fares record
//      at render time, and when no confirmed figure exists the sentence falls
//      back to the shared "the fare posted at Edmonds" wording — never a
//      stale or invented number, and never a raw "{walkOnRoundTrip}".
//   3. Every card — options AND prohibitions — carries its published source
//      link, and every option carries a Google-Maps directions deep link
//      (there is no in-app map for Edmonds: the PMTiles bbox is
//      downtown Kingston only).
//   4. No MapZone leakage: the Edmonds records have no Kingston-bbox geometry
//      and must never reach map layers or the admin zone editor, so the seed
//      module is geometry-free and only the /parking section imports it.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EdmondsSideParking } from "@/app/(site)/parking/edmonds-section";
import { mapDirectionsUrl } from "@/components/ui";
import {
  edmondsNoPark,
  edmondsNoParkPlace,
  edmondsOption,
  edmondsParkingOptions,
} from "@/lib/data/edmonds-parking";
import { SAFETY_TOKEN_FALLBACKS } from "@/lib/i18n/safety-content";
import { copyFallback } from "@/lib/site-copy-registry";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC_ROOT = path.join(REPO_ROOT, "src");

/** React's HTML escaping, so assertions survive apostrophes and ampersands
 *  ("Brackett's Landing" renders as "Brackett&#x27;s Landing"). */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Render with registry-fallback copy, like the page does with no overrides. */
function render(walkOnRoundTrip: string | null): string {
  return renderToStaticMarkup(
    <EdmondsSideParking copy={{}} walkOnRoundTrip={walkOnRoundTrip} />,
  );
}

describe("the Edmonds section renders", () => {
  const html = render("$12.34");

  it("with its title, subtitle and the #edmonds anchor /ferry links to", () => {
    expect(html).toContain('id="edmonds"');
    expect(html).toContain(esc(copyFallback("edmonds.section.title")));
    expect(html).toContain(esc(copyFallback("edmonds.section.subtitle")));
  });

  it("with every option card's name", () => {
    for (const o of edmondsParkingOptions) {
      expect(html, o.id).toContain(esc(o.name));
    }
  });

  it("with the do-not-park callout and every prohibited place", () => {
    expect(html).toContain(esc(copyFallback("edmonds.avoid.title")));
    for (const p of edmondsNoPark) {
      expect(html, p.id).toContain(esc(p.name));
    }
  });

  it("with the honest multi-day gap, stated rather than implied away", () => {
    expect(html).toContain(esc(copyFallback("edmonds.multiday.title")));
    expect(html).toContain(esc(copyFallback("edmonds.multiday.body")));
  });
});

describe("the walk-on fare comes from the record, like /ferry, /simple and /es", () => {
  it("the registry sentence carries the token, not a figure", () => {
    const fallback = copyFallback("edmonds.fare");
    expect(fallback).toContain("{walkOnRoundTrip}");
    // A literal figure beside the token would defeat the single-sourcing.
    expect(fallback).not.toMatch(/\$\d/);
  });

  it("interpolates the record's figure into the sentence", () => {
    const html = render("$12.34");
    expect(html).toContain("$12.34");
    expect(html).not.toContain("{walkOnRoundTrip}");
  });

  it("falls back to the shared no-figure wording when the record has none", () => {
    const html = render(null);
    expect(html).toContain(esc(SAFETY_TOKEN_FALLBACKS.en.walkOnRoundTrip));
    expect(html).not.toContain("{walkOnRoundTrip}");
    expect(html).not.toContain("$12.34");
  });
});

describe("every card carries its source, prohibitions included", () => {
  const html = render(null);

  it("each option links its published source", () => {
    for (const o of edmondsParkingOptions) {
      expect(html, o.id).toContain(`href="${esc(o.sourceUrl)}"`);
      expect(html, o.id).toContain(esc(o.sourceLabel));
    }
  });

  it("each option deep-links Google-Maps directions (no in-app Edmonds map)", () => {
    for (const o of edmondsParkingOptions) {
      expect(html, o.id).toContain(
        `href="${esc(mapDirectionsUrl(o.directionsDestination, o.directionsMode))}"`,
      );
    }
  });

  it("each do-not-park item links its published source", () => {
    for (const p of edmondsNoPark) {
      expect(html, p.id).toContain(`href="${esc(p.sourceUrl)}"`);
    }
  });

  it("every source URL is https and every id unique (both lists)", () => {
    const all = [...edmondsParkingOptions, ...edmondsNoPark];
    for (const entry of all) {
      expect(entry.sourceUrl, entry.id).toMatch(/^https:\/\//);
    }
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
  });

  it("the lookups fail loudly on a typo instead of rendering a blank card", () => {
    expect(() => edmondsOption("nope" as never)).toThrow();
    expect(() => edmondsNoParkPlace("nope" as never)).toThrow();
  });
});

/* ------------------------- no MapZone leakage ------------------------- */

const SEED_REL = "src/lib/data/edmonds-parking.ts";

/** Blank whole-line comments (the fare-single-source idiom), so prose ABOUT
 *  MapZone in the module header does not trip the scans below. */
function codeLines(file: string): string {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((l) => {
      const t = l.trim();
      return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") ? "" : l;
    })
    .join("\n");
}

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFilesUnder(p));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

describe("Edmonds records never leak into the map stack", () => {
  it("the seed module carries no geometry and no MapZone import", () => {
    const code = codeLines(path.join(REPO_ROOT, SEED_REL));
    // The MapZone geometry surface: any of these appearing here means someone
    // started shaping these records for a map they must not reach (the
    // PMTiles bbox is downtown Kingston; Edmonds is outside it — ADR-0006).
    expect(code).not.toMatch(/\bcenter\s*:/);
    expect(code).not.toMatch(/\bpolygon\s*:/);
    expect(code).not.toMatch(/\bstreetPaths\s*:/);
    expect(code).not.toMatch(/\bcurb\s*:/);
    expect(code).not.toContain("MapZone");
    expect(code).not.toMatch(/from\s+["'](?:\.\/parking|@\/lib\/data\/parking)["']/);
  });

  it("only the /parking Edmonds section imports the seed module", () => {
    const importers = sourceFilesUnder(SRC_ROOT)
      .filter((f) => /["']@\/lib\/data\/edmonds-parking["']/.test(codeLines(f)))
      .map((f) => path.relative(REPO_ROOT, f))
      .sort();
    // The allowlist IS the leakage guard: map layers, map views, resolve, the
    // feature map and the admin zone editors must never appear here.
    expect(importers).toEqual(["src/app/(site)/parking/edmonds-section.tsx"]);
  });

  it("the /parking page actually mounts the section (wiring tripwire)", () => {
    const page = readFileSync(
      path.join(SRC_ROOT, "app", "(site)", "parking", "page.tsx"),
      "utf8",
    );
    expect(page).toContain("<EdmondsSideParking");
    expect(page).toContain("walkOnRoundTripFare(ferryInfo.fares)");
  });

  it("/ferry cross-links the section by its anchor", () => {
    const ferry = readFileSync(
      path.join(SRC_ROOT, "app", "(site)", "ferry", "page.tsx"),
      "utf8",
    );
    expect(ferry).toContain('href="/parking#edmonds"');
  });
});
