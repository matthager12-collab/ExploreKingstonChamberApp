# Map labels — as built

**Status: SHIPPED.** This doc used to be the Leaflet-era build plan (hybrid
always-on labels + admin overrides + a hand-rolled declutter). The plan was
built, and E31 then ported the whole subsystem to MapLibre GL — this is now the
reference for what actually runs, and for the division of labor between our
hand-rolled feature-label declutter and MapLibre's native symbol collision.
The original plan (designs considered, plugin survey, phased build order) lives
in git history if you need the reasoning trail.

---

## 1. Two label systems, deliberately different

| | Street names (basemap) | Feature/restaurant labels (chips) |
|---|---|---|
| What | Road names from the vector tiles | Names for pins the Chamber draws + restaurants |
| Rendered by | MapLibre **symbol layers** in `src/lib/map/basemap.ts` (three `road-*` layers) | **DOM chips** (`.fm-label` spans in 0-size MapLibre `Marker`s) built by `feature-map.tsx` |
| Collision | **MapLibre native** symbol collision (`text-padding` is the density dial; layer order decides who wins) | **Hand-rolled greedy declutter** (`declutter()` in `feature-map.tsx`) |
| Admin control | none (data comes from OSM via the tiles) | full per-feature overrides (`MapFeature.label`) |

Why the chips did NOT move to native symbol layers when E31 made that possible:
the admin override model (per-feature show/dir/±priority), the ranked greedy
policy ("a viewpoint beats a restroom"), and the styled pill chips sitting
above HTML pin markers are all straightforward as DOM + our own pass and would
be contortions as style-spec expressions. MapLibre's collision is
first-come-in-layer-order with no per-feature priority ranking across our mixed
DOM-marker/symbol world — the hand-rolled pass is still the right tool. Street
names, conversely, are exactly what native collision is for, and use it.

**Nothing from the label plan became dead code in the port** — the Leaflet
mechanics (label pane, `L.divIcon`, `latLngToContainerPoint`) were replaced 1:1
by MapLibre equivalents (0-size `Marker` elements, `map.project()`), and the
shared helpers carried over unchanged.

## 2. Requirements — all met

R1 visible names · R2 look-alike emoji disambiguated (restaurant name-as-label)
· R3 admin short-label override · R4 admin show/hide · R5 admin placement ·
R6 no overlaps, zoom-gated density · R7 mobile-first · R8 zero new deps
(hand-rolled; the 2026 plugin survey verdict — nothing on npm fit the
bundled/CSP rule — still stands, now doubly moot on MapLibre).

## 3. Where everything lives

- **`src/lib/map/types.ts`** — `MapLabel` (`text/show/dir/priority`),
  `CATEGORY_LABEL_RANK`, `labelPriority()` (one absolute 0..100 scale:
  category rank + admin nudge clamped ±50), `shortenTitle()`, and the single
  shared **`resolveLabel()`** consumed by the public map, the builder preview,
  and `resolve.ts` — so the three can never drift.
- **`src/lib/map/resolve.ts`** — threads `label: { text: r.name }` onto the
  restaurants builtin (that is what solves R2); custom features pass through
  whole.
- **`src/components/feature-map.tsx`** — chip build (`addLabel`), one batched
  `offsetWidth` measure (emoji/CJK/RTL-safe), `labelZoomThreshold()` (priority
  → min zoom), and the greedy pass: viewport-cull → zoom-gate → sort by
  priority (lat tie-break, so frames are deterministic) → place
  highest-first, `dir:"auto"` tries top/right/bottom/left, `show:"on"`
  bypasses the gate; display flips only (reads-then-writes, rAF-coalesced +
  120 ms debounced on move/zoom). Chip CSS (`.fm-label*`) is in this file's
  style block: 11 px/600 white on opaque `#16405e` (≥4.5:1 over any tile),
  `aria-hidden` (the popup carries the accessible name), text-node only
  (esc()/XSS notes at the build site).
- **`src/app/api/admin/map-features/route.ts`** — the `label` whitelist block
  (text ≤40, show/dir enums, priority clamped ±50, only non-defaults persist).
  Without it a saved override would be **silently dropped** — the strip trap;
  `MapFeature.cost` had the same trap and got its editor control in E31 P7
  (issue #80).
- **`src/app/(site)/admin/maps/editor.tsx`** — the "Map label" form group
  (short label with the derived value as placeholder, show/dir/priority), and
  the marker tooltip preview via the same `resolveLabel()`.

## 4. Still true / still out of scope

- Shapes (line/trail/area) default `show:"off"` — popups read fine on tap.
- Parking **zones** (`/admin/map`) have no labels by design; thread a `label`
  default in `resolve.ts`'s zone mapper if that ever changes.
- The kiosk map labels nothing — numbered pins + legend, by design (E22).
- A spatial-hash declutter is the drop-in upgrade if a view ever grows to
  hundreds of labels (~34 today; the pass is sub-ms).
