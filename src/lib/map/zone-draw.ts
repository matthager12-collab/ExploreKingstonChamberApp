// Bridge between a MapZone's stored geometry and terra-draw's feature store,
// for the parking-zone editor (/admin/map).
//
// Pure and window-free — no React, no map, no terra-draw runtime (the terra-draw
// import is types only). It lives here rather than inside editor.tsx because the
// multi-path bookkeeping below is the part most able to lose an admin's work
// silently, and a client component is not testable in the fast unit suite.
//
// THE PROBLEM THIS SOLVES. A lot is a `polygon` — one shape, one feature. A
// street is `streetPaths`, a LIST of centre-line polylines: OSM splits some
// streets into disjoint stretches and the seed refuses to bridge a gap no source
// claims, so `street-central-ave` and `street-washington-blvd` genuinely carry
// two each. A terra-draw feature holds exactly one geometry, so each path
// becomes its own feature under a derived id and they are reassembled, in index
// order, on save.
//
// WHY THAT ORDERING MATTERS MORE THAN IT LOOKS. `POST /api/admin/parking`
// rebuilds the zone from a field whitelist, so whatever comes back from here IS
// the zone's geometry afterwards. Returning only the path the admin happened to
// be dragging would delete the others — and for a street drawn in the editor
// (no seed row behind it) there is nothing to restore them from.

import type { GeoJSONStoreFeatures } from "terra-draw";

import type { MapZone } from "@/lib/data/parking";
import { r6, toGeoJsonPath, toGeoJsonRing, toStoredPath } from "./draw-coords";

/**
 * Separator between a zone id and a path index in a draw-store feature id.
 *
 * Safe because the admin API's id gate is /^[a-z0-9][a-z0-9-]{0,63}$/i — no
 * zone id can contain a "~", so `split` can never mistake part of an id for an
 * index. `zone-draw.test.ts` pins that against the real regex.
 */
export const PATH_SEP = "~";

export const pathFeatureId = (zoneId: string, index: number): string =>
  `${zoneId}${PATH_SEP}${index}`;

/** Draw-feature id → the zone it belongs to (identity for polygon features). */
export const zoneIdOfFeature = (featureId: string): string =>
  featureId.split(PATH_SEP)[0];

/** Path index encoded in a street feature's id; -1 for a polygon feature. */
export function pathIndexOfFeature(featureId: string): number {
  const raw = featureId.split(PATH_SEP)[1];
  if (raw == null) return -1;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : -1;
}

/** Is this draw-store feature one of OUR zone shapes, rather than a handle,
 *  midpoint or closing point terra-draw renders alongside them? */
export function isZoneFeature(f: GeoJSONStoreFeatures): boolean {
  const mode = f.properties?.mode;
  return (
    (f.geometry.type === "Polygon" && mode === "polygon") ||
    (f.geometry.type === "LineString" && mode === "linestring")
  );
}

/**
 * A zone's editable geometry as terra-draw store features.
 *
 * Street geometry is checked FIRST deliberately: a zone that somehow carried
 * both kinds would otherwise be drawn here as a polygon while the public map
 * rendered it as curb strokes, and the editor must never disagree with what
 * publishes. Degenerate paths (< 2 points) are dropped — terra-draw rejects
 * them anyway, and keeping them would shift every later path's index.
 */
export function zoneDrawFeatures(zone: MapZone): GeoJSONStoreFeatures[] {
  const paths = (zone.streetPaths ?? []).filter((p) => p.length >= 2);
  if (paths.length > 0) {
    return paths.map(
      (path, i) =>
        ({
          id: pathFeatureId(zone.id, i),
          type: "Feature",
          properties: { mode: "linestring", rule: zone.rule },
          geometry: { type: "LineString", coordinates: toGeoJsonPath(path) },
        }) as GeoJSONStoreFeatures,
    );
  }
  if (zone.polygon && zone.polygon.length >= 3) {
    return [
      {
        id: zone.id,
        type: "Feature",
        properties: { mode: "polygon", rule: zone.rule },
        geometry: { type: "Polygon", coordinates: [toGeoJsonRing(zone.polygon)] },
      } as GeoJSONStoreFeatures,
    ];
  }
  return [];
}

/**
 * Read a zone's street geometry back out of a draw-store snapshot, in path
 * order, converted to the stored [lat, lng] wire format.
 *
 * Returns null — NOT an empty array — when the snapshot holds nothing for this
 * zone, so the caller can fall back to the geometry the zone already had. The
 * distinction is the safety net: an empty array would read as "this zone has no
 * lines" and wipe them on the next save.
 */
export function streetPathsFromFeatures(
  zoneId: string,
  features: readonly GeoJSONStoreFeatures[],
): [number, number][][] | null {
  const paths = features
    .filter(
      (f) =>
        f.geometry.type === "LineString" &&
        String(f.id) !== zoneId &&
        zoneIdOfFeature(String(f.id)) === zoneId,
    )
    .sort((a, b) => pathIndexOfFeature(String(a.id)) - pathIndexOfFeature(String(b.id)))
    .map((f) => toStoredPath(f.geometry.coordinates as number[][]))
    .filter((p) => p.length >= 2);
  return paths.length > 0 ? paths : null;
}

/** Midpoint of a drawn path — the label anchor for a new street zone. */
export function pathMidpoint(path: [number, number][]): [number, number] {
  const mid = path[Math.floor(path.length / 2)];
  return [r6(mid[0]), r6(mid[1])];
}
