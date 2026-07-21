// E14 — guard the PROPERTY, not the proxy.
//
// tests/unit/a11y-static-invariants.test.ts asserts that src/app/layout.tsx
// contains no `next/headers` import. That is a proxy for what actually matters:
// a cookies()/headers() read reachable from the root layout opts EVERY page out
// of static rendering (the audited v1 ISR trap), and it is why simple mode is
// localStorage + a data-simple attribute rather than a cookie. The grep only
// inspects one file's text, so a dynamic API pulled in transitively — through a
// component the layout renders, or a lib it imports — would slip past it.
//
// This reads the build's own answer instead. It runs in the server suite
// because that is the only stage that runs AFTER `npm run build`.

import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/** Routes that must stay statically prerendered. The public listing pages are
 *  the ISR-trap canaries; /simple and /print are E14's non-app fallbacks and
 *  the pages E13 wants to precache; /accessibility is the public commitment. */
const MUST_BE_STATIC = ["/eat", "/stay", "/simple", "/print", "/accessibility"];

describe("static rendering", () => {
  it("keeps the public pages prerendered (no cookies() reachable from the root layout)", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(process.cwd(), ".next", "prerender-manifest.json"), "utf8"),
    ) as { routes?: Record<string, unknown> };
    const prerendered = Object.keys(manifest.routes ?? {});
    expect(prerendered.length, "prerender-manifest.json had no routes — did the build run?").toBeGreaterThan(0);

    const missing = MUST_BE_STATIC.filter((route) => !prerendered.includes(route));
    expect(
      missing,
      `Route(s) that stopped being statically prerendered: ${missing.join(", ")}. ` +
        "Something in the shared graph now reads a dynamic API (cookies/headers/searchParams). " +
        "Find it and move the read into the page that needs it — do not accept the regression.",
    ).toEqual([]);
  });
});
