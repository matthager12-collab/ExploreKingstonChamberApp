// @vitest-environment jsdom

// A map that does not appear must say so, and a map that should appear must not
// depend on IntersectionObserver being right.
//
// Both rules come from the same incident: `rootMargin: "-200px"` collapsed the
// observer root on every non-Max iPhone, WebKit reported "never intersecting",
// and init() simply never ran. The visitor got an empty bordered box for ten
// days — no error, no legend, no clue — because by the time the reveal gate is
// reached `status` is already "ready", so neither the loading nor the error
// overlay renders. The old `void init()` had the same silent shape for a
// genuinely FAILED init (no WebGL, unreachable style).
//
// So the gate now has two properties worth pinning:
//   1. a rejected init surfaces as "Map unavailable." instead of nothing;
//   2. a plain rect check, derived from the same REVEAL_INSET as the observer's
//      rootMargin, can start the map even if the observer never fires at all —
//      without defeating the deferral that keeps MapLibre off /eat's initial
//      paint.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const loadMapLibre = vi.fn();

vi.mock("@/lib/map/maplibre", () => ({
  loadMapLibre: () => loadMapLibre(),
  pmtilesUrl: (p: string) => p,
  basemapArchiveUrl: () => "http://localhost/api/map/tiles/kingston.pmtiles",
}));

import { FeatureMap } from "@/components/feature-map";
import type { ResolvedMapView } from "@/lib/map/types";

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

/** An observer that records the instance but NEVER fires — the iOS failure. */
function stubDeadIntersectionObserver() {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
}

function stubLiveIntersectionObserver() {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: IntersectionObserverCallback) {
        queueMicrotask(() =>
          cb([{ isIntersecting: true } as IntersectionObserverEntry], this as never),
        );
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
}

/** Drives what the map container reports for its position on screen. jsdom
 *  lays nothing out, so every rect is 0x0 until this says otherwise. */
let rectTop = 10_000; // far below the fold by default
function stubLayout() {
  const vh = 800;
  vi.stubGlobal("innerHeight", vh);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    return { top: rectTop, bottom: rectTop + 460, left: 0, right: 390, width: 390, height: 460, x: 0, y: rectTop, toJSON: () => ({}) } as DOMRect;
  });
}

beforeEach(() => {
  rectTop = 10_000;
  loadMapLibre.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  stubLayout();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a FeatureMap that fails to build", () => {
  it("says 'Map unavailable.' instead of leaving an empty box", async () => {
    stubLiveIntersectionObserver();
    // e.g. no WebGL, or the style/tiles could not be reached.
    loadMapLibre.mockRejectedValue(new Error("WebGL unavailable"));

    render(<FeatureMap resolved={RESOLVED} />);

    // The old `void init()` swallowed this rejection entirely: status stayed
    // "ready", so the container rendered empty and silent.
    await waitFor(() => expect(screen.getByText("Map unavailable.")).toBeInTheDocument());
  });
});

describe("the reveal gate's rect fallback", () => {
  it("still loads the map when IntersectionObserver never fires", async () => {
    stubDeadIntersectionObserver(); // exactly what WebKit did with a collapsed root
    loadMapLibre.mockRejectedValue(new Error("stop after the import")); // we only assert it was reached
    rectTop = 10_000;

    render(<FeatureMap resolved={RESOLVED} />);
    expect(loadMapLibre).not.toHaveBeenCalled();

    // The visitor scrolls the map into view. With no working observer, this
    // rect check is the only thing left that can start the engine.
    rectTop = 100; // top < 800*0.75 and bottom > 800*0.25 -> revealed
    window.dispatchEvent(new Event("scroll"));

    await waitFor(() => expect(loadMapLibre).toHaveBeenCalled());
  });

  it("does not defeat the deferral — scrolling with the map still off screen loads nothing", async () => {
    stubDeadIntersectionObserver();
    loadMapLibre.mockRejectedValue(new Error("should never be reached"));

    render(<FeatureMap resolved={RESOLVED} />);

    // Several scrolls that never bring the map into the reveal band. If this
    // fired, /eat would pay MapLibre's ~216 KB during its initial paint and the
    // Lighthouse script budget would go red.
    rectTop = 900; // below an 800px fold
    window.dispatchEvent(new Event("scroll"));
    rectTop = 700; // visible, but not yet 25% inside
    window.dispatchEvent(new Event("scroll"));

    await Promise.resolve();
    expect(loadMapLibre).not.toHaveBeenCalled();
  });

  it("starts the map exactly once even when both paths fire", async () => {
    stubLiveIntersectionObserver(); // observer fires...
    loadMapLibre.mockRejectedValue(new Error("stop after the import"));
    rectTop = 100; // ...and the rect says revealed too

    render(<FeatureMap resolved={RESOLVED} />);
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("scroll"));

    await waitFor(() => expect(loadMapLibre).toHaveBeenCalled());
    // Two reveal paths must not mean two MapLibre engines for one container.
    expect(loadMapLibre).toHaveBeenCalledTimes(1);
  });
});
