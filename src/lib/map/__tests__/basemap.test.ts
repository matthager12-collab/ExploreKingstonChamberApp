import { describe, expect, it } from "vitest";
import { mapStyle, TILES_PMTILES_PATH, VECTOR_ATTRIBUTION } from "@/lib/map/basemap";
import { abbreviateStreetName } from "@/lib/map/street-abbrev";
import streetAbbrevs from "@/lib/map/street-abbrevs.json";

// Guards the single source of truth for the map base layer. The vector swap
// (E31, ADR-0006) landed and E32 removed the legacy raster config — these
// expectations now describe the only base layer in the tree.
describe("mapStyle (self-hosted vector base)", () => {
  const style = mapStyle(`https://example.test${TILES_PMTILES_PATH}`);

  it("reads our same-origin PMTiles route via the pmtiles:// protocol", () => {
    const src = style.sources.kingston as { type: string; url: string };
    expect(src.type).toBe("vector");
    expect(src.url).toBe(`pmtiles://https://example.test${TILES_PMTILES_PATH}`);
  });

  it("carries NO POI layer and NO icons — so no church symbol can ever appear", () => {
    for (const layer of style.layers) {
      expect((layer as { "source-layer"?: string })["source-layer"]).not.toBe("pois");
      // Symbol layers are allowed for street-name TEXT only: an icon needs a
      // sprite image, and the style must never grow one.
      const layout = (layer as { layout?: Record<string, unknown> }).layout ?? {};
      expect(layout["icon-image"]).toBeUndefined();
      if (layer.type === "symbol") {
        expect((layer as { "source-layer"?: string })["source-layer"]).toBe("roads");
        expect(layout["text-field"]).toBeDefined();
      }
    }
    expect(style.sprite).toBeUndefined(); // no sprite = no icon can ever render
  });

  it("is fully self-hosted: glyphs come from OUR origin, never a third party", () => {
    expect(style.glyphs).toBe("https://example.test/fonts/{fontstack}/{range}.pbf");
  });

  it("labels streets from the roads layer", () => {
    const labels = style.layers.find((l) => l.id === "road-labels");
    expect(labels?.type).toBe("symbol");
    expect((labels as { layout?: Record<string, unknown> }).layout?.["text-font"]).toEqual([
      "Noto Sans Regular", // the glyph set committed under public/fonts
    ]);
  });

  // Street-label density (owner feedback 2026-08-01): the public maps open at
  // town-overview zoom (/eat fits ~z14.9, the SR-104 map ~z13.6 at typical
  // viewports) and must show more than one street name there.
  describe("street-label density", () => {
    const symbolIds = style.layers.filter((l) => l.type === "symbol").map((l) => l.id);
    const byId = new Map(style.layers.map((l) => [l.id, l]));
    type SymbolLayer = {
      minzoom?: number;
      maxzoom?: number;
      filter?: unknown[];
      layout?: Record<string, unknown>;
    };
    const overview = byId.get("road-names-overview") as SymbolLayer;
    const minor = byId.get("road-labels-minor") as SymbolLayer;
    const main = byId.get("road-labels") as SymbolLayer;
    // All three filter on ["match", ["get","kind"], [...kinds], true, false]
    const kindsOf = (l: SymbolLayer) => l.filter?.[2] as string[];

    it("has no duplicate layer ids", () => {
      const ids = style.layers.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("carries the three road-name layers, overview placed first (so the two line-placed layers win collisions)", () => {
      expect(symbolIds).toEqual(["road-names-overview", "road-labels-minor", "road-labels"]);
    });

    it("labels minor + residential streets from the town-overview zoom the maps open at", () => {
      // Overview names start at z13 (the tiles carry minor-road names from
      // z14 tiles, i.e. any view zoomed 14+; main-road names from z12 tiles).
      expect(overview.minzoom).toBe(13);
      expect(kindsOf(overview)).toContain("minor_road");
      // Main roads label from z12 — the data floor: tiles have no names below.
      expect(main.minzoom).toBe(12);
      // The overview layer hands off to the line-placed minor layer as you
      // zoom in: their ranges must overlap (no zoom band with no minor names).
      expect(minor.minzoom).toBeLessThanOrEqual(overview.maxzoom as number);
    });

    it("never labels ferry routes or rail as streets", () => {
      // The tiles DO carry named ferry/rail features on the roads layer
      // ("Edmonds - Kingston Ferry", "Victoria Clipper - Seattle ↔ Victoria")
      // — a kind filter that admitted them would float route names over water.
      for (const l of [overview, minor, main]) {
        expect(kindsOf(l)).not.toContain("ferry");
        expect(kindsOf(l)).not.toContain("rail");
      }
    });

    it("renders USPS-abbreviated names via the generated match table, falling back to the raw tile name", () => {
      // coalesce(short_name, match(name -> abbreviated, else name)): an
      // official OSM short name still wins if the tiles ever carry one; a name
      // the table lacks (tiles rebuilt before `npm run tiles:abbrevs`) falls
      // back to the raw name — a stale table can cost an abbreviation, never
      // a label.
      const rawName = ["coalesce", ["get", "name"], ""];
      const pairs = Object.entries(streetAbbrevs as Record<string, string>).flat();
      expect(pairs.length).toBeGreaterThan(0);
      for (const l of [overview, minor, main]) {
        expect(l.layout?.["text-field"]).toEqual([
          "coalesce",
          ["get", "short_name"],
          ["match", rawName, ...pairs, rawName],
        ]);
      }
    });

    it("abbreviates mechanically, never renames: every table value re-derives from its key (USPS rules only)", () => {
      // The style can only ever show a name the mechanical function produces
      // from the full OSM name — a hand-edited "SR 104" entry fails here.
      for (const [full, abbr] of Object.entries(streetAbbrevs as Record<string, string>)) {
        expect(abbr, `entry for "${full}"`).toBe(abbreviateStreetName(full));
      }
      expect((streetAbbrevs as Record<string, string>)["Northeast State Highway 104"]).toBe(
        "NE State Hwy 104",
      );
    });

    it("keeps the approved z13–14 overview density and relaxes text-padding only from z15 up (owner: more names when zoomed in)", () => {
      const padding = overview.layout?.["text-padding"] as unknown[];
      expect(padding[0]).toBe("interpolate");
      const stops: Array<[number, number]> = [];
      for (let i = 3; i < padding.length; i += 2) {
        stops.push([padding[i] as number, padding[i + 1] as number]);
      }
      // First stop at z14 keeps everything at z<=14 exactly at the #128 value.
      expect(stops[0]).toEqual([14, 20]);
      // Padding only ever decreases as you zoom in (never re-clutters a level
      // the owner already approved, never tightens the town overview).
      for (let i = 1; i < stops.length; i++) {
        expect(stops[i][0]).toBeGreaterThan(stops[i - 1][0]);
        expect(stops[i][1]).toBeLessThan(stops[i - 1][1]);
      }
    });

    it("repeats long street names: line layers carry a tightened symbol-spacing", () => {
      // MapLibre's default is 250; both line-placed layers must sit at or
      // below it so long streets restate their name along the way.
      for (const l of [minor, main]) {
        const spacing = l.layout?.["symbol-spacing"] as number;
        expect(spacing).toBeLessThanOrEqual(250);
        expect(spacing).toBeGreaterThanOrEqual(100); // sanity: not wallpaper
      }
    });

    it("caps line-label text-size growth at z16 (placement reserves room at the z18-evaluated size — an uncapped ramp un-places labels at town zoom)", () => {
      for (const l of [minor, main]) {
        const size = l.layout?.["text-size"] as unknown[];
        expect(size[0]).toBe("interpolate");
        // last stop zoom must be <= 16 so the z18-evaluated size equals the cap
        const lastStopZoom = size[size.length - 2] as number;
        expect(lastStopZoom).toBeLessThanOrEqual(16);
      }
    });
  });

  it("draws the recognizable base layers", () => {
    const ids = style.layers.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(["earth", "water", "roads", "buildings"]));
  });

  it("credits OSM (ODbL) and Protomaps on the vector source", () => {
    expect(VECTOR_ATTRIBUTION).toContain("OpenStreetMap");
    expect(VECTOR_ATTRIBUTION).toContain("Protomaps");
  });
});
