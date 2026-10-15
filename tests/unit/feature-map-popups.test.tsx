// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { FeatureMap } from "@/components/feature-map";
import type { ResolvedMapView } from "@/lib/map/types";

const state = vi.hoisted(() => ({
  clicks: new Map<string, (event: unknown) => void>(),
  popups: [] as Array<{ html: string; element: HTMLElement; open: () => void; close: () => void }>,
  resize: new Set<() => void>(),
  panBy: vi.fn(),
  container: null as HTMLElement | null,
}));

vi.mock("@/lib/map/maplibre", () => {
  class Popup {
    html = "";
    element = document.createElement("div");
    listeners = new Map<string, () => void>();
    constructor() { state.popups.push(this); }
    setHTML(html: string) {
      this.html = html;
      this.element.innerHTML = `<div class="maplibregl-popup-content">${html}<button>Close</button></div>`;
      this.element.getBoundingClientRect = () => ({ left: -67, right: 173, top: 424, bottom: 759 } as DOMRect);
      return this;
    }
    setLngLat() { return this; }
    setMaxWidth(width: string) { this.element.style.maxWidth = width; return this; }
    getElement() { return this.element; }
    on(event: string, callback: () => void) { this.listeners.set(event, callback); return this; }
    open = () => { this.listeners.get("open")?.(); };
    close = () => { this.listeners.get("close")?.(); };
    addTo() { this.open(); return this; }
  }
  class Marker {
    element: HTMLElement;
    constructor(options: { element: HTMLElement }) { this.element = options.element; }
    setLngLat() { return this; }
    setPopup() { return this; }
    addTo() { return this; }
    getElement() { return this.element; }
    remove() {}
  }
  return {
    basemapArchiveUrl: () => "https://example.test/kingston.pmtiles",
    loadMapLibre: async () => ({
      Popup, Marker,
      Map: class {
        constructor(options: { container: HTMLElement }) {
          state.container = options.container;
          Object.defineProperties(options.container, {
            clientWidth: { configurable: true, value: 288 },
            clientHeight: { configurable: true, value: 400 },
          });
          options.container.getBoundingClientRect = () => ({ left: 0, right: 288, top: 285, bottom: 685 } as DOMRect);
        }
        isStyleLoaded() { return true; }
        on(event: string, layerOrCallback: string | (() => void), callback?: (event: unknown) => void) {
          if (event === "click" && typeof layerOrCallback === "string" && callback) state.clicks.set(layerOrCallback, callback);
          if (event === "resize" && typeof layerOrCallback === "function") state.resize.add(layerOrCallback);
        }
        off(event: string, callback: () => void) { if (event === "resize") state.resize.delete(callback); }
        addControl() {}
        addSource() {}
        addLayer() {}
        getLayer() { return undefined; }
        getContainer() { return state.container; }
        getCanvas() { return document.createElement("canvas"); }
        project() { return { x: 140, y: 180 }; }
        getBounds() { return { getWest: () => -123, getEast: () => -122, getSouth: () => 47, getNorth: () => 48 }; }
        getZoom() { return 14; }
        fitBounds() {}
        panBy = state.panBy;
        resize() {}
        remove() {}
      },
      LngLatBounds: class {
        extend() { return this; }
        getWest() { return -122.5; }
        getEast() { return -122.49; }
        getNorth() { return 47.8; }
        getSouth() { return 47.79; }
      },
      NavigationControl: class {},
    }),
  };
});

const VIEW: ResolvedMapView = {
  view: { id: "trails", name: "Trails", center: [47.8, -122.5], zoom: 14, sources: [], published: true },
  builtins: {},
  features: [
    { id: "park", kind: "marker", title: "Park <script>alert(1)</script>",
      notes: '<img src=x onerror="alert(1)"><div><b>nested</div><a href="javascript:alert(1)">bad</a>',
      category: "park", point: [47.7961, -122.4972], views: ["trails"],
      link: "https://example.test/park" },
    { id: "walk", kind: "trail", title: "Walk", path: [[47.7961, -122.4972], [47.797, -122.496]], views: ["trails"] },
  ],
};

beforeEach(() => {
  state.clicks.clear(); state.popups.length = 0; state.panBy.mockClear(); state.resize.clear();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) {
      queueMicrotask(() => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as never));
    }
    observe() {} disconnect() {}
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function draw() {
  render(<FeatureMap resolved={VIEW} />);
  await waitFor(() => expect(state.clicks.has("fm-dashed")).toBe(true));
}

describe("public map popups", () => {
  it("keeps long marker content keyboard-scrollable and pans a clipped popup inside the map", async () => {
    await draw();
    state.popups[0].open();
    const popup = state.popups[0].element;
    const body = popup.querySelector<HTMLElement>(".fm-popup-body");
    expect(body?.style.maxHeight).toBe("300px");
    expect(body?.style.overflowY).toBe("auto");
    expect(body?.tabIndex).toBe(0);
    expect(popup.style.maxWidth).toBe("240px");
    expect(state.panBy).toHaveBeenCalledWith([-79, 86], { duration: 0 });
    expect(body?.querySelector('a[href="https://example.test/park"]')).not.toBeNull();
    expect(body?.querySelector("button")).toBeNull();
    expect(popup.querySelector("button")).not.toBeNull();
  });

  it("re-fits on map resize and removes the listener when closed", async () => {
    await draw();
    state.popups[0].open();
    expect(state.resize.size).toBe(1);
    Object.defineProperty(state.container, "clientHeight", { configurable: true, value: 300 });
    for (const resize of state.resize) resize();
    expect(state.popups[0].element.querySelector<HTMLElement>(".fm-popup-body")?.style.maxHeight).toBe("200px");
    state.popups[0].close();
    expect(state.resize.size).toBe(0);
  });

  it("does not pan a popup that already fits", async () => {
    await draw();
    state.popups[0].element.getBoundingClientRect = () => ({ left: 24, right: 264, top: 310, bottom: 650 } as DOMRect);
    state.popups[0].open();
    expect(state.panBy).not.toHaveBeenCalled();
  });

  it.each(["maplibregl-marker", "maplibregl-popup"])("ignores geometry hits from a %s descendant", async (className) => {
    await draw();
    const wrapper = document.createElement("div"); wrapper.className = className;
    const child = document.createElement("span"); wrapper.append(child);
    const event = { originalEvent: { target: child }, features: [{ properties: { popup: "Walk details" } }], lngLat: [-122.5, 47.8] };
    state.clicks.get("fm-dashed")!(event);
    expect(state.popups).toHaveLength(1);
  });

  it("still opens exactly one geometry popup for overlapping canvas layers", async () => {
    await draw();
    const event = { originalEvent: { target: document.createElement("canvas") }, features: [{ properties: { popup: "Walk details" } }], lngLat: [-122.5, 47.8] };
    state.clicks.get("fm-dashed")!(event);
    state.clicks.get("fm-dashed")!(event);
    expect(state.popups).toHaveLength(2);
    expect(state.popups[1].html).toContain("Walk details");
    expect(state.popups[1].element.querySelector(".fm-popup-body")).not.toBeNull();
  });

  it("keeps hostile feature text escaped inside the new scrolling body", async () => {
    await draw();
    const popup = state.popups[0].element;
    expect(popup.querySelector("script, img, [onerror]")).toBeNull();
    expect(popup.textContent).toContain("<script>alert(1)</script>");
    expect(popup.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(popup.textContent).toContain('href="javascript:alert(1)"');
    expect(popup.querySelectorAll("a")).toHaveLength(1);
    expect(popup.querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
