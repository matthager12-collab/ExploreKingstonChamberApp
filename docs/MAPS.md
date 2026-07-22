# The map subsystem

_Explore Kingston — July 2026._ How maps work across the app: a general,
admin-editable **map CMS** (named views + drawn features + built-in data
layers), a **parking-specific zone editor**, and three **specialized ferry
maps**. One reusable component renders any named view anywhere; the Chamber
builds and edits everything in the portal — no code, no redeploy.

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
| **Parking zones** | Rich, structured parking dataset (rules, overnight, confidence, source notes) | `MapZone` (`src/lib/data/parking.ts`) | `/parking` (via the CMS), pulled in as the `parking-zones` built-in layer | `/admin/map` (`MapZoneEditor`) |
| **Ferry maps** | Live vessel map + SR-104 boarding-pass map | hand-coded, no CMS | `/ferry` | none (code-defined) |

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
| `category?` | marker icon category — a key into `MARKER_CATEGORIES` (16 icons: food, coffee, drink, shop, lodging, parking, restroom, viewpoint, beach, trailhead, park, art, event, landmark, info, star). Default icon is `info` |
| `color?` | hex stroke/fill for line/trail/area, or a marker tint override |
| `notes?`, `link?` | popup body + a "Directions / Open" link |
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
- Leaflet touches `window` at module scope, so it's imported **dynamically
  inside `useEffect`**; the component renders an empty shell on the server and
  hydrates on the client. Leaflet's default marker icons are deliberately
  avoided (their asset paths break under bundlers) — markers use `L.divIcon`
  teardrops; everything else is `polyline`/`polygon`/`circleMarker`.
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
non-admins to `/portal`). `MapBuilder` is a Leaflet + leaflet-geoman canvas with:

- **Views strip** — pills to pick the active view (the draw target + canvas
  filter), a "Show all" toggle, "New view", and a "Features (N)" dropdown.
  The view edit form (name, description, center/zoom with a "use current map
  center" button, built-in sources checkboxes, published toggle) opens as an
  overlay on the map's left edge.
- **Draw / edit / erase** via geoman's toolbar: draw markers, polylines
  (→ line or trail), polygons (→ area); the **eraser** (removalMode) deletes a
  feature by clicking it; vertex editing and whole-shape drag. Circle,
  rectangle, circle-marker, text, cut, and rotate are disabled.
- **Reshape ⟷ Move toggle** — geoman can't run vertex editing and whole-layer
  drag on the same shape at once (`enableLayerDrag()` disables edit mode), so a
  selected line/area gets an explicit toggle. Markers are simply draggable while
  selected.
- **Feature form** (floating drawer on the right ≥lg, a block below the map
  <lg): kind (line↔trail switchable, sharing geometry), title, parking type
  (markers + areas), icon category (markers), color or auto parking-color, notes,
  link, multi-image upload, and view-assignment checkboxes.
- **Category-aware food pins** and **muted built-in context layers**: the active
  view's built-in sources (restaurants, parking zones, streets) render as dimmed,
  non-interactive context on a dedicated Leaflet pane (z-index 350, below the
  overlay pane at 400, `pointer-events: none`) so the admin can draw *against*
  real data and clicks/draws pass straight through. Toggle with "Show built-ins".
- **Mobile tap-to-activate** and auto-frame behavior mirror the public map.

**Geometry read-back on save** queries the live Leaflet layer directly
(`marker.getLatLng()`, `polyline/polygon.getLatLngs()` walked to a flat ring),
so any geoman vertex drag or whole-shape move is captured at Save time. Points
are rounded to 6 decimals.

### The leaflet-geoman ordering gotcha

Geoman's browser bundle registers itself onto the **global `L`**, so the import
order inside the map-bootstrap effect is load-bearing and identical in both
editors:

```ts
const L = (await import("leaflet")).default;
(window as unknown as { L?: typeof L }).L = L;   // MUST set global L first
await import("@geoman-io/leaflet-geoman-free");  // reads window.L on import
// …then create the map (map.pm.* is now available)
```

Import geoman before assigning `window.L` and `map.pm` is undefined. Geoman's
CSS is a plain top-of-file stylesheet import — safe because these files are
client-only and Next extracts CSS at build time. StrictMode double-mount is
guarded (`if (cancelled || !containerRef.current || mapRef.current) return`).

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
the `/api/admin/parking` routes re-check). A Leaflet + geoman canvas where the
admin:

- picks a zone from the sidebar list or the map → the map fits to it, its
  polygon grows drag-able **corner handles** (geoman edit mode, no
  self-intersection), and its center **pin becomes draggable** (the pin is
  plain-leaflet draggable, `pmIgnore: true`, not geoman-managed);
- edits name / rule / summary / details / overnight / confidence;
- clicks **"✓ field-verified"** to flip confidence to `verified` (the whole
  point — replace probable schematic geometry with ground truth);
- draws a brand-new zone, or deletes one (seed zones are tombstoned in the
  overlay, not erased).

Save (`POST /api/admin/parking`) reads geometry back from the live layers and
persists; `/parking` reflects it within a minute (`revalidate = 60`). Same
leaflet-geoman ordering gotcha applies. (The parking admin API lives at
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

Hand-coded Leaflet maps on `/ferry` (no CMS; same dynamic-import pattern, no
geoman). Both are hardened with `invalidateSize()` + a `ResizeObserver` so a
below-the-fold mount never paints half-blank.

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

## Limitations & debt

- **`ParkingArea` / `Atm` are orphaned legacy types** in `src/lib/types.ts`. The
  cash/ATM map was removed — `src/lib/data/atms.ts` is deleted and no code reads
  the `Atm` type. Cash guidance now lives as a structured ferry-info `cash-tips`
  record ("no ATM at the dock; nearest cash machines up in downtown Kingston"),
  not on a map. `parking.ts` still exports a legacy `parkingAreas: ParkingArea[]`
  flat list at the bottom of the file; **only `parkingZones: MapZone[]` is used**
  by the live app (via `parking-store`). Both legacy shapes are candidates for
  deletion.
- **Stale code comments reference `components/town-map.tsx`, which no longer
  exists** — `feature-map.tsx`, and both admin editors, cite it as the
  dynamic-import / color-convention precedent. The precedent is real (the pattern
  is shared) but the file was renamed/absorbed into `feature-map.tsx`; the
  comments should be updated.
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
