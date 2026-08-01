// @vitest-environment jsdom

// FerryVesselMap's two mounting modes.
//
//   /ferry passes `initial` — dynamic page, server payload, boats on first paint.
//   /line  passes nothing   — prerendered page that cannot afford a
//                             10s-revalidate fetch in its ISR window
//                             (tests/unit/line-vessel-cams.test.ts explains why),
//                             so the map fetches its own first payload on reveal.
//
// What is pinned here is the seam between them: no network before the map is
// revealed, an immediate fetch on reveal in the no-`initial` mode, and a caption
// that never accuses WSDOT of being down while the first request is still in
// flight. That last one is the honest-state rule the rest of the app follows —
// "we don't know yet" and "the feed is broken" are different sentences.
//
// MapLibre is stubbed: jsdom has no WebGL, and none of this is about the map
// engine. The stub only has to be shaped enough for the init path to run.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

class FakeMarker {
  private el: HTMLElement;
  constructor(opts?: { element?: HTMLElement }) {
    this.el = opts?.element ?? document.createElement("div");
  }
  // fixMarkerA11y() reads the element after addTo(); mirror real maplibre.
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
      on(event: string, cb: () => void) {
        // Fire `load` synchronously so the marker path is exercised.
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
  // E31 Phase 7: the component asks the helper for its archive URL (online
  // path vs the precached offline slice). jsdom has no real network either
  // way — a fixed string is fine here.
  basemapArchiveUrl: () => "/api/map/tiles/kingston.pmtiles",
}));

vi.mock("@/lib/map/basemap", () => ({
  TILES_PMTILES_PATH: "/api/map/tiles/kingston.pmtiles",
  OFFLINE_TILES_PATH: "/offline-tiles/kingston-downtown.pmtiles",
  mapStyle: () => ({}),
}));

import { FerryVesselMap } from "@/components/ferry-vessel-map";
import type { VesselPosition } from "@/lib/wsf";

const WALLA_WALLA: VesselPosition = {
  name: "Walla Walla",
  lat: 47.8,
  lng: -122.44,
  heading: 270,
  speed: 15,
  atDock: false,
  inService: true,
  headedTo: "Kingston",
};

/** Captures the IntersectionObserver so a test can decide when the map is seen. */
function stubIntersectionObserver() {
  const observers: Array<() => void> = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private cb: IntersectionObserverCallback) {
        observers.push(() =>
          this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as never),
        );
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  return { reveal: () => observers.forEach((fire) => fire()) };
}

function stubFetch(payload: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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

describe("FerryVesselMap with no `initial` (the /line mode)", () => {
  it("does not touch the network until the map is revealed", async () => {
    const fetchMock = stubFetch({ vessels: [WALLA_WALLA], live: true });
    stubIntersectionObserver();

    render(<FerryVesselMap />);

    // Someone who never scrolls this far must cost nothing. The old code set a
    // 20s interval on mount regardless of visibility.
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says it is still looking, not that the feed is down", () => {
    stubFetch({ vessels: [], live: true });
    stubIntersectionObserver();

    render(<FerryVesselMap />);

    // "Live positions need the WSDOT feed" is a claim about WSDOT being
    // unreachable. Before the first request it is simply not known yet.
    expect(screen.getByText(/Finding the boats/)).toBeInTheDocument();
    expect(screen.queryByText(/need the WSDOT feed/)).not.toBeInTheDocument();
  });

  it("fetches immediately on reveal rather than waiting out a poll interval", async () => {
    const fetchMock = stubFetch({ vessels: [WALLA_WALLA], live: true });
    const { reveal } = stubIntersectionObserver();

    render(<FerryVesselMap />);
    reveal();

    // Without the immediate fetch the visitor stares at an empty map for a full
    // 20s — the interval's first tick.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/ferry/vessels"));
    await waitFor(() =>
      expect(screen.getByText(/Live vessel positions from WSDOT/)).toBeInTheDocument(),
    );
  });

  it("reports the feed as unavailable once a request has actually come back empty", async () => {
    stubFetch({ vessels: [], live: false });
    const { reveal } = stubIntersectionObserver();

    render(<FerryVesselMap />);
    reveal();

    await waitFor(() => expect(screen.getByText(/need the WSDOT feed/)).toBeInTheDocument());
  });
});

describe("FerryVesselMap with `initial` (the /ferry mode, unchanged)", () => {
  it("renders the server payload without any loading caption", () => {
    stubFetch({ vessels: [], live: false });
    stubIntersectionObserver();

    render(<FerryVesselMap initial={{ vessels: [WALLA_WALLA], live: true }} />);

    expect(screen.queryByText(/Finding the boats/)).not.toBeInTheDocument();
    expect(screen.getByText(/Live vessel positions from WSDOT/)).toBeInTheDocument();
  });

  it("still names the empty case honestly when the feed reports no boats", () => {
    stubFetch({ vessels: [], live: false });
    stubIntersectionObserver();

    render(<FerryVesselMap initial={{ vessels: [], live: true }} />);

    expect(screen.getByText(/no Edmonds–Kingston boats are reporting a position/)).toBeInTheDocument();
  });

  it("does not re-fetch on reveal — it already has a payload", async () => {
    const fetchMock = stubFetch({ vessels: [], live: false });
    const { reveal } = stubIntersectionObserver();

    render(<FerryVesselMap initial={{ vessels: [WALLA_WALLA], live: true }} />);
    reveal();

    // Polling starts on reveal, but the first tick is 20s out; revealing must
    // not itself trigger a request when the server already supplied one.
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
