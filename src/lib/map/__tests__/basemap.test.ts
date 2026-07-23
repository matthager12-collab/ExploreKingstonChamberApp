import { describe, expect, it, vi } from "vitest";
import { BASEMAP, leafletBasemap } from "@/lib/map/basemap";

// Guards the single source of truth for the map base layer (E31 Phase 1).
// When the vector swap lands (ADR-0006), these expectations change here, in one
// place — that is the point of centralizing the config.
describe("BASEMAP", () => {
  it("is the OSM raster source shared by every map", () => {
    expect(BASEMAP.url).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(BASEMAP.maxZoom).toBe(19);
    expect(BASEMAP.attribution).toContain("OpenStreetMap");
  });
});

describe("leafletBasemap", () => {
  it("builds the tile layer from BASEMAP, options unchanged", () => {
    const layer = { addTo: vi.fn() };
    const tileLayer = vi.fn().mockReturnValue(layer);
    const L = { tileLayer } as unknown as typeof import("leaflet");

    const result = leafletBasemap(L);

    expect(tileLayer).toHaveBeenCalledWith(BASEMAP.url, {
      maxZoom: BASEMAP.maxZoom,
      attribution: BASEMAP.attribution,
    });
    expect(result).toBe(layer);
  });
});
