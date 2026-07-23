// Coordinate bridge between the app's stored map geometry and the GeoJSON that
// the MapLibre + terra-draw admin editors speak (E32, ADR-0006).
//
// The stored formats predate the vector migration and are Leaflet-shaped:
//   points/centers: [lat, lng] — paths and polygon rings: [lat, lng][], OPEN
//   (no closing vertex).
// GeoJSON is the transpose — [lng, lat] — and polygon rings are CLOSED (first
// vertex repeated last). Every editor save must convert back EXACTLY: same axis
// order, same 6-decimal rounding, no closing vertex. Anything else silently
// corrupts the geometry every public map renders (E32 FR-EDIT-06), so this
// module is the single conversion point and is characterization-tested.

/** Wire rounding for stored coordinates (~11 cm), matching the admin APIs. */
export const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Stored [lat, lng] → GeoJSON [lng, lat]. */
export function toGeoJsonPosition(p: readonly [number, number]): [number, number] {
  return [p[1], p[0]];
}

/** GeoJSON [lng, lat] → stored [lat, lng], wire-rounded. */
export function toStoredPoint(pos: readonly number[]): [number, number] {
  return [r6(pos[1]), r6(pos[0])];
}

/** Stored open path → GeoJSON LineString coordinates. */
export function toGeoJsonPath(path: readonly [number, number][]): [number, number][] {
  return path.map(toGeoJsonPosition);
}

/** GeoJSON LineString coordinates → stored open [lat, lng] path, wire-rounded. */
export function toStoredPath(coords: readonly (readonly number[])[]): [number, number][] {
  return coords.map(toStoredPoint);
}

/** Stored open ring → closed GeoJSON polygon ring. */
export function toGeoJsonRing(ring: readonly [number, number][]): [number, number][] {
  const coords = toGeoJsonPath(ring);
  if (coords.length > 0) coords.push([coords[0][0], coords[0][1]]);
  return coords;
}

/**
 * GeoJSON polygon ring → stored open ring, wire-rounded. Tolerates an already
 * open ring so a defensive caller can't double-strip a vertex.
 */
export function toStoredRing(coords: readonly (readonly number[])[]): [number, number][] {
  if (coords.length === 0) return [];
  const first = coords[0];
  const last = coords[coords.length - 1];
  const closed = coords.length > 1 && first[0] === last[0] && first[1] === last[1];
  return toStoredPath(closed ? coords.slice(0, -1) : coords);
}
