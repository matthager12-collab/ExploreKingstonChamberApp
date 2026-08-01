// Single source of truth for the map base layer.
//
// E31 Phase 1 (ADR-0006) centralized the basemap so the vector swap was a
// change in ONE file; E32 finished that migration — every map (public and
// admin) now renders the self-hosted vector base below, and the legacy OSM
// raster config + Leaflet are gone from the tree.

import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";

import streetAbbrevs from "./street-abbrevs.json";

// --- Self-hosted vector base (MapLibre + our Protomaps PMTiles, E31) --------

/** Same-origin path to the self-hosted vector tiles (the E31 Phase 2 route). */
export const TILES_PMTILES_PATH = "/api/map/tiles/kingston.pmtiles";

/** Same-origin path to the SMALL offline slice (downtown bbox, z≤15) that the
 *  service worker precaches for the PWA (E31 Phase 7, charter AC 9). A static
 *  file under public/, rebuilt by `node scripts/build-tiles.mjs --offline`.
 *  public/sw.js hardcodes this same string (it cannot import TS) and serves
 *  byte ranges from its cached copy when the network is gone;
 *  tests/unit/sw-contract.test.ts fails the build if the two ever drift. */
export const OFFLINE_TILES_PATH = "/offline-tiles/kingston-downtown.pmtiles";

// Road `kind` values that get street-name labels. The union is also what
// scripts/derive-street-abbrevs.ts scans when it regenerates the abbreviation
// table, so the table and the label filters can never disagree on eligibility.
// ferry + rail are deliberately absent everywhere: the tiles carry NAMED
// ferry/rail features on the roads layer ("Edmonds - Kingston Ferry") and a
// filter that admitted them would float route names over water.
export const MAIN_LABELED_ROAD_KINDS = ["highway", "major_road", "medium_road"] as const;
export const MINOR_LABELED_ROAD_KINDS = ["minor_road", "path", "other"] as const;
export const LABELED_ROAD_KINDS: readonly string[] = [
  ...MAIN_LABELED_ROAD_KINDS,
  ...MINOR_LABELED_ROAD_KINDS,
];

/**
 * The shared text-field for every street-label layer: USPS-abbreviated names
 * (owner request 2026-08-01).
 *
 * The tiles carry full OSM names only ("Northeast State Highway 104") and
 * MapLibre expressions cannot string-replace, so the mechanical USPS rules
 * (src/lib/map/street-abbrev.ts) run at BUILD time over every road name in the
 * served archive; the resulting full->abbreviated table (street-abbrevs.json,
 * regenerate with `npm run tiles:abbrevs`) folds into one ["match"] expression
 * here. Unknown names — a rebuilt archive gaining streets before the table is
 * refreshed — fall back to the raw tile name, so a stale table can only ever
 * cost an abbreviation, never a label. An official OSM `short_name` would win
 * over both, but the current build has no such attribute.
 *
 * The inner coalesce to "" keeps the match input string-typed for unnamed
 * roads (a null input would be a runtime expression error); "" matches no
 * table key and renders no label, exactly like the plain name lookup did.
 */
function streetTextField(): ExpressionSpecification {
  const rawName: ExpressionSpecification = ["coalesce", ["get", "name"], ""];
  const pairs = Object.entries(streetAbbrevs as Record<string, string>).flat();
  const abbreviated =
    pairs.length === 0
      ? rawName
      : (["match", rawName, ...pairs, rawName] as unknown as ExpressionSpecification);
  return ["coalesce", ["get", "short_name"], abbreviated];
}

export const VECTOR_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a>';

/**
 * "Evergreen & Sound" basemap palette. The STRUCTURE (named PALETTE constant,
 * derive-from-brand-tokens doctrine) is E31 phase 7; the VALUES are the
 * owner-accepted colorway recorded in ADR-0007
 * (docs/adr/ADR-0007-map-colorway-and-overlay-palette.md) — that ADR is the
 * authority on every hex below; change values only by amending it. Derived
 * from the Tailwind brand tokens in src/app/globals.css — TINTS of the tokens,
 * not the raw values, because a basemap needs near-neutral surfaces the UI
 * tokens are too saturated to provide:
 *
 *   shell/sand → paper + land, cooled to marine-layer neutrals (the two
 *     largest surfaces, earth + building, are near-achromatic on purpose —
 *     ADR-0007 §2: base is a LIGHT family so the DARK overlay hues own meaning)
 *   seaglass #b7e0f2 / tide #1e96c0 → water (quieted; no longer the loudest fill)
 *   fern #4a7c59 → greenery tints (forest/greenspace finally own green)
 *   warm sand → highway/major-road (NOT mustard, NOT coral-amber)
 *   ink #20262e / ink-soft #6b7683 → street-name text, pulled toward the greens
 *
 * If a brand token changes, re-derive these rather than editing ad hoc — and
 * per ADR-0007 §3 the greens sit ONE step under the label-contrast ceiling
 * (forest #b3cbad = 4.84:1 worst text surface): do NOT deepen any green
 * without re-running text contrast on every surface.
 */
const PALETTE = {
  bg: "#eef0ee", // paper behind/beyond the tiled area (halo color too) — marine-layer light
  earth: "#e4e8e4", // land — chroma 4, neutral ground
  water: "#b5d2de", // tide/seaglass family, quieted
  forest: "#b3cbad", // fern-derived; the §3 label-contrast ceiling sits right above this
  grassland: "#c3d4bd",
  farmland: "#dad7c4",
  landcover: "#cdd6c8",
  cemetery: "#c9d2c4",
  pedestrian: "#e7e9e5",
  greenspace: "#aac4a4", // parks/gardens in the landuse layer
  building: "#d8ddd7", // chroma 6, neutral
  buildingOutline: "#bfc6be",
  highway: "#e6dcc4", // warm sand, EXACTLY this — the only sand that cleared the old P&R orange (ADR-0007 §5)
  majorRoad: "#eee7d6",
  road: "#ffffff",
  path: "#d6cfbd",
  rail: "#c6c2b4",
  labelMinor: "#59645d", // ink-soft pulled toward the greens
  labelMain: "#3f4b45", // toward ink
} as const;

/**
 * MapLibre base style for the self-hosted Kingston vector tiles (ADR-0006).
 *
 * Fully self-hosted: tiles come from our same-origin `/api/map/tiles` route
 * and street-name glyphs from `public/fonts` (Noto Sans, OFL — the Protomaps
 * basemaps glyph set). There is still NO sprite, NO icon, and NO `pois`
 * source-layer, which is why no church symbol (or any POI icon) can appear —
 * the only symbol layers are street-name TEXT from the roads layer (names
 * USPS-abbreviated through the generated match table, see streetTextField).
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
      { id: "bg", type: "background", paint: { "background-color": PALETTE.bg } },
      { id: "earth", type: "fill", source: "kingston", "source-layer": "earth", paint: { "fill-color": PALETTE.earth } },
      {
        id: "landcover", type: "fill", source: "kingston", "source-layer": "landcover",
        paint: {
          "fill-color": ["match", ["get", "kind"], "forest", PALETTE.forest, "grassland", PALETTE.grassland, "farmland", PALETTE.farmland, PALETTE.landcover],
          "fill-opacity": 0.55,
        },
      },
      {
        id: "landuse", type: "fill", source: "kingston", "source-layer": "landuse",
        filter: ["match", ["get", "kind"], ["park", "forest", "wood", "grass", "recreation_ground", "nature_reserve", "meadow", "cemetery", "pedestrian", "garden", "village_green", "farmland"], true, false],
        paint: { "fill-color": ["match", ["get", "kind"], "cemetery", PALETTE.cemetery, "pedestrian", PALETTE.pedestrian, PALETTE.greenspace], "fill-opacity": 0.7 },
      },
      { id: "water", type: "fill", source: "kingston", "source-layer": "water", paint: { "fill-color": PALETTE.water } },
      {
        id: "buildings", type: "fill", source: "kingston", "source-layer": "buildings", minzoom: 13,
        paint: { "fill-color": PALETTE.building, "fill-outline-color": PALETTE.buildingOutline, "fill-opacity": 1 },
      },
      {
        id: "roads", type: "line", source: "kingston", "source-layer": "roads",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["match", ["get", "kind"], "highway", PALETTE.highway, "major_road", PALETTE.majorRoad, "medium_road", PALETTE.road, "minor_road", PALETTE.road, "path", PALETTE.path, "rail", PALETTE.rail, PALETTE.road],
          // Pure zoom interpolation (uniform width): the MapLibre style spec
          // forbids mixing ["zoom"] with feature data (["get","kind"]) inside one
          // interpolate. Roads are differentiated by colour above; per-kind width
          // would need separate layers (a later refinement).
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 13, 1.8, 16, 5, 19, 12],
        },
      },
      {
        // Overview street names (town zoom, ~z13–16): HORIZONTAL, point-placed
        // labels for every named road, paper-map style. Line-placed labels
        // barely work at these zooms here: MapLibre reserves room for the z18
        // text size along each tile-clipped fragment, and downtown Kingston
        // sits on the z14/z15 tile-column boundary (lng ≈ -122.4939), so its
        // short street fragments reject nearly every along-the-line anchor —
        // the owner's "only SR-104 is labeled" screenshot. Point placement on
        // line features anchors at line vertices and needs no along-line fit,
        // so short fragments still get a name; `text-padding` is the density
        // dial (collision-only decluttering). The two line-placed layers sit
        // later in the array, so where a rotated label and a horizontal one
        // fight for the same spot, the rotated one wins and this one drops.
        // TEXT ONLY — no icon-image anywhere in this style, so the
        // no-POI-symbol guarantee holds.
        id: "road-names-overview", type: "symbol", source: "kingston", "source-layer": "roads",
        minzoom: 13,
        maxzoom: 16.5,
        filter: ["match", ["get", "kind"], [...LABELED_ROAD_KINDS], true, false],
        layout: {
          "symbol-placement": "point",
          "text-field": streetTextField(),
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 13, 9, 16, 11.5],
          // The density dial (collision-only decluttering). z13–14 keeps the
          // #128 spacing the owner approved; from z15 the padding relaxes so
          // residential blocks label comprehensively as you zoom in (owner
          // request 2026-08-01: "increase the amount of named streets
          // especially when zoomed in").
          "text-padding": ["interpolate", ["linear"], ["zoom"], 14, 20, 15, 10, 16, 4],
        },
        paint: {
          "text-color": PALETTE.labelMinor,
          "text-halo-color": PALETTE.bg,
          "text-halo-width": 1.3,
        },
      },
      {
        // Side-street names, rotated along the street. Line placement only
        // finds room once fragments are long enough on screen (z15+ here) —
        // below that the overview layer above carries the density. Capping the
        // size ramp at z16 matters beyond looks: placement reserves room at the
        // z18-evaluated size, so a steeper ramp would un-place labels.
        id: "road-labels-minor", type: "symbol", source: "kingston", "source-layer": "roads",
        minzoom: 15,
        filter: ["match", ["get", "kind"], [...MINOR_LABELED_ROAD_KINDS], true, false],
        layout: {
          "symbol-placement": "line",
          // 240 (was 300): long residential streets repeat their name sooner.
          "symbol-spacing": 240,
          "text-field": streetTextField(),
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 15, 11, 16, 12],
          "text-padding": 1,
        },
        paint: {
          "text-color": PALETTE.labelMinor,
          "text-halo-color": PALETTE.bg,
          "text-halo-width": 1.3,
        },
      },
      {
        // Main-road names, rotated along the road. Placed after (= wins
        // collisions against) both layers above. minzoom 12 is the data floor:
        // the tiles carry no road names below z12. The z16 size cap keeps the
        // z18-evaluated placement size small enough that long names ("South
        // Kingston Road Northeast") still fit their merged lines at town zoom.
        id: "road-labels", type: "symbol", source: "kingston", "source-layer": "roads",
        minzoom: 12,
        filter: ["match", ["get", "kind"], [...MAIN_LABELED_ROAD_KINDS], true, false],
        layout: {
          "symbol-placement": "line",
          "text-field": streetTextField(),
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 12, 9.5, 16, 13],
          // 150 (was 180): SR-104 and the arterials repeat their name more
          // often, so a street-level view still shows what road you're on.
          "symbol-spacing": 150,
          "text-padding": 1,
        },
        paint: {
          "text-color": PALETTE.labelMain,
          "text-halo-color": PALETTE.bg,
          "text-halo-width": 1.4,
        },
      },
    ],
  };
}
