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
