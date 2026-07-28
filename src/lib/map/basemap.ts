// Single source of truth for the map base layer.
//
// E31 Phase 1 (ADR-0006): the OpenStreetMap raster tile config used to be
// hardcoded in every map component. Centralizing it here means the planned swap
// to the self-hosted Protomaps / MapLibre vector base is a change in ONE file,
// not a hunt across the (three still-frozen) map monoliths. Behavior is
// unchanged in this phase — same tiles, same attribution, same maxZoom.
//
// `leafletBasemap` takes the dynamically-imported leaflet namespace as an
// argument rather than importing leaflet itself, so this module pulls in no
// runtime dependency on the browser-only library (leaflet touches `window` at
// module scope) and stays isomorphic like its neighbours in src/lib/map.

import type { TileLayer } from "leaflet";
import type { StyleSpecification } from "maplibre-gl";

// --- Legacy OSM raster (Leaflet maps not yet migrated to MapLibre) ---------

export const BASEMAP = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
} as const;

/**
 * Build the configured Leaflet base tile layer.
 * @param L the leaflet namespace, i.e. `(await import("leaflet")).default`.
 */
export function leafletBasemap(L: typeof import("leaflet")): TileLayer {
  return L.tileLayer(BASEMAP.url, {
    maxZoom: BASEMAP.maxZoom,
    attribution: BASEMAP.attribution,
  });
}

// --- Self-hosted vector base (MapLibre + our Protomaps PMTiles, E31) --------

/** Same-origin path to the self-hosted vector tiles (the E31 Phase 2 route). */
export const TILES_PMTILES_PATH = "/api/map/tiles/kingston.pmtiles";

export const VECTOR_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a>';

/**
 * MapLibre base style for the self-hosted Kingston vector tiles (ADR-0006).
 *
 * Fully self-hosted: tiles come from our same-origin `/api/map/tiles` route
 * and street-name glyphs from `public/fonts` (Noto Sans, OFL — the Protomaps
 * basemaps glyph set). There is still NO sprite, NO icon, and NO `pois`
 * source-layer, which is why no church symbol (or any POI icon) can appear —
 * the only symbol layer is line-placed street-name TEXT from the roads layer.
 *
 * `pmtilesUrl` is the absolute `pmtiles://…` archive URL; callers build it from
 * `TILES_PMTILES_PATH` + `location.origin` (this module stays window-free —
 * the glyphs URL is derived from the archive URL's origin).
 */
export function mapStyle(pmtilesUrl: string): StyleSpecification {
  return {
    version: 8,
    glyphs: `${new URL(pmtilesUrl).origin}/fonts/{fontstack}/{range}.pbf`,
    sources: {
      kingston: { type: "vector", url: `pmtiles://${pmtilesUrl}`, attribution: VECTOR_ATTRIBUTION },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#f4f1ea" } },
      { id: "earth", type: "fill", source: "kingston", "source-layer": "earth", paint: { "fill-color": "#e8e3d7" } },
      {
        id: "landcover", type: "fill", source: "kingston", "source-layer": "landcover",
        paint: {
          "fill-color": ["match", ["get", "kind"], "forest", "#cfe0bf", "grassland", "#d9e7c9", "farmland", "#e7e3c9", "#dde3d0"],
          "fill-opacity": 0.55,
        },
      },
      {
        id: "landuse", type: "fill", source: "kingston", "source-layer": "landuse",
        filter: ["match", ["get", "kind"], ["park", "forest", "wood", "grass", "recreation_ground", "nature_reserve", "meadow", "cemetery", "pedestrian", "garden", "village_green", "farmland"], true, false],
        paint: { "fill-color": ["match", ["get", "kind"], "cemetery", "#dfe3d0", "pedestrian", "#efe9dc", "#c9e0b6"], "fill-opacity": 0.7 },
      },
      { id: "water", type: "fill", source: "kingston", "source-layer": "water", paint: { "fill-color": "#a6d3e4" } },
      {
        id: "buildings", type: "fill", source: "kingston", "source-layer": "buildings", minzoom: 13.5,
        paint: { "fill-color": "#e3ddcc", "fill-outline-color": "#d2cab4", "fill-opacity": 0.9 },
      },
      {
        id: "roads", type: "line", source: "kingston", "source-layer": "roads",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["match", ["get", "kind"], "highway", "#f4c667", "major_road", "#ffd98a", "medium_road", "#ffffff", "minor_road", "#ffffff", "path", "#e6d9bd", "rail", "#cabfa6", "#ffffff"],
          // Pure zoom interpolation (uniform width): the MapLibre style spec
          // forbids mixing ["zoom"] with feature data (["get","kind"]) inside one
          // interpolate. Roads are differentiated by colour above; per-kind width
          // would need separate layers (a later refinement).
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 13, 1.8, 16, 5, 19, 12],
        },
      },
      {
        // Street names, drawn along the road line. TEXT ONLY — no icon-image
        // anywhere in this style, so the no-POI-symbol guarantee holds.
        id: "road-labels", type: "symbol", source: "kingston", "source-layer": "roads",
        minzoom: 12.5,
        filter: ["match", ["get", "kind"], ["highway", "major_road", "medium_road", "minor_road"], true, false],
        layout: {
          "symbol-placement": "line",
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 12.5, 10, 16, 13, 19, 16],
        },
        paint: {
          "text-color": "#4a4a40",
          "text-halo-color": "#f4f1ea",
          "text-halo-width": 1.4,
        },
      },
    ],
  };
}
