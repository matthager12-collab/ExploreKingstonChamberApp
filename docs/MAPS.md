# The map subsystem

_Explore Kingston — July 2026._ How maps work across the app: a general,
admin-editable **map CMS** (named views + drawn features + built-in data
layers), a **parking-specific zone editor**, and two **specialized ferry
maps** (plus the kiosk's deliberate non-slippy SVG map). One reusable component
renders any named view anywhere; the Chamber builds and edits everything in the
portal — no code, no redeploy. Every slippy map renders the **self-hosted
vector basemap** (E31, [ADR-0006](adr/ADR-0006-self-hosted-vector-basemap.md)):
Protomaps PMTiles on R2 behind `/api/map/tiles/kingston.pmtiles`, styled by
`src/lib/map/basemap.ts`, drawn by MapLibre GL.

Sibling docs: [ARCHITECTURE.md](ARCHITECTURE.md) (persistence seam, stores),
[SDD.md](SDD.md), [DATA_SOURCES.md](DATA_SOURCES.md) (parking/street rule
provenance), [OPERATIONS.md](OPERATIONS.md).

> **Verified-facts ethos.** Parking geometry seeded from the Port's schematic
> map is labeled `confidence: "probable"` and carries a source note until a
> Chamber admin field-checks it on the ground. Street rules trace to the 2015
> county study and are labeled as such. The map subsystem is built to keep that
> honesty visible in popups and card headers — don't strip it.

---

## Three map surfaces at a glance

| Surface | What it is | Model | Public page | Admin editor |
| --- | --- | --- | --- | --- |
| **Map CMS** | General named views with drawn markers/lines/trails/areas + built-in data layers | `MapView` + `MapFeature` (`src/lib/map/types.ts`) | `/map` (switcher), embedded on `/eat` and `/parking` | `/admin/maps` (`MapBuilder`) |
| **Parking zones** | Rich, structured parking dataset (rules, curb sides, overnight, confidence, source notes) | `MapZone` (`src/lib/data/parking.ts`) | `/parking` (via the CMS), pulled in as the `parking-zones` built-in layer | `/admin/map` (`MapZoneEditor`) |
| **Ferry maps** | Live vessel map + SR-104 boarding-pass map | hand-coded, no CMS | `/ferry` | none (code-defined) |
| **Kiosk map** | Numbered-pin SVG drawn from our own coordinates — deliberately NOT a slippy map (offline-safe, no external anchors; see the header of `src/components/kiosk-map.tsx`) | hand-coded (E22) | `/kiosk/map` | none |

The two systems interlock: the Map CMS can **include** parking zones and the
street overlay as read-only built-in layers, so parking data lives in exactly
one place (the `MapZone` store) and is never re-entered as generic features.

---

## Part 1 — the general map CMS

### Domain model (`src/lib/map/types.ts`)

Two entities, both seed+overlay (git seed in `src/lib/data`, admin edits overlay
it in the store — see [ARCHITECTURE.md](ARCHITECTURE.md) for the seam):

**`MapView`** — a named, reusable map configuration.

| Field | Notes |
| --- | --- |
| `id` | slug, e.g. `food-drink` |
| `name`, `description?` | shown in the `/map` switcher |
| `center: [lat,lng]`, `zoom` | initial framing (a fallback; the public map auto-frames to content — see below) |
| `sources: BuiltInSource[]` | which built-in data layers to render alongside custom features |
| `published: boolean` | `false` = admin-only draft, hidden from the public `/map` switcher and 404'd by the public API for non-admins |

**`MapFeature`** — a drawn thing that declares which views it appears on.

| Field | Notes |
| --- | --- |
| `id`, `kind: FeatureKind`, `title` | `FeatureKind = "marker" \| "line" \| "trail" \| "area"` |
| `views: string[]` | one or more `MapView` ids this feature shows on (a feature can live on several views) |
| geometry | exactly one, matching `kind`: `point` (marker), `path` (line/trail), `polygon` (area) |
| `category?` | marker icon category — a key into `MARKER_CATEGORIES` (21 icons: food, coffee, drink, shop, lodging, parking, restroom, the E27 basics water/bench/picnic/shade/bin, viewpoint, beach, trailhead, park, art, event, shipwreck, info, star). Beware: the "Landmark" pin's **key** is `shipwreck`, not `landmark`. Default icon is `info` |
| `color?` | hex stroke/fill for line/trail/area, or a marker tint override |
| `notes?`, `link?` | popup body + a "Directions / Open" link |
| `cost?: CostValue` | E27's free-vs-paid signal (`free` / `paid` / `free-and-paid` / `donation`, `src/lib/cost.ts`) — rendered as the `<CostBadge>` on finder rows (e.g. `/map/restrooms`). Editable in the builder since E31 P7 (issue #80) |
| `label?: MapLabel` | per-feature on-map name-label overrides (short text, show, placement, ±priority) — see [MAP-LABELS.md](MAP-LABELS.md) |
| `images?: string[]`, `imageUrl?` | stored image name(s); `imageUrl` is the legacy single-image field kept for back-compat, folded in by `featureImages()` |
| `parking?: ParkingMeta` | when set, the feature is a parking area: color becomes automatic by `parking.type` and structured payment fields render in the popup |

`ParkingMeta` (`type` is one of seven `ParkingType`s — paid / free /
free-timed / permit / park-and-ride / load-zone / no-parking, each with a fixed
palette color) plus optional `owner`, `phone`, `paymentMethod`, `paymentLink`,
`paymentNotes`, `timeLimit`. This lets a single marker or area on any view carry
lot-level detail without going through the dedicated `MapZone` system.

### Built-in data layers (`BuiltInSource`)

A view pulls existing app data in by listing sources — nothing is re-entered:

| Source | Data | Rendered by |
| --- | --- | --- |
| `restaurants` | live restaurant listings (hidden ones filtered out), each mapped to a marker category server-side by cuisine/tags so coffee → ☕ and bars → 🍺 rather than everything 🍽️ (`restaurantCategory()` in `resolve.ts`) | category-aware teardrop pins |
| `parking-zones` | the `MapZone` parking dataset (polygons + centers colored by rule) | filled polygons, or a circle marker when a zone has only a center |
| `streets` | the color-coded street-parking overlay | flagged, not inlined — the client fetches `/geo/street-parking.json` itself |

So the **Food & Drink** view is literally `sources: ["restaurants"]` and stays
in sync with the listings automatically.

### Seed vs overlay

- **Views** seed: `src/lib/data/map-views.ts` — four starters: `food-drink`
  (published, `restaurants`), `explore` (published), `trails` (published), and
  `parking-cash` (name "Parking", **`sources: []`, `published: false`** — a
  hand-built draft the Chamber fills in the builder).
- **Features** seed: `src/lib/data/map-features.ts` — a handful of starter
  landmarks (Mike Wallace Park, Point No Point, Village Green, a waterfront
  boardwalk trail) that show the shape of each kind.
- Admin edits overlay both via `writeOverlayRecord()`; `readMerged()` merges
  seed with overlay (custom wins by id; `{ _deleted: true }` tombstones a seed
  row). Store module: `src/lib/stores/map-store.ts`
  (`getMapViews/getMapView/saveMapView/deleteMapView`,
  `getMapFeatures/getFeaturesForView/saveMapFeature/deleteMapFeature`).

### Resolve → render

`resolveMapView(viewId)` (`src/lib/map/resolve.ts`, server-only) returns a
`ResolvedMapView`: the view config, its custom features, and lightweight
built-in payloads. The public route serves it:

```
seed (map-views.ts / map-features.ts) ─┐
admin overlay (store)                  ─┼─> map-store ─> resolve.ts ─> /api/map/[viewId] ─> <FeatureMap>
built-in layers (restaurants,          │
  parking-zones, streets)              ─┘
```

**`GET /api/map/[viewId]`** (`src/app/api/map/[viewId]/route.ts`) —
public read for `<FeatureMap>`. Returns 404 for unknown views; for a **draft**
(`published: false`) view it 404s unless the caller is an admin. Response is
edge-cached `s-maxage=60, stale-while-revalidate=300`.

### `<FeatureMap>` (`src/components/feature-map.tsx`)

The one reusable public map. Drop it on any page:

```tsx
import { FeatureMap } from "@/components/feature-map";

<FeatureMap view="food-drink" height="420px" />          // fetches /api/map/food-drink
<FeatureMap resolved={parkingMap} height="500px" />       // server-resolved payload, no fetch
```

Two modes:
- **`view="slug"`** — client component fetches `/api/map/<slug>` and renders.
- **`resolved={…}`** — a server component passes a pre-resolved payload and the
  map renders it directly (no fetch). This is how a **draft view is embedded on
  a public page**: `resolveMapView()` does *not* gate on `published`, whereas
  the public `/api/map` route 404s drafts for non-admins. `/parking` uses this
  to show the unpublished `parking-cash` view.

Rendering details worth knowing:
- **MapLibre GL on the self-hosted vector base** (E31, ADR-0006): the engine
  loads dynamically inside `useEffect` via `src/lib/map/maplibre.ts` (which
  registers the `pmtiles://` protocol once), deferred behind an
  IntersectionObserver until the map scrolls into view (perf budget). The base
  style comes from `mapStyle()` in `src/lib/map/basemap.ts` — see "The basemap"
  below. Markers are HTML `Marker` elements (teardrops); lines/areas are
  GeoJSON sources batched by render style. Because markers are DOM elements
  above the canvas, MapLibre's symbol-collision engine cannot see them —
  street labels declutter against each other, and markers simply draw over any
  label beneath them.
- **Colorway** ("Evergreen & Sound", [ADR-0007](adr/ADR-0007-map-colorway-and-overlay-palette.md)):
  the base is a LIGHT, desaturated family and the overlay a DARK, saturated one,
  so hue is free to carry meaning on both sides. `earth` and `building` are
  deliberately achromatic — they are the two largest surfaces, and keeping them
  neutral is what gives every overlay hue somewhere safe to sit. Two rules that
  are load-bearing, not cosmetic: **don't deepen the greens** (`forest #b3cbad`
  puts the worst text surface at 4.84:1, one step off failing AA), and **don't
  re-saturate the arterial** (`#e6dcc4` is the only warm sand that separates
  from the `park-and-ride-24h` badge). `basemap.test.ts` asserts no colours, so
  the ADR and review are the only guards here.
- **On-map name labels** (chips + hand-rolled declutter, with per-feature admin
  overrides) — the whole subsystem is documented in
  [MAP-LABELS.md](MAP-LABELS.md).
- **Auto-frame:** after drawing, the map fits bounds to the content it actually
  drew (overriding a stale center/zoom) — but only when the content spans ≤ 4 km
  and the view doesn't carry the wide `streets` overlay. A lone far pin (e.g.
  Point No Point ~13 km north) would otherwise zoom out and bury downtown, so
  those keep the configured center/zoom and let the visitor pan.
- **Mobile scroll-trap fix:** on coarse-pointer (touch) devices the map starts
  with dragging disabled so page swipes scroll past it; a "Tap to explore the
  map" button unlocks panning. `scrollWheelZoom` is off everywhere (pinch/± zoom
  still work).
- **Legend** is built from whatever actually rendered (deduped): marker
  categories, line/trail/area kinds, parking-type swatches, parking-zone rules,
  and street-overlay rules including the ferry-holding corridor.
- All popup text is HTML-escaped (`esc()`); parking payment links and feature
  links open in a new tab with `rel="noopener noreferrer"`.

### The `/map` public page

`src/app/(site)/map/page.tsx` lists only **published** views and hands them to
`MapSwitcher` (`src/app/(site)/map/switcher.tsx`), a thin client wrapper with pill
buttons that swap which view `<FeatureMap>` renders. Header copy is editable via
the content CMS (`copyText`); the page respects page-visibility (hidden-page
banner + admin preview). `revalidate = 60`. When no views are published the
switcher shows an editable "No maps are published yet." message.

`/eat` embeds `<FeatureMap view="food-drink" />` directly.

### The admin map builder — `/admin/maps`

`src/app/(site)/admin/maps/{page,editor.tsx}` — the CMS the owner asked for
(laptop-first; server component gates on `user.role === "admin"`, redirecting
non-admins to `/portal`). `MapBuilder` is a MapLibre GL + **terra-draw** canvas
(E32b, ADR-0006) with:

- **Views strip** — pills to pick the active view (the draw target + canvas
  filter), a "Show all" toggle, "New view", and a "Features (N)" dropdown.
  The view edit form (name, description, center/zoom with a "use current map
  center" button, built-in sources checkboxes, published toggle) opens as an
  overlay on the map's left edge.
- **Draw / edit** via the app's own Draw buttons (marker → terra-draw `point`
  mode, line/trail → `linestring`, area → `polygon`). Vertex drag, midpoint
  insert (click the faint ＋), and right-click vertex delete run in select
  mode; whole-shape drag works **simultaneously** with vertex editing (grab
  the shape body away from the handles), which is why the old Reshape ⟷ Move
  toggle and geoman's toolbar/eraser are gone. Areas may not self-intersect;
  lines/trails may while reshaping.
- **Feature form** (floating drawer on the right ≥lg, a block below the map
  <lg): kind (line↔trail switchable, sharing geometry), title, parking type
  (markers + areas), icon category (markers), color or auto parking-color, notes,
  link, multi-image upload, and view-assignment checkboxes.
- **Category-aware food pins** and **muted built-in context layers**: the active
  view's built-in sources (restaurants, parking zones, streets) render as dimmed,
  non-interactive context — canvas layers inserted *below* terra-draw's layers,
  context pins as `pointer-events: none` DOM markers — so the admin can draw
  *against* real data and clicks/draws pass straight through. Toggle with
  "Show built-ins".

**Geometry read-back on save** queries the terra-draw snapshot (shapes) or the
MapLibre marker (points) — never a render layer — and converts through
`src/lib/map/draw-coords.ts`: stored geometry stays `[lat,lng]`, open rings,
r6-rounded, byte-identical on a no-touch save. That module is
characterization-tested; a drift there corrupts what every public map renders.

### Terra-draw notes (both editors)

- Feature ids in the draw store ARE the app's feature/zone ids (a custom
  `idStrategy` in `src/lib/map/terradraw.ts` — terra-draw's default accepts
  only UUIDs).
- Selection is app-driven: `allowManualSelection/Deselection` are off, map
  clicks hit-test via `getFeaturesAtLngLat`, and the same `select()` function
  the sidebar uses runs — so the dirty-discard confirm stays authoritative.
- Programmatic store mutations are wrapped in a `withStoreOps()` suppression
  guard: terra-draw fires the same `change` events for API and user edits, and
  only user edits may mark the form dirty.
- The adapter is pinned to `coordinatePrecision: 6` (the r6 wire precision)
  with `ignoreMismatchedPointerEvents: true` (sidebar-press/map-release).
- StrictMode double-mount is guarded
  (`if (cancelled || !containerRef.current || mapRef.current) return`), and
  terra-draw is created inside `map.on("load", …)` — the adapter needs the
  style loaded.

### Admin API — features & views

Both under `/api/admin/`, both re-check `user.role === "admin"` (401 signed
out / 403 not admin) because API routes bypass the `/admin` layout gate.

**`/api/admin/map-features`** (`route.ts`):
- `GET [?view=id]` — all features, optionally filtered to one view.
- `POST` — create/update one feature. Validates: id slug (`[a-z0-9-]`, ≤64),
  kind, non-empty title, geometry matching the kind (marker→point,
  line/trail→path ≥2, area→polygon ≥3), and **every coordinate inside a
  greater-Kingston box** (lat 47.5–48.1, lng −123 to −122.2) so a fat-fingered
  drag can't fling a feature into the ocean. `views[]` must be non-empty and
  reference existing view ids. Color must be `#rrggbb`; link must be http(s);
  `images[]` capped at 8; parking built only when a valid `type` key is present.
- `DELETE ?id=X` — tombstone a feature (hides seed entries too).

**`/api/admin/map-views`** (`route.ts`):
- `GET` — all views (seed + overlay).
- `POST` — create/update. On create with no id the id is **slugified from the
  name** and de-collided (`-2`, `-3`, …) so two views never silently overwrite.
  `zoom` 10–19; `center` inside the Kingston box; `sources` a subset of the
  three built-ins (de-duped into canonical order); `published` from a strict
  `=== true`.
- `DELETE ?id=X` — tombstone a view (features keep the assignment but lose it on
  the public site).

### Feature images — the blob/file seam

Upload: **`POST /api/admin/map-features/image`** (admin, multipart `image`
field; ≤8 MB; JPEG/PNG/WebP/GIF). The bytes are sha1-hashed (dedupe-friendly,
stable name) and stored via `saveFeatureImage()`:

- **Prod (`hasBlob()`)** → Vercel Blob under `map/images/<sha1>.<ext>`;
  `putImage()` returns a full `https://…` CDN URL.
- **Local dev / disk** → written to `.data/map/images/<sha1>.<ext>`
  (gitignored); returns the bare name.

Either value is stored on the feature and wrapped by the client as
`/api/map/image?p=<value>`. **`GET /api/map/image`** (public — public maps
display these) **redirects** (302) a blob `https://…` value to the CDN, or
**streams** a bare filesystem name after strict path validation
(`featureImagePath()` rejects `/`, `\`, `..`, and non-hex/non-image names;
returns null for URLs). Filesystem responses are cached `max-age=86400`. This
is the same seam as hunt/player photos — see [ARCHITECTURE.md](ARCHITECTURE.md).

### Adding a new view or layer

- **New view** — draw it in `/admin/maps` (portal-editable, no code): "New
  view", set center/zoom/sources, draw features, assign them, publish. It shows
  up in the `/map` switcher immediately. Or add a seed entry to
  `src/lib/data/map-views.ts` for a shipped default.
- **Embed a view on a page** — `<FeatureMap view="slug" />` for a published
  view, or resolve it server-side and pass `resolved={…}` to embed a draft.
- **New built-in source** — a code change: extend `BuiltInSource` in
  `types.ts`, add a `ResolvedMapView.builtins` payload, wire it in
  `resolve.ts`, render it in `feature-map.tsx` (+ the builder's context layer),
  and add it to `SOURCES` in the two admin API routes and `SOURCE_OPTIONS` in
  the builder.

---

## Part 2 — the parking-specific zone editor

Parking has its own richer model and editor because a `MapZone` carries more
than a generic feature: **rule, overnight policy, confidence, and source
provenance**. The Map CMS *includes* these zones (as the `parking-zones`
built-in layer) but doesn't replace their editor.

### `MapZone` (`src/lib/data/parking.ts`)

Fields: `id`, `name`, `rule` (`ParkingRule`: free-2hr / free-unrestricted /
paid / park-and-ride-24h / prohibited / load-zone / permit), `summary`
(one-line, in popups + card headers), `details` (longer prose),
`confidence` (`verified` / `probable` / `unverified`), `overnight`
(`yes` / `no` / `confirm-first`), `center: [lat,lng]`, optional
`polygon: [lat,lng][]`, and optional `sourceUrl` / `sourceNote`.

**Curb model (E31 phase 6).** A street-parking zone can carry
`streetPaths: [lat,lng][][]` (one or more centre-line polylines, kept disjoint
exactly as OSM splits them) plus a compass `curb` side (`both` / `east` /
`west` / `north` / `south` — set ONLY where a source names the side). The
public map renders these as **curb-hugging offset strokes** via MapLibre
`line-offset`; `curbOffsetSigns()` in `src/lib/map/curb.ts` (pure,
characterization-tested) converts the compass side into the right offset
sign(s) for each polyline's direction. Unset curb = side unknown = one honest
centre-line stroke. The legacy `parkingAreas` flat list is **gone** (retired in
E31 phase 6; PR #78 had already established it was dead).

Store: `src/lib/stores/parking-store.ts` (`getParkingZones`,
`saveParkingZone`, `deleteParkingZone`) — seed+overlay under the
`parking-zones` store name.

### Parking map v2 lineage (the current parking view)

The seed dataset was **rewritten July 2, 2026** from primary sources (Port of
Kingston 2025 parking policy + the official 12-30-25 schematic map, WSDOT
terminal page, Kitsap Transit park-&-ride list, the 2015/2016 county Complete
Streets study; see [DATA_SOURCES.md](DATA_SOURCES.md)). What "v2" means concretely:

- **Port section polygons, not bubbles.** The Port lot is broken into
  georeferenced sections — the free 2-hour row, POKPARK north rows / main fan /
  89–103, POKHILL hill zone, POKTT truck-&-trailer band, the 15-minute dropoff,
  KCYC and marina-tenant permit rows, and the boat-launch apron — each a polygon
  snapped to Esri aerials (±5–15 m), rather than a single pin/bubble.
- Geometry is deliberately labeled **`confidence: "probable"`** with a
  `PORT_GEO_NOTE`/`PORT_SCHEMATIC_NOTE` caveat ("the painted stall markings on
  the ground always win") until an admin field-verifies it.
- **Ferry-holding corridor styling** is expressed in the *street overlay*
  (SR 104 → `ferry-holding` rule → a dashed gray corridor labeled "this is the
  line for the boat, not street parking"), so parking maps never confuse the
  queue with parking. Off-highway park & rides (George's Corner, Bayside) and
  the Diamond D515 commuter lot round out the set.
- Baked-in corrections are documented in the source-file header (free 2-hour row
  relocated ~70 m and recounted to ~30 stalls; Diamond 73 stalls; Pennsylvania
  Ave unrestricted one side only; Diamond permit $125.70 not the stale $100).

### `/admin/map` — `MapZoneEditor`

`src/app/(site)/admin/map/{page,editor.tsx}`. Admin-gated (via the `/admin` layout;
the `/api/admin/parking` routes re-check). A MapLibre GL + terra-draw canvas
(E32a, ADR-0006) where the admin:

- picks a zone from the sidebar list or the map → the map fits to it, its
  polygon grows drag-able **corner handles** (terra-draw select mode: drag a
  corner, click a midpoint to add one, right-click a corner to remove it, no
  self-intersection), and its center **pin becomes draggable** (a MapLibre
  HTML marker, outside the draw store);
- edits name / rule / summary / details / overnight / confidence;
- clicks **"✓ field-verified"** to flip confidence to `verified` (the whole
  point — replace probable schematic geometry with ground truth);
- draws a brand-new zone, or deletes one (seed zones are tombstoned in the
  overlay, not erased).

Save (`POST /api/admin/parking`) reads geometry back from the terra-draw
snapshot + pin and persists; `/parking` reflects it within a minute
(`revalidate = 60`). The terra-draw notes above apply. (The parking admin API lives at
`/api/admin/parking` — see [ARCHITECTURE.md](ARCHITECTURE.md); it is not part of
the `map-features`/`map-views` routes.)

### How `/parking` renders

`src/app/(site)/parking/page.tsx` calls `resolveMapView("parking-cash")` server-side
and passes it as `resolved={…}` to `<FeatureMap>` — so the **draft**
`parking-cash` CMS view drives the public parking map (the resolve path ignores
`published`). Whatever built-in sources the Chamber ticks on that view in
`/admin/maps` (typically `parking-zones` and `streets`) show up. Colors are
automatic by parking type; the page repeats the "sign on the pole wins" caveat
and the SR-104-line-is-not-parking warning (with the live boarding-pass note
from ferry-info).

### The street-parking overlay generator

The `streets` built-in layer draws `public/geo/street-parking.json`, generated
offline by **`scripts/gen-street-parking.py`** from:
- an Overpass export of Kingston-UGA highways, and
- the Census TIGERweb Kingston CDP boundary (GEOID 5335870).

The script classifies each way by name into a rule (prohibited / ferry-holding /
free-2hr / free-unrestricted / default) with a source note, applying
segment-level midpoint thresholds where a street's rule changes block-to-block
(NE 1st, Ohio, Iowa). Rule provenance is the 2015/2016 county Complete Streets
study + Port policy; unresearched streets get `default` ("no known restriction;
obey posted signs; RCW 46.55.085 24-hour rule"). It is **build-time tooling**,
not a runtime endpoint — regenerate and commit the JSON when rules change. The
client fetches the static file directly and orders segments so quiet
(`default`) streets draw under rule-bearing ones.

---

## Part 3 — the specialized ferry maps

Hand-coded MapLibre maps on `/ferry` (no CMS; same dynamic-import + lazy
IntersectionObserver pattern as the public feature-map). Both are hardened with
`map.resize()` + a `ResizeObserver` so a below-the-fold mount never paints
half-blank.

### Live vessel map — `FerryVesselMap` (`src/components/ferry-vessel-map.tsx`)

Our take on WSDOT's VesselWatch: both terminals, the dashed crossing line, and
the boats' real-time positions as heading-rotated ⛴️ markers. Seeded with a
server-rendered `initial` payload, then **polls `/api/ferry/vessels` every ~20 s,
paused while the tab is hidden**, keeping last-known positions on a transient
failure. When the WSDOT feed is absent it shows a "live positions need the WSDOT
feed" note and links out to WSDOT VesselWatch. See
[DATA_SOURCES.md](DATA_SOURCES.md) for the WSDOT dependency.

### SR-104 boarding-pass map — `Sr104TrafficMap` (`src/components/sr104-traffic-map.tsx`)

Our replica of WSDOT's "SR 104 Traffic Management System in Kingston" — the
ferry boarding-pass / holding-lane system. A coral holding-lane route
(terminal → Barber Cutoff, georeferenced from OSM SR-104 geometry) with three
numbered stops: **(1)** watch for the flashing sign at Barber Cutoff Rd,
**(2)** take a boarding pass at the Lindvog Rd dispenser, **(3)** wait for green
and pull to the tollbooths. A 📍 pin marks `FERRY_LINE_STAGING` — exactly where
the "Get in the ferry line" button routes drivers when a pass is required (join
from the west via Barber Cutoff; no mid-highway U-turn; only escalate to Miller
Bay Rd when the wait tops 2 hours). Operational details are adapted from WSDOT's
April 2026 announcement; the map is paired with the live boarding-pass note from
ferry-info. Static route/steps — no polling.

---

## The basemap (every slippy map)

`src/lib/map/basemap.ts` is the **single source of truth** for the base layer
(E31, [ADR-0006](adr/ADR-0006-self-hosted-vector-basemap.md)): PMTiles source
URL, attribution (OSM ODbL + Protomaps), and the hand-rolled MapLibre style.
Facts worth knowing:

- **Fully self-hosted.** Tiles stream from a private R2 bucket through the
  same-origin range proxy `/api/map/tiles/kingston.pmtiles`
  (`src/lib/map/tiles-store.ts`); street-name glyphs come from
  `public/fonts` (Noto Sans, OFL). No third-party requests, no API keys. The
  PMTiles build + refresh runbook is in
  [OPERATIONS.md](OPERATIONS.md) ("Basemap vector tiles").
- **No POI icons, structurally.** The style has no sprite, no `icon-image`,
  and no `pois` source-layer, so no church symbol (or any POI icon) can ever
  render — the guarantee is asserted by `src/lib/map/__tests__/basemap.test.ts`.
  The only symbol layers are street-name TEXT (three `road-*` layers using
  MapLibre's native label collision — see [MAP-LABELS.md](MAP-LABELS.md)).
  Street names render USPS-abbreviated via `streetTextField()` and the
  generated table `src/lib/map/street-abbrevs.json`; regenerate with
  `npm run tiles:abbrevs` whenever the tiles are rebuilt — the drift-guard
  test in `tests/unit/map/street-abbrev-drift.test.ts` fails until you do.
- **Brand palette (E31 phase 7).** Every style color is a named entry in the
  module's `PALETTE`, derived as *tints* of the Tailwind brand tokens in
  `src/app/globals.css` (shell/sand → paper + land, seaglass/tide → water,
  fern → greenery, coral → the highway accent, ink/ink-soft → street names).
  If a brand token changes, re-derive the palette there rather than editing
  layer colors ad hoc. Note:
  [ADR-0007](adr/ADR-0007-map-colorway-and-overlay-palette.md) ("Evergreen &
  Sound") records an owner decision that supersedes these specific tint
  *values* while keeping the `PALETTE` structure and the
  derive-from-brand-tokens doctrine — the recolor lands as a follow-up (see
  the Colorway bullet under `<FeatureMap>` for the load-bearing rules).
- **Dark map variant: deliberately deferred.** Investigated for the phase-7
  "brand palette + dark mode" charter line (2026-07-31): the app has **no dark
  theme anywhere** — no `prefers-color-scheme` handling, no theme toggle, no
  Tailwind `dark:` variants (the `dark` style objects in `side-switcher.tsx`
  et al. are tone presets for components sitting on navy fills), and static
  PWA/kiosk `themeColor`s. A dark basemap with light UI chrome around it would
  be a design incoherence, not a feature. **Ship a dark map style variant when
  (and only when) the app grows a dark theme** — the vector base makes it a
  second `PALETTE` in `basemap.ts`, which is exactly why the seam exists.
- **Offline tiles (PWA).** The E31 offline slice — precaching the PMTiles
  archive for the E13 PWA so the map renders without a network — is **in
  progress on a sibling branch (`e31-p7-offline-sw`); no PR exists yet**, and
  E31's offline acceptance criterion stays open until that slice lands with a
  real offline test. [PWA.md](PWA.md) is authoritative for offline behavior.

---

## Limitations & debt

- **`Atm` is an orphaned legacy type** in `src/lib/types.ts`. The cash/ATM map
  was removed — `src/lib/data/atms.ts` is deleted and no code reads the `Atm`
  type. Cash guidance now lives as a structured ferry-info `cash-tips` record
  ("no ATM at the dock; nearest cash machines up in downtown Kingston"), not on
  a map. (`ParkingArea` and the `parkingAreas` flat list are already gone —
  retired by the E31 phase-6 curb-model work.)
- **Two divergent parking color maps.** `feature-map.tsx` colors built-in
  parking *zones* by `ParkingRule` (`free-2hr`, `paid`, …); CMS parking
  *features* color by `ParkingType` (`free`, `paid`, …). They're kept visually
  in sync by hand across `feature-map.tsx`, `admin/maps/editor.tsx`, and
  `admin/map/editor.tsx` — a copy-paste dependency, not a shared constant.
- **Auto-frame hides distant features.** A view whose only content is > 4 km out
  (e.g. an `explore` view with just Point No Point) keeps its configured
  center/zoom and the visitor must pan to find the pin. Intentional, but a papercut.
- **Street overlay is a static committed file.** Rules are only as fresh as the
  last manual `gen-street-parking.py` run and the 2015 county survey underneath
  it; there's no live source. Every street rule is labeled "obey posted signs".
