// @vitest-environment jsdom

// The lazy-load gate on FeatureMap must never be able to switch the map OFF.
//
// Background: the deferral shipped as `rootMargin: "-200px"`. That shorthand
// applies to all four sides, so on any viewport under 400 CSS px the left and
// right insets meet and the root intersection rectangle collapses. WebKit then
// reports isIntersecting: false forever — the map never initialises, and because
// `status` is already "ready" by then, neither the loading nor the error overlay
// renders either. Every non-Max iPhone (375 / 390 / 393 CSS px) showed an empty
// bordered box on /eat, /parking, /map and /map/restrooms for ten days.
//
// It survived CI for two reasons, and this file exists to close both:
//
//   1. Blink disagrees with WebKit here. Chromium clamps the collapsed root to
//      zero width and still reports isIntersecting: true, so desktop, Android
//      and the Lighthouse run all looked fine.
//   2. Every unit test stubs IntersectionObserver with a fake that fires
//      `isIntersecting: true` unconditionally (see
//      ferry-vessel-map-deferred.test.tsx). A stub that ignores rootMargin
//      cannot observe a rootMargin bug — it asserts the very outcome under test.
//
// So this test does NOT go through a stubbed observer. It captures the options
// the component actually passes to the IntersectionObserver constructor and
// checks the geometry itself, against the real device matrix. That is the
// invariant worth pinning: whatever the inset is tuned to, the root must stay a
// positive box on the smallest screen a visitor can bring.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/map/maplibre", () => ({
  loadMapLibre: async () => {
    throw new Error("unreachable: the observer must never fire in this test");
  },
  pmtilesUrl: (p: string) => p,
  basemapArchiveUrl: () => "/api/map/tiles/kingston.pmtiles",
}));

import { FeatureMap } from "@/components/feature-map";
import type { ResolvedMapView } from "@/lib/map/types";

/** Smallest payload that gets the component past `status === "ready"` and into
 *  the effect that builds the observer. No features: nothing here renders a pin. */
const RESOLVED: ResolvedMapView = {
  view: {
    id: "food-drink",
    name: "Food & drink",
    center: [47.7973, -122.4966],
    zoom: 15,
    sources: [],
    published: true,
  },
  features: [],
  builtins: {},
};

/** Real Safari CSS viewport sizes — the widths are what `-200px` collapsed on.
 *  Landscape is included because a vertical-only "-200px 0px" would have failed
 *  there in exactly the same way (~320 px of usable height). */
const DEVICES = [
  { name: "iPhone SE / 12 mini portrait", width: 375, height: 667 },
  { name: "iPhone 13 / 14 portrait", width: 390, height: 664 },
  { name: "iPhone 15 / 16 portrait", width: 393, height: 659 },
  { name: "iPhone 16 Pro portrait", width: 402, height: 674 },
  { name: "iPhone 14 Pro Max portrait", width: 430, height: 739 },
  { name: "iPhone 13 / 14 landscape", width: 844, height: 320 },
  { name: "iPhone SE landscape", width: 667, height: 320 },
  { name: "iPad portrait", width: 820, height: 1000 },
  { name: "desktop", width: 1440, height: 900 },
];

/** Resolve one rootMargin component against the root dimension it applies to,
 *  the way the IntersectionObserver spec does: px is absolute, % is relative. */
function resolveInset(part: string, against: number): number {
  const m = /^(-?\d*\.?\d+)(px|%)$/.exec(part.trim());
  if (!m) throw new Error(`unparseable rootMargin component: "${part}"`);
  const value = Number(m[1]);
  return m[2] === "%" ? (value / 100) * against : value;
}

/** The root intersection rectangle for `margin` at a given viewport, following
 *  the CSS margin shorthand (1 / 2 / 3 / 4 values). */
function rootBox(margin: string, viewport: { width: number; height: number }) {
  const p = margin.trim().split(/\s+/);
  const [top, right, bottom, left] =
    p.length === 1
      ? [p[0], p[0], p[0], p[0]]
      : p.length === 2
        ? [p[0], p[1], p[0], p[1]]
        : p.length === 3
          ? [p[0], p[1], p[2], p[1]]
          : [p[0], p[1], p[2], p[3]];
  return {
    width:
      viewport.width + resolveInset(left, viewport.width) + resolveInset(right, viewport.width),
    height:
      viewport.height + resolveInset(top, viewport.height) + resolveInset(bottom, viewport.height),
  };
}

/** Records constructor options instead of firing — the point is the geometry the
 *  component asked for, not a synthetic intersection we control. */
function captureObserverOptions() {
  const seen: IntersectionObserverInit[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(_cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        seen.push(options ?? {});
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  return seen;
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FeatureMap's lazy-load gate", () => {
  it("defers with a negative inset, so a below-the-fold map stays off the perf budget", () => {
    const seen = captureObserverOptions();
    render(<FeatureMap resolved={RESOLVED} />);

    expect(seen).toHaveLength(1);
    const margin = seen[0].rootMargin ?? "0px";
    // Guard the intent, not the literal: the map must have to be genuinely
    // inside the viewport, or /eat pays for MapLibre during its initial paint.
    const box = rootBox(margin, { width: 1440, height: 900 });
    expect(box.height).toBeLessThan(900);
  });

  it("never collapses the root on any real device viewport", () => {
    const seen = captureObserverOptions();
    render(<FeatureMap resolved={RESOLVED} />);
    const margin = seen[0].rootMargin ?? "0px";

    for (const d of DEVICES) {
      const box = rootBox(margin, d);
      // A zero or negative dimension is the failure mode: on WebKit the
      // observer can then never report an intersection, and the map is dead.
      expect(
        box.width,
        `rootMargin "${margin}" collapses to ${box.width}px wide on ${d.name} (${d.width}x${d.height})`,
      ).toBeGreaterThan(0);
      expect(
        box.height,
        `rootMargin "${margin}" collapses to ${box.height}px tall on ${d.name} (${d.width}x${d.height})`,
      ).toBeGreaterThan(0);
    }
  });

  it("expresses any vertical inset as a percentage, which cannot invert the root", () => {
    const seen = captureObserverOptions();
    render(<FeatureMap resolved={RESOLVED} />);
    const parts = (seen[0].rootMargin ?? "0px").trim().split(/\s+/);
    const vertical = parts[0];

    // A fixed px inset is only ever safe by luck — it stays correct until
    // someone tunes it up, or a smaller phone ships. A percentage is bounded by
    // construction, so this is the property that keeps the fix from regressing.
    expect(
      vertical.endsWith("%") || Number.parseFloat(vertical) >= 0,
      `vertical rootMargin "${vertical}" is a fixed negative px inset; use a percentage so it cannot exceed the viewport`,
    ).toBe(true);
  });
});
