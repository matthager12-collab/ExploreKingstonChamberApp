// E14 slice 2 — the home page's feature-grid emoji must not double-read.
//
// This is a SOURCE invariant rather than a rendered-DOM test: src/app/page.tsx
// is an async server component that awaits eight data sources (ferry snapshot,
// weather, tides, events, copy overrides, hidden paths, side, prediction flag),
// and Next.js forbids extra named exports from a page module, so neither the
// page nor its `features` array can be imported into jsdom. The rendered
// counterpart lives in tests/server/home-markup.test.ts, which asserts the same
// thing against the real HTML the production server emits.
//
// It lives under tests/ (not colocated in src/) for the same reason the other
// grep invariants do: it carries the literal patterns it polices.

import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const PAGE = path.join(process.cwd(), "src", "app", "page.tsx");

describe("home feature grid", () => {
  const source = fs.readFileSync(PAGE, "utf8");

  it("renders the decorative icon glyph inside an aria-hidden span", () => {
    // The span that prints {f.icon} must carry aria-hidden so the card's link
    // is named by its title alone ("Ferry", not "⛴️ Ferry").
    const iconSpan = /<span\s+aria-hidden="true"[^>]*>[\s\S]*?\{f\.icon\}[\s\S]*?<\/span>/;
    expect(source).toMatch(iconSpan);
  });

  it("keeps the visible title and blurb — aria-hidden must not swallow the label", () => {
    expect(source).toContain("{f.title}");
    expect(source).toContain("{f.blurb}");
  });
});
