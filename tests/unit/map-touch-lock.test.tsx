// @vitest-environment jsdom

// The touch drag-pan lock, driven through all three real map components.
//
// MapLibre enables dragPan (and touchZoomRotate) by default, which puts
// `touch-action: none` on the canvas container — a full-width map then swallows
// every one-finger vertical swipe and the page stops scrolling behind it. On a
// phone the only escape is the Section's 16px `px-4` gutter.
//
// FeatureMap gated this from the start; ferry-vessel-map and sr104-traffic-map
// never did, so /ferry and /line — the two pages someone waiting in the ferry
// line actually opens — were hostile to scroll. All three now share
// @/components/map-touch-lock, and this pins the wiring in each of them,
// because the defect was never in the lock logic: it was that two components
// simply never called it.
//
// The lock is asserted through `dragPan.disable()` rather than a computed
// `touch-action`, because jsdom applies no stylesheet — disable() IS the thing
// that makes MapLibre drop the class the CSS keys on.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const dragPan = { disable: vi.fn(), enable: vi.fn() };

class FakeMarker {
  private el: HTMLElement;
  constructor(opts?: { element?: HTMLElement }) {
    this.el = opts?.element ?? document.createElement("div");
  }
  getElement() {
    return this.el;
  }
  setLngLat() {
    return this;
  }
  setPopup() {
    return this;
  }
  addTo() {
    return this;
  }
  remove() {}
}

vi.mock("@/lib/map/maplibre", () => ({
  loadMapLibre: async () => ({
    Map: class {
      dragPan = dragPan;
      on(event: string, cb: () => void) {
        if (event === "load") cb();
      }
      addControl() {}
      addSource() {}
      addLayer() {}
      getLayer() {}
      setFilter() {}
      fitBounds() {}
      resize() {}
      remove() {}
      project() {
        return { x: 0, y: 0 };
      }
      getBounds() {
        return { contains: () => true };
      }
      // Both components name their canvas region (the axe landmark-unique fix).
      getCanvas() {
        return document.createElement("canvas");
      }
    },
    Marker: FakeMarker,
    Popup: class {
      setHTML() {
        return this;
      }
    },
    LngLatBounds: class {
      extend() {
        return this;
      }
    },
    NavigationControl: class {},
  }),
  pmtilesUrl: (p: string) => p,
  // Absolute on purpose: mapStyle() derives the glyph origin with `new URL`,
  // which jsdom rejects for a relative path. Keeping the real mapStyle in play
  // means these tests exercise the actual style build, not a stub of it.
  basemapArchiveUrl: () => "http://localhost/api/map/tiles/kingston.pmtiles",
}));

import { FerryVesselMap } from "@/components/ferry-vessel-map";
import { Sr104TrafficMap } from "@/components/sr104-traffic-map";

/** Fires the observer immediately, the way the rest of the suite does. */
function stubIntersectionObserver() {
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

/** jsdom has no matchMedia at all, so each test states the pointer it means. */
function stubPointer(kind: "coarse" | "fine") {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("pointer: coarse") && kind === "coarse",
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
}

beforeEach(() => {
  dragPan.disable.mockClear();
  dragPan.enable.mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ vessels: [], live: true }))));
  stubIntersectionObserver();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const MAPS = [
  { name: "Sr104TrafficMap (/ferry, /line)", render: () => render(<Sr104TrafficMap />) },
  { name: "FerryVesselMap (/ferry, /line)", render: () => render(<FerryVesselMap />) },
];

describe.each(MAPS)("$name", ({ render: renderMap }) => {
  it("does not swallow page swipes on touch — panning is locked until tapped", async () => {
    stubPointer("coarse");
    renderMap();

    // The lock has to be applied as the map is built. If it is not, the very
    // first swipe over the map pans it and the page stays put.
    expect(await screen.findByRole("button", { name: /tap to interact with the map/i })).toBeInTheDocument();
    expect(dragPan.disable).toHaveBeenCalled();
  });

  it("hands panning back when the visitor taps", async () => {
    stubPointer("coarse");
    renderMap();

    const btn = await screen.findByRole("button", { name: /tap to interact with the map/i });
    fireEvent.click(btn);

    expect(dragPan.enable).toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /tap to interact with the map/i }),
    ).not.toBeInTheDocument();
  });

  it("leaves desktop alone — a fine pointer never competes with scrolling", async () => {
    stubPointer("fine");
    const { container } = renderMap();

    // Give the deferred init the same chance it gets in the coarse tests.
    await vi.waitFor(() => expect(container.querySelector('[role="region"]')).toBeTruthy());
    expect(dragPan.disable).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /tap to interact with the map/i }),
    ).not.toBeInTheDocument();
  });
});
