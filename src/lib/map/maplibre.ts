// Client-only helper: dynamically load MapLibre GL and register the pmtiles://
// protocol exactly once, so any map component can read the self-hosted vector
// tiles (E31, ADR-0006). Like leafletBasemap(L), the browser-only libraries are
// imported here (never at module scope in a shared file) so nothing server-side
// pulls in code that touches `window`.

import { OFFLINE_TILES_PATH, TILES_PMTILES_PATH } from "./basemap";

let registered = false;

/** Load the MapLibre namespace with the pmtiles:// protocol registered once.
 *  maplibre-gl v4 has no default export — use the module namespace directly. */
export async function loadMapLibre(): Promise<typeof import("maplibre-gl")> {
  const maplibregl = await import("maplibre-gl");
  if (!registered) {
    const { Protocol } = await import("pmtiles");
    maplibregl.addProtocol("pmtiles", new Protocol().tile);
    registered = true;
  }
  return maplibregl;
}

/** Absolute `pmtiles://…` archive URL for a same-origin tiles path. Browser-only
 *  (reads location.origin), so it lives here rather than in the isomorphic
 *  basemap.ts. */
export function pmtilesUrl(path: string): string {
  return new URL(path, location.origin).href;
}

/** The archive URL a PUBLIC map should read at init (E31 Phase 7).
 *
 *  Online: the full R2-proxied archive. Offline (`navigator.onLine === false`
 *  at init — the reload-while-offline case the PWA promises): the small
 *  downtown slice the service worker precached, whose byte ranges the worker
 *  serves from CacheStorage. The check runs ONCE, at map construction; a
 *  network that drops mid-session keeps the online archive (already-loaded
 *  tiles stay on screen, new areas go base-less until a reload), and a network
 *  that RETURNS after an offline init keeps the slice until a reload. Both are
 *  deliberate: swapping a style's source mid-flight re-fetches the world for
 *  an edge nobody is standing in.
 *
 *  navigator.onLine's known weakness is false POSITIVES (LTE with no data
 *  reads as online). That fails toward the normal online path — never toward
 *  serving the slice to a connected visitor — so it is safe as the only
 *  signal. */
export function basemapArchiveUrl(): string {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return pmtilesUrl(offline ? OFFLINE_TILES_PATH : TILES_PMTILES_PATH);
}
