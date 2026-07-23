// Client-only helper: dynamically load MapLibre GL and register the pmtiles://
// protocol exactly once, so any map component can read the self-hosted vector
// tiles (E31, ADR-0006). Like leafletBasemap(L), the browser-only libraries are
// imported here (never at module scope in a shared file) so nothing server-side
// pulls in code that touches `window`.

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
