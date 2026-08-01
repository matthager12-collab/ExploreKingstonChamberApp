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
// to /es. This failed in CI the first time someone added a well-meaning
// (site)/loading.tsx; this guard turns that server-suite failure into an
// instant unit failure with the reason attached. The instant-nav skeletons
// live in scoped segments instead: (site)/(home) and (site)/ferry.

import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/** Every segment directory between the app root and the /es page, inclusive.
 *  A loading file in any of them wraps the /es page in a Suspense boundary. */
const SEGMENTS_ABOVE_ES = [
  path.join("src", "app"),
  path.join("src", "app", "(site)"),
  path.join("src", "app", "(site)", "es"),
];

const LOADING_FILES = ["loading.tsx", "loading.ts", "loading.jsx", "loading.js"];

describe("hidden-page 404 floor vs loading.tsx placement", () => {
  it("keeps every segment above /es free of loading files", () => {
    for (const segment of SEGMENTS_ABOVE_ES) {
      for (const file of LOADING_FILES) {
        const candidate = path.join(process.cwd(), segment, file);
        expect(
          fs.existsSync(candidate),
          `${segment}/${file} exists — a loading boundary above /es makes its ` +
            "notFound() stream under HTTP 200, breaking the E14 dark-page 404 floor " +
            "(tests/server/es-accessibility.test.ts). Scope the skeleton to a " +
            "segment that cannot 404, like (site)/(home) or (site)/ferry.",
        ).toBe(false);
      }
    }
  });

  it("still has the scoped instant-nav boundaries it exists to protect", () => {
    // If these move, update SEGMENTS_ABOVE_ES thinking about the new shape —
    // this guard is only meaningful while the skeletons live in scoped segments.
    for (const p of [
      path.join("src", "app", "(site)", "(home)", "loading.tsx"),
      path.join("src", "app", "(site)", "ferry", "loading.tsx"),
    ]) {
      expect(fs.existsSync(path.join(process.cwd(), p)), `${p} is missing`).toBe(true);
    }
  });
});
