# ADR-0006 — Self-hosted vector basemap (Protomaps PMTiles + MapLibre GL + terra-draw)

## Status

Accepted — records the 2026-07-22 owner decision (memory note
`maps-vector-migration-direction`, epic `P4-E31-vector-basemap-migration`) and
its execution across E31 (public maps, 2026-07-23: PRs #97, #100, #105) and E32
(admin editors, this PR series: #113, #114, #115). Minted at execution time per
the ADR-0005 pattern; the decision itself was made and human-accepted before
any of these PRs landed.

## Context

Every map in the app — three public maps (`feature-map`, `ferry-vessel-map`,
`sr104-traffic-map`), the kiosk map, and two admin editors — rendered raster
tiles from `tile.openstreetmap.org` through Leaflet. A flattened raster base is
an image we cannot edit, which produced two concrete, owner-visible problems:

1. **The church cross.** OSM's Standard raster bakes a `place_of_worship`
   cross symbol into downtown tiles. It is part of the image — not a layer we
   can filter — and the Chamber does not want it on the tourism map.
2. **Curb-level parking.** The parking map draws street rules as centre-line
   overlays; two-sided curb rendering (`line-offset`) needs a vector engine
   (prototype-proven before this charter).

Secondary drivers: brand/dark theming, offline tiles for the E13 PWA, no
external tile dependency (OSM's tile policy is for light use, not a production
app), and retiring the unmaintained-feeling Leaflet+geoman editor stack.

## Decision

- **Base data:** a downtown-Kingston-plus-surroundings bbox PMTiles archive
  built from OSM data (build parameterized by bbox so it can widen later),
  stored in a **dedicated private R2 bucket** (`R2_TILES_*`, distinct from the
  image bucket) and served by the same-origin range proxy
  `/api/map/tiles/kingston.pmtiles` (`src/lib/map/tiles-store.ts`).
- **Style:** a hand-rolled MapLibre style in `src/lib/map/basemap.ts`
  (`mapStyle()`), deliberately **label-free and POI-free** — no glyphs, no
  sprite, no external fetches, and structurally no way for a church symbol (or
  any POI icon) to appear. Labels via self-hosted glyphs are a later
  refinement.
- **Renderer:** MapLibre GL (v4, namespace import) + `pmtiles` protocol,
  loaded through the shared client-only seam `src/lib/map/maplibre.ts`.
  Public maps lazy-load the engine behind an IntersectionObserver to hold the
  E15 Lighthouse floor; admin editors load eagerly (the map is the page's
  point and `/admin` is not Lighthouse-gated).
- **Editing:** the two admin editors run **terra-draw** (+ MapLibre adapter)
  for draw/vertex-edit/drag, replacing Leaflet+geoman. The wire format is
  unchanged: stored geometry stays `[lat,lng]`, open rings, r6-rounded —
  conversion is centralized in `src/lib/map/draw-coords.ts` and
  characterization-tested (a save must round-trip byte-identically).
- **No vendor tiles, no API keys.** Self-hosted only. Adopting a managed tile
  provider would be an amendment to this ADR, never a code-review call.

## Consequences

- OSM raster URLs and the Leaflet/geoman dependencies are **gone from the
  tree**; `basemap.ts` is the single place the base layer is defined.
- Attribution is OSM (ODbL) + Protomaps, carried on the vector source.
- Tile freshness is now our responsibility: the PMTiles build + refresh
  runbook lives in `docs/OPERATIONS.md`; OSM-derived data refreshes
  ~quarterly, which is fine for a basemap.
- The map is now data: per-layer styling, feature filtering, dark/brand
  themes, curb-offset parking, and PWA offline precache are all unlocked.

## Deferred (tracked, not silently dropped)

- **Curb model** (E31 phase 6): `MapZone` curb side + rule, `line-offset`
  rendering, `parkingAreas` retirement.
- **Polish** (E31 phase 7): brand palette/dark mode, MapLibre-native label
  collision (retiring part of `docs/MAP-LABELS.md`'s custom declutter), PWA
  offline PMTiles precache, self-hosted glyph labels.
