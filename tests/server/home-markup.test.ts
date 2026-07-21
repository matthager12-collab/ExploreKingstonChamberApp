// E14 slice 2 — rendered-HTML half of the home-page emoji check.
//
// tests/unit/home-features-icons.test.ts polices the source (the page is an
// async server component and cannot be mounted in jsdom); this one asserts the
// same guarantee against the HTML the production server actually serves, so a
// refactor that moves the glyph elsewhere still fails.

import { describe, expect, it } from "vitest";
import { BASE_URL } from "./config";

describe("home page markup", () => {
  it("hides every feature-card glyph from the accessible name", async () => {
    const res = await fetch(BASE_URL + "/");
    expect(res.status).toBe(200);
    const html = await res.text();

    // The card blurbs prove the grid rendered at all.
    expect(html).toContain("Sailings, live waits, walk-on tips");

    // Every glyph span in that grid carries aria-hidden, and none is left
    // bare. React emits attributes in source order, so the aria-hidden
    // version is a distinct literal from the unlabelled one.
    const GLYPH_SPAN = 'class="text-3xl drop-shadow-sm"';
    const hidden = html.split(`aria-hidden="true" ${GLYPH_SPAN}`).length - 1;
    const total = html.split(GLYPH_SPAN).length - 1;
    expect(total, "the feature grid should render at least one card").toBeGreaterThan(0);
    expect(hidden, "every feature glyph span must be aria-hidden").toBe(total);
  });
});
