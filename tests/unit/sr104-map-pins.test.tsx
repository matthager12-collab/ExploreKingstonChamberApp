// @vitest-environment jsdom

// The boarding-pass map's context pins (food + restrooms).
//
// This exists because the pins CANNOT be verified in a browser here: every map
// in this repo defers MapLibre behind an IntersectionObserver, and the in-app
// Browser pane never delivers IO callbacks, so no map ever initializes there
// (it also blocks external network). Rather than ship the pin logic unverified
// on the strength of a source grep, this drives the real component with
// MapLibre stubbed and asserts what actually got drawn.
//
// The stub records every Marker construction, which is the only thing worth
// asserting: how many pins, which glyphs, at which coordinates, and — the part
// that matters for honesty — that each restroom's "not field-checked" caveat
// reaches the popup rather than being dropped on the way.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

interface RecordedMarker {
  glyph: string;
  lngLat: [number, number];
  html: string;
}

const markers: RecordedMarker[] = [];

vi.mock("@/lib/map/maplibre", () => {
  class Popup {
    html = "";
    setHTML(h: string) {
      this.html = h;
      return this;
    }
  }
  class Marker {
    private rec: RecordedMarker;
    private el: HTMLElement;
    constructor(opts: { element?: HTMLElement }) {
      this.rec = { glyph: opts.element?.textContent ?? "", lngLat: [0, 0], html: "" };
      this.el = opts.element ?? document.createElement("div");
    }
    // fixMarkerA11y() reads the element after addTo() (real maplibre stamps
    // aria-label there); the stub needs the same surface.
    getElement() {
      return this.el;
    }
    setLngLat(ll: [number, number]) {
      this.rec.lngLat = ll;
      return this;
    }
    setPopup(p: Popup) {
      this.rec.html = p.html;
      return this;
    }
    addTo() {
      markers.push(this.rec);
      return this;
    }
    remove() {}
  }
  return {
    loadMapLibre: async () => ({
      Map: class {
        on(event: string, cb: () => void) {
          if (event === "load") cb();
        }
        addControl() {}
        addSource() {}
        addLayer() {}
        fitBounds() {}
        resize() {}
        remove() {}
        // The component names the canvas region (axe landmark-unique fix).
        getCanvas() {
          return document.createElement("canvas");
        }
      },
      Marker,
      Popup,
      LngLatBounds: class {
        extend() {
          return this;
        }
      },
      NavigationControl: class {},
    }),
    pmtilesUrl: (p: string) => p,
    // E31 Phase 7: the component asks the helper for its archive URL (online
    // path vs the precached offline slice). jsdom has no real network either
    // way — a fixed string is fine here.
    basemapArchiveUrl: () => "/api/map/tiles/kingston.pmtiles",
  };
});

vi.mock("@/lib/map/basemap", () => ({
  TILES_PMTILES_PATH: "/api/map/tiles/kingston.pmtiles",
  OFFLINE_TILES_PATH: "/offline-tiles/kingston-downtown.pmtiles",
  mapStyle: () => ({}),
}));

import { Sr104TrafficMap } from "@/components/sr104-traffic-map";

const FOOD = [
  { id: "ale-house", title: "The Kingston Ale House", lat: 47.7967, lng: -122.4969, note: "About 2 min walk from the line." },
  { id: "cellar-cat", title: "Cellar Cat", lat: 47.7965, lng: -122.4975, note: "About 2 min walk from the line." },
];

const RESTROOMS = [
  {
    id: "restroom-tollbooth-portable",
    title: "Portable toilet — SR 104 tollbooths",
    lat: 47.7959,
    lng: -122.4961,
    note: "Reported by the Kingston Chamber (July 2026) — not field-checked, treat the pin as approximate.",
  },
  { id: "restroom-boat-launch", title: "Public restrooms — boat launch", lat: 47.7964, lng: -122.4993 },
];

/** Fires the IntersectionObserver immediately — jsdom has none, and the map is
 *  built behind one. */
function stubImmediateIntersectionObserver() {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private cb: IntersectionObserverCallback) {
        queueMicrotask(() =>
          this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as never),
        );
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
}

/** Let the deferred init (an async import chain) settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  markers.length = 0;
  stubImmediateIntersectionObserver();
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
});

describe("Sr104TrafficMap context pins", () => {
  it("draws a pin per food and restroom row, on top of the pass-system markers", async () => {
    render(<Sr104TrafficMap food={FOOD} restrooms={RESTROOMS} />);
    await settle();

    expect(markers.filter((m) => m.glyph === "🍴")).toHaveLength(2);
    expect(markers.filter((m) => m.glyph === "🚻")).toHaveLength(2);
    // The three numbered boarding-pass steps and the staging pin are still
    // there — context must not displace what the map is actually for.
    expect(markers.filter((m) => ["1", "2", "3"].includes(m.glyph))).toHaveLength(3);
    expect(markers.filter((m) => m.glyph === "📍")).toHaveLength(1);
  });

  it("puts each pin at its own coordinates, lng first", async () => {
    render(<Sr104TrafficMap food={FOOD} restrooms={RESTROOMS} />);
    await settle();

    const potty = markers.find((m) => m.html.includes("Portable toilet"));
    // Longitude first: a transposed pair is how a restroom ends up in the Pacific.
    expect(potty?.lngLat).toEqual([-122.4961, 47.7959]);
    expect(markers.find((m) => m.html.includes("Ale House"))?.lngLat).toEqual([-122.4969, 47.7967]);
  });

  it("carries the not-field-checked caveat into the restroom popup", async () => {
    render(<Sr104TrafficMap food={FOOD} restrooms={RESTROOMS} />);
    await settle();

    const potty = markers.find((m) => m.html.includes("Portable toilet"));
    expect(potty?.html).toContain("not field-checked");
    expect(potty?.html).toContain("approximate");
  });

  it("omits the note paragraph entirely when a pin has none", async () => {
    render(<Sr104TrafficMap food={FOOD} restrooms={RESTROOMS} />);
    await settle();

    // The boat-launch fixture has no note. An empty <p> would render as a gap.
    const launch = markers.find((m) => m.html.includes("boat launch"));
    expect(launch?.html).not.toContain("<p style=\"margin:4px 0 0;\"></p>");
  });

  it("draws nothing extra, and shows no legend, when no pins are passed", async () => {
    render(<Sr104TrafficMap />);
    await settle();

    expect(markers.filter((m) => m.glyph === "🍴" || m.glyph === "🚻")).toHaveLength(0);
    // /ferry's rendering must look exactly as it did before this feature.
    expect(screen.queryByText(/Also on the map/)).not.toBeInTheDocument();
  });

  it("counts each category in the legend so an absent one is not hunted for", async () => {
    render(<Sr104TrafficMap food={FOOD} restrooms={RESTROOMS} />);
    await settle();

    expect(screen.getByText(/🍴 2 open now/)).toBeInTheDocument();
    expect(screen.getByText(/🚻 2 restrooms/)).toBeInTheDocument();
  });

  it("names only the category that has pins", async () => {
    render(<Sr104TrafficMap restrooms={RESTROOMS} />);
    await settle();

    const legend = screen.getByText(/Also on the map/);
    expect(legend).toHaveTextContent("🚻 2 restrooms");
    expect(legend).not.toHaveTextContent("open now");
  });
});
