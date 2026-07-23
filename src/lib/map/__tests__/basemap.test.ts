import { describe, expect, it, vi } from "vitest";
import { BASEMAP, leafletBasemap, mapStyle, TILES_PMTILES_PATH } from "@/lib/map/basemap";

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

describe("mapStyle (self-hosted vector base)", () => {
  const style = mapStyle(`https://example.test${TILES_PMTILES_PATH}`);

  it("reads our same-origin PMTiles route via the pmtiles:// protocol", () => {
    const src = style.sources.kingston as { type: string; url: string };
    expect(src.type).toBe("vector");
    expect(src.url).toBe(`pmtiles://https://example.test${TILES_PMTILES_PATH}`);
  });

  it("carries NO POI layer and NO labels — so no church symbol can ever appear", () => {
    for (const layer of style.layers) {
      expect((layer as { "source-layer"?: string })["source-layer"]).not.toBe("pois");
      expect(layer.type).not.toBe("symbol"); // no text/label layers
    }
  });

  it("is fully self-hosted: no external glyphs or sprite", () => {
    expect(style.glyphs).toBeUndefined();
    expect(style.sprite).toBeUndefined();
  });

  it("draws the recognizable base layers", () => {
    const ids = style.layers.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(["earth", "water", "roads", "buildings"]));
  });
});
