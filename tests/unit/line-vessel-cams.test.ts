// /line's webcam box and vessel map — the invariants that keep them from
// quietly costing the page its whole reason for existing.
//
// SOURCE invariants rather than rendered-DOM ones, for the same reason
// home-features-icons.test.ts is: line-lander.tsx is an async server component
// awaiting eight stores, so it cannot be imported into jsdom. The rendered
// counterpart is tests/server/line-visibility.test.ts, and the build-level
// backstop is tests/server/static-rendering.test.ts, which fails if /line ever
// stops being prerendered at all.
//
// THE REGRESSION THIS EXISTS TO CATCH. Passing `initial` to <FerryVesselMap/>
// here looks like a pure improvement — /ferry does exactly that, and it would
// make the boats appear a beat sooner. It is not. getVesselLocations() fetches
// with revalidate 10, and a prerendered route inherits the SHORTEST revalidate
// reachable from it (node_modules/next/dist/docs/01-app/02-guides/
// incremental-static-regeneration.md: "the lowest time will be used for ISR").
// /line declares 60 and already sits at 30 via getFerryStatusSnapshot →
// getRouteDelays; server-fetching vessels would cut it to 10 and sextuple the
// origin renders for an audience parked on cellular in SR-104's dead zone.
// Nothing about the rendered page would look wrong, which is why it needs a
// test and not a comment. /ferry is exempt: it reads cookies, so it is dynamic
// and its revalidate is already inert.

import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { webcams as webcamSeed } from "@/lib/data/webcams";
import { kingstonCamsFromLine } from "@/lib/line-lander";
import type { Webcam } from "@/lib/types";

const LANDER = path.join(process.cwd(), "src", "components", "line-lander.tsx");
const source = fs.readFileSync(LANDER, "utf8");

// Assert against CODE, not prose. line-lander.tsx documents these hazards at
// length in its own header — a grep over the raw file matches the warning as
// readily as the mistake, and would have failed the day it was written.
const code = source
  // Block comments, which covers JSX {/* … */} too (the leftover {} is inert).
  .replace(/\/\*[\s\S]*?\*\//g, "")
  // Line comments, without eating the // in a URL.
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("/line vessel map — the ISR window must survive it", () => {
  it("never server-fetches vessel positions", () => {
    expect(
      code,
      "line-lander.tsx referenced getVesselLocations. That pulls a 10s-revalidate " +
        "fetch into a prerendered route and collapses /line's ISR window to 10s. " +
        "Mount <FerryVesselMap/> with no `initial` and let it self-fetch on reveal.",
    ).not.toContain("getVesselLocations");
  });

  it("mounts FerryVesselMap with no props at all", () => {
    // Self-closing with nothing between the name and the slash. Any prop here
    // is either `initial` (the trap above) or a height override that would want
    // its own review against the perf floor.
    expect(code).toMatch(/<FerryVesselMap\s*\/>/);
  });

  it("keeps both maps adjacent and below the food and amenities sections", () => {
    // MapLibre is a single ~200 KB module load shared by both maps. Splitting
    // them so one sits high would drag that load up near the fold.
    const sr104 = code.indexOf("<Sr104TrafficMap");
    const vessel = code.indexOf("<FerryVesselMap");
    const food = code.indexOf("<LineFood");
    const amenities = code.indexOf("<LineAmenities");
    expect(sr104).toBeGreaterThan(-1);
    expect(vessel).toBeGreaterThan(sr104);
    expect(sr104).toBeGreaterThan(food);
    expect(sr104).toBeGreaterThan(amenities);
  });
});

describe("/line webcams — Kingston side only", () => {
  it("selects and orders through the pure lib, not inline in the component", () => {
    // The filter+order lives in src/lib/line-lander.ts so it can be tested
    // against real fixtures (see the kingstonCamsFromLine describe below)
    // rather than only grepped for here.
    expect(code).toContain("kingstonCamsFromLine(cams)");
    expect(code).not.toContain('.filter((w) => !w.id.startsWith("edmonds-"))');
  });

  it("reads the merged store, never the seed array", () => {
    // getWebcams() merges the admin overlay, so a camera the Chamber adds shows
    // up here without a deploy. Importing webcamSeed directly would freeze it.
    expect(code).toContain("getWebcams");
    expect(code).not.toContain("webcamSeed");
  });

  it("only links to /webcams when that page is actually visible", () => {
    // /webcams can be hidden from Admin → Site content; linking regardless
    // would hand someone in a dead zone a 404.
    expect(code).toContain("webcamsPageVisible");
    expect(code).toContain('hiddenPaths.includes("/webcams")');
  });
});

describe("kingstonCamsFromLine — front of the line first", () => {
  const cam = (id: string): Webcam => ({
    id,
    name: id,
    location: id,
    imageUrl: `https://images.wsdot.wa.gov/${id}.jpg`,
    sourceUrl: "https://wsdot.wa.gov/",
    source: "WSDOT",
    refreshSeconds: 60,
  });

  it("drops every Edmonds camera", () => {
    const out = kingstonCamsFromLine(webcamSeed);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((w) => !w.id.startsWith("edmonds-"))).toBe(true);
  });

  it("leads with the tollbooths — the one camera that shows movement", () => {
    // This is the whole point of the reorder: a driver's first question is
    // "is it moving?", and the booths are the choke point that answers it.
    expect(kingstonCamsFromLine(webcamSeed)[0].id).toBe("kingston-toll-booths");
  });

  it("orders the shipped seed front-of-line to back-of-line", () => {
    // Pins the SHIPPED cameras, not just the comparator — if someone adds or
    // renames a seed camera this test says so rather than silently reordering.
    expect(kingstonCamsFromLine(webcamSeed).map((w) => w.id)).toEqual([
      "kingston-toll-booths",
      "kingston-terminal",
      "kingston-ferry-sign-east",
      "kingston-ferry-sign-west",
      "kingston-lindvog",
      "kingston-barber",
    ]);
  });

  it("reverses the seed's outside-in order rather than coincidentally matching it", () => {
    // Guards against the comparator quietly becoming a no-op.
    const seedOrder = webcamSeed.filter((w) => !w.id.startsWith("edmonds-")).map((w) => w.id);
    expect(kingstonCamsFromLine(webcamSeed).map((w) => w.id)).not.toEqual(seedOrder);
  });

  it("keeps a Chamber-added camera instead of dropping it, in store order at the end", () => {
    // Unknown ids must not vanish — getWebcams() merges admin additions, and a
    // camera the Chamber maps has to appear somewhere.
    const withExtras = [cam("kingston-new-lot"), ...webcamSeed, cam("kingston-another")];
    const out = kingstonCamsFromLine(withExtras).map((w) => w.id);
    expect(out).toContain("kingston-new-lot");
    expect(out).toContain("kingston-another");
    expect(out.slice(-2)).toEqual(["kingston-new-lot", "kingston-another"]);
  });

  it("does not mutate the caller's array", () => {
    // sort() is in-place; filter() must stay upstream of it or getWebcams()'
    // cached value would be reordered for every other consumer.
    const input = [...webcamSeed];
    const before = input.map((w) => w.id);
    kingstonCamsFromLine(input);
    expect(input.map((w) => w.id)).toEqual(before);
  });
});

describe("/line perf floor — the reads it is allowed to make", () => {
  it("uses the cookie-free visibility helper, not the session-reading one", () => {
    // getEffectiveHiddenPaths is a store read (assertPageVisibleStatic uses the
    // same call). assertPageVisible / getSessionUser / getSide would read
    // cookies and mark the route dynamic, making `revalidate` inert forever.
    expect(code).toContain("getEffectiveHiddenPaths");
    for (const banned of ["getSide", "getSessionUser", "cookies(", "headers("]) {
      expect(code, `line-lander.tsx must not reach for ${banned}`).not.toContain(banned);
    }
  });

  it("keeps every new read inside the single Promise.all", () => {
    // A serial await after the block costs a full round trip on every
    // regeneration. Both new reads belong in the existing parallel batch.
    const batch = code.slice(code.indexOf("await Promise.all(["), code.indexOf("]);"));
    expect(batch).toContain("getWebcams()");
    expect(batch).toContain("getEffectiveHiddenPaths()");
  });
});
