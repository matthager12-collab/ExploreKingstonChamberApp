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

Status update, 2026-07-31 — everything deferred at minting has since landed or
been decided:

- **Curb model** (E31 phase 6): LANDED — `MapZone` `streetPaths` + compass
  `curb`, `line-offset` curb strokes (`src/lib/map/curb.ts`), `parkingAreas`
  retired (PR #129).
- **Self-hosted glyph labels**: LANDED — street names render from
  `public/fonts` glyphs with MapLibre-native collision (PR #116, densified in
  PR #128; the style remains sprite-free/POI-free, so the no-church guarantee
  holds).
- **Brand palette** (E31 phase 7): LANDED — `basemap.ts` colors are a named
  `PALETTE` derived from the globals.css brand tokens.
- **Dark mode**: DECIDED-DEFERRED — the app has no dark theme anywhere, so a
  dark map variant waits for one; decision recorded in `docs/MAPS.md` ("The
  basemap"). The vector base makes it a second `PALETTE` when wanted.
- **Label collision**: RESOLVED as a division of labor — native symbol
  collision for street names, the hand-rolled chip declutter (deliberately
  kept) for feature labels; `docs/MAP-LABELS.md` rewritten as-built.
- **PWA offline PMTiles precache**: in its own E31 phase-7 PR (service-worker
  slice), separate from the style/close-out PR.

---

## Amendment 1 — a satellite base layer for `/parking` (2026-08-03)

**Status:** accepted (owner decision, 2026-08-03).

This ADR's headline property was "no third-party requests, no API keys." That
stands for every map in the app **except one deliberate, named exception**,
recorded here so it stays an exception rather than becoming a precedent.

### What changed

`src/lib/map/basemap.ts` now also carries an **Esri World Imagery** raster
source (`SATELLITE_TILE_URL`), shipped `visibility: "none"`. `/parking` — and
only `/parking` — opens with it visible, with a Map/Satellite switch beside it.
Every other surface (`/map`, both ferry maps, the kiosk, the admin editors)
renders exactly as before and makes no off-origin request: MapLibre issues no
tile requests for a hidden layer, which is why one shared style can hold both.

### Why the exception was accepted

The questions `/parking` answers are questions about **paint on the ground** —
which row is the free one, where the lot edge really is, which stalls are
angled. The seed geometry itself is labelled `confidence: "probable"` and
georeferenced from a schematic, so the aerial is also how a Chamber admin
field-verifies a shape. A vector base cannot show any of that.

Public-domain alternatives were measured against the Port lot before accepting
a third party, and both were rejected on the facts:

| Source | Resolution over Kingston | Verdict |
| --- | --- | --- |
| USGS `USGSImageryOnly` | cache stops at ~1.6 m/px (`maxScale` 1:9028) | Too coarse — a parking lot is one grey smear. |
| Kitsap County HXIP 2020 | ~0.10 m/px, public tile cache | Best imagery available, but `Copyright Kitsap County, HxGN Content Program` — rehosting needs county/Hexagon permission. Worth pursuing separately. |
| Esri World Imagery | ~0.3 m — cars and stall stripes legible at z19 | **Accepted.** Keyless, free, no account. |

### The costs, accepted knowingly

- **Privacy.** A visitor's IP reaches Esri while imagery is showing. Nothing
  else does: PMTiles, glyphs and fonts all remain same-origin. This is a tile
  request, not analytics — the "no third-party analytics" commitment in the
  privacy policy is unaffected — but it is a new third party on one page.
- **CSP.** `services.arcgisonline.com` is carved out in **both** `img-src` and
  `connect-src` (`next.config.ts`); MapLibre fetches raster tiles and then
  paints them. The policy is still Report-Only pre-launch.
- **Offline.** Imagery **cannot** work offline — `public/sw.js` only intercepts
  same-origin requests, so no worker can cache these tiles. `<FeatureMap>`
  therefore falls back to the vector base when it is built with the network
  already gone, and disables the Satellite option, which is what keeps the
  E31 Phase 7 promise (a visitor who loses signal at the dock still has the
  parking map) intact. `tests/server/offline-map.test.ts` is the guard, and it
  caught this exact regression before the change shipped.
- **Terms.** The keyless `services.arcgisonline.com` endpoint is a legacy path;
  Esri's current terms nominally expect an ArcGIS account for production use.
  Attribution is rendered automatically (MapLibre credits a source only while a
  layer using it is visible). **If Esri ever gates or throttles it, the fallback
  is one constant:** point `SATELLITE_TILE_URL` at a self-hosted raster PMTiles
  archive built from public-domain NAIP and served through the existing
  `/api/map/tiles` proxy — the seam is already the right shape for it.

### Load-bearing details

- **`SATELLITE_MAX_ZOOM = 19`.** Esri serves a grey *"Map data not yet
  available"* placeholder at z20 over Kingston — a 200, not a 404. Declaring the
  source maxzoom makes MapLibre overzoom real z19 pixels instead of painting
  that placeholder, which is what a visitor pinching into a lot would otherwise
  hit constantly.
- **The base layer is applied on `styledata`, not `load`.** `load` waits for
  *every* source, so a 502 from the R2 tile proxy — which this app has had —
  would otherwise leave `/parking` blank even though the imagery was serving
  fine. The two are independent services and must fail independently.
- **Overlay contrast.** The ADR-0007 palette is unchanged. Over imagery the
  overlay gains white **casings** and its area fills get *weaker*, not stronger
  (`IMAGERY_FILL_OPACITY` in `feature-map.tsx`): on a photograph the content
  under the fill is the information, so identity moves to the boundary. A first
  cut that raised fill opacity turned the Port lot into a flat purple rectangle
  with the cars invisible.
