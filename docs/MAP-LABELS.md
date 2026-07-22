# Map Labels — Implementation Plan

**Audience:** Mat (solo dev). **Status:** build-ready. **Effort:** ~1 focused day (phased; each phase independently shippable).

This plan adds readable, always-on **name labels** to the public map, with per-feature admin overrides, and a hand-rolled declutter pass so the dense downtown/ferry cluster never turns into a wall of text. Zero new dependencies; nothing leaves the origin (CSP-safe by construction).

All file paths below are absolute-from-repo-root under `visit-kingston/`.

---

## 1. Goal & requirements

The confirmed direction is **hybrid labeling**: smart always-on defaults *plus* per-feature admin overrides.

| ID | Requirement |
|----|-------------|
| **R1** | **Visible names.** Labelable pins show their name on the map (not only in the popup on tap), with zero admin setup for a sensible result. |
| **R2** | **Disambiguate look-alike emoji.** Many restaurants share the 🍽️/☕/🍺 pin — each must show its own name so they're distinguishable at a glance. |
| **R3** | **Admin override — short label.** Per feature: a short on-map label distinct from the long popup `title`. |
| **R4** | **Admin override — show/hide.** Per feature: force the label always-on or off, overriding the auto behavior. |
| **R5** | **Admin override — placement.** Per feature: label direction (top/right/bottom/left/auto). |
| **R6** | **Clutter handling.** Labels never overlap; density thins out as you zoom out and blooms in as you zoom toward the ferry. The dense downtown cluster stays readable. |
| **R7** | **Mobile-first.** Phones are the primary device: legible at 11px over OSM tiles, smooth pan/zoom, no tap-stealing. |
| **R8** | **$0 / no external deps.** No npm install, no CDN, no new runtime network calls. Hand-rolled, matching the repo's existing ethos (hand-rolled SVG trendline, hand-rolled street z-ordering). |

Non-goals are in §9.

---

## 2. Approach in one paragraph

Render each labelable thing's name as a **separate non-interactive `L.marker` label chip** (a `divIcon` pill) placed on a **dedicated custom Leaflet pane at z-index 620** — above `markerPane` (600), below `popupPane` (700) — so labels never intercept taps and open popups always cover them. A hand-rolled **greedy priority declutter pass** runs on `zoomend`/`moveend` (rAF-coalesced + debounced): it projects each on-screen candidate to container pixels, applies a **priority-scaled zoom gate**, sorts by priority, and greedily places highest-priority-first, hiding any chip whose AABB overlaps an already-placed one. Chips are toggled purely via `el.style.display` — never added/removed — so the pass is allocation-free and pan stays smooth on phones. Smart defaults come free from a **category rank table** + **title shortening** + **restaurant-name-as-label** (which is exactly what solves R2). This beat the **runner-up** — native permanent `L.tooltip` labels (Designs 2 & 3) — because permanent tooltips are churnier to batch-toggle (need `open/closeTooltip` or class churn), drag in Leaflet's tooltip arrow/anchor quirks and awkward center-anchoring on long polylines, and sit on `tooltipPane` (650) which we'd fight; our own pane + plain `display` flip is the smoothest possible mobile story and reuses primitives already in the file (`L.divIcon`, `map.createPane` — the editor already uses `createPane` at `editor.tsx:744`). We adopt three grafts from the runner-ups (see boxes below): a **single shared `resolveLabel()`** helper so the public map, admin preview, and restaurants can never drift; the **one nested `label` object** (not loose fields) so it validates/strips as a unit like the existing `parking` block; and the **placeholder-shows-derived-value** admin ergonomic.

> **Dependency survey (documented for the PR — from Design 2's research, so future reviewers don't re-litigate "why not a plugin"):** `Leaflet.LabelTextCollision` and `leaflet-mapwithlabels` are **GitHub-only, not on npm** → fail the bundled-npm/CSP rule. `labelgun` (npm) is 2017-era, a generic AABB engine only (you still hand-roll all Leaflet glue) and pulls `rbush` — more code than a 40-line sweep for ≤60 labels. `Leaflet.LayerGroup.Collision-tooltip` (npm, 2017) hides whole *markers*, not labels — wrong behavior. `leaflet.markercluster` clusters pins into count-bubbles — it *hides* individual pins, directly conflicting with R2. **Verdict: hand-roll.**

---

## 3. Data model

### 3a. `MapFeature.label` — one optional nested object

In `src/lib/map/types.ts`, extend `MapFeature` (around line 51). Nested keeps back-compat, adds no field bloat to the 3 kinds that rarely label, and validates/strips as a unit (mirroring the existing `parking` precedent).

```ts
export type LabelShow = "auto" | "on" | "off";
export type LabelDir = "auto" | "top" | "right" | "bottom" | "left";

export interface MapLabel {
  /** Short on-map label; when unset, derived from title. */
  text?: string;
  /** auto = declutter decides by zoom+priority; on = always; off = never. */
  show?: LabelShow;
  /** Placement relative to the pin. auto tries [top,right,bottom,left]. */
  dir?: LabelDir;
  /** −50..+50 admin nudge, merged with category rank. Default 0. */
  priority?: number;
}

export interface MapFeature {
  // …existing fields…
  label?: MapLabel; // ← NEW, optional; absent = all smart defaults
}
```

### 3b. Restaurants builtin gets a matching `label`

Restaurants have no `MapFeature`, so add an optional `label` to the resolved payload type — same file, inside `ResolvedMapView.builtins.restaurants[]` (line 126):

```ts
restaurants?: {
  id: string; name: string; lat: number; lng: number;
  walkMinutesFromFerry: number; category: string;
  label?: { text?: string; priority?: number }; // ← NEW
}[];
```

### 3c. Category rank table + shared helpers (the graft: one `resolveLabel`)

Add next to `MARKER_CATEGORIES` in `types.ts`. **Every key is verified against the real `MARKER_CATEGORIES` list** so nothing silently falls to the default tier — note the repo's "Landmark" pin is category key **`shipwreck`** (📍), *not* `landmark`:

```ts
/** Category → base label rank (0..100). Higher = shows earlier + wins collisions. */
export const CATEGORY_LABEL_RANK: Record<string, number> = {
  star: 85, viewpoint: 82, beach: 80, trailhead: 78, park: 76,
  shipwreck: 72, // ← the "Landmark" 📍 pin. NOT "landmark".
  lodging: 60, event: 58, art: 55, info: 50,
  food: 50, coffee: 50, drink: 50, shop: 48,
  parking: 30, restroom: 25,
};
const DEFAULT_RANK = 45; // uncategorized markers / restaurants without a mapped cat

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Effective priority on a single ABSOLUTE 0..100 scale (rank + admin nudge). */
export function labelPriority(catKey: string | undefined, nudge = 0): number {
  const rank = CATEGORY_LABEL_RANK[catKey ?? ""] ?? DEFAULT_RANK;
  return clamp(rank + nudge, 0, 100);
}

/** Shorten a long title into a chip label (see §3d for rules). */
export function shortenTitle(title: string): string { /* §3d */ }

/**
 * Single source of truth for a label, consumed by feature-map.tsx (public),
 * editor.tsx (admin preview), and resolve.ts (restaurants) — so the three
 * NEVER drift. `kind` lets shapes default to a lower rank than markers.
 */
export function resolveLabel(input: {
  title: string;
  category?: string;
  kind?: FeatureKind;
  label?: MapLabel;
}): { text: string; show: LabelShow; dir: LabelDir; priority: number } {
  const l = input.label ?? {};
  const isShape = input.kind === "line" || input.kind === "trail" || input.kind === "area";
  return {
    text: l.text?.trim() || shortenTitle(input.title),
    show: l.show ?? (isShape ? "off" : "auto"), // shapes read fine on tap; off by default (graft)
    dir: l.dir ?? "auto",
    priority: labelPriority(input.category, l.priority ?? 0) - (isShape ? 15 : 0),
  };
}
```

> **Priority scale — reconciled (stress-test must-fix).** There is **exactly one** scale: an **absolute 0..100 effective priority** = `clamp(CATEGORY_LABEL_RANK[cat] + adminNudge(−50..+50), 0, 100)`. The zoom gate consumes *that* (§5). We deliberately do **NOT** use the graft's `minZoom = 17 − priority` formula — a ±50 nudge fed into `17 − priority` yields nonsense zooms (−33…67). One ramp, one scale.

### 3d. Smart defaults (`shortenTitle`)

Zero admin input still yields a readable map:

- **`shortenTitle(title)`:** strip a trailing parenthetical `(…)`, drop a leading `"The "`, cut at the first `— – , :` clause boundary, then cap to ~18 chars on a word boundary with an ellipsis. Full title still lives in the popup. e.g. `"Mike Wallace Park & Marina"` → `"Mike Wallace Park"`, `"Point No Point Lighthouse"` → `"Point No Point…"`.
- **Restaurants:** get their `name` as the label automatically (threaded in `resolve.ts`, §3e). **This is what solves R2** — 8 restaurants sharing 🍽️ each now carry their own name chip.
- **Priority:** derived from `CATEGORY_LABEL_RANK[category]`, so a viewpoint/star outranks a restroom with zero setup; restaurants default to mid (`food/coffee/drink` ≈ 50).
- **show=`auto`, dir=`auto`** by default. Shapes default **`off`** (graft — their popups read well and long-polyline labels anchor awkwardly).

### 3e. Thread through `resolve.ts`

`resolve.ts` returns custom `features` whole, so `MapFeature.label` **passes through untouched** — no change needed for custom features. But the restaurant mapper **strips unlisted fields**, so add the label default in the existing `builtins.restaurants = restaurants.map(...)` block (line 32):

```ts
builtins.restaurants = restaurants.map((r) => ({
  id: r.id, name: r.name, lat: r.lat, lng: r.lng,
  walkMinutesFromFerry: r.walkMinutesFromFerry,
  category: restaurantCategory(r),
  label: { text: r.name },           // ← NEW: name-as-label survives stripping (R2)
}));
```

Seed data in `src/lib/data/map-features.ts` needs **no migration** — every new field is optional. The overlay store (`map-store.ts` → `saveMapFeature` → `writeOverlayRecord`) persists the whole `MapFeature` object field-agnostically, so stored overlays round-trip `label` **only if the API route lets it through** (§6 — this is a hard must-fix).

---

## 4. Rendering

All changes in `src/components/feature-map.tsx`. **Existing pins/popups/lines/areas are untouched** — labels are pure additive progressive enhancement. If the declutter effect throws or is skipped, the map behaves exactly as today.

### 4a. Create the label pane once (right after `L.map(...)`, ~line 324)

```ts
const lp = map.createPane("feature-labels");
lp.style.zIndex = "620";          // markerPane 600 < 620 < popupPane 700
lp.style.pointerEvents = "none";  // labels never steal taps
```

### 4b. Build a label chip per labelable thing

In the **existing** feature loop (line 363, only `kind:"marker"` with a `point`) and the **existing** restaurants loop (line 420), right after the pin `L.marker(...).addTo(map).bindPopup(...)`, also build a label marker. **Guard placement:** all of this lives inside the current post-`await import("leaflet")` block, *after* the existing `if (cancelled || !containerRef.current || mapRef.current) return;` at line 317 — so StrictMode's second dev pass short-circuits exactly like the map itself (§5, must-fix).

```ts
// once, before the loops:
const labelsRef: LabelRec[] = []; // plain array, effect-local (see §5 for the ref)
type LabelRec = {
  el: HTMLElement | null; latlng: [number, number];
  text: string; show: LabelShow; dir: LabelDir; priority: number;
  w: number; h: number; // measured box; see §5 batched-measure
};

function addLabel(latlng: [number, number], lab: ReturnType<typeof resolveLabel>) {
  if (lab.show === "off") return;
  const icon = L.divIcon({
    className: "fm-label-wrap",
    html: `<span class="fm-label" dir="auto" aria-hidden="true">${esc(lab.text)}</span>`,
    iconSize: [0, 0],
    iconAnchor: LABEL_ANCHOR[lab.dir === "auto" ? "top" : lab.dir], // §4d
  });
  const m = L.marker(latlng, {
    icon, interactive: false, keyboard: false,
    pane: "feature-labels", zIndexOffset: Math.round(lab.priority),
  }).addTo(map);
  labelsRef.push({ el: m.getElement(), latlng, ...lab, w: 0, h: 18 });
}
```

Call sites (compute via the **shared** `resolveLabel`, the graft that prevents drift):
- Custom markers (line ~375): `addLabel(f.point, resolveLabel({ title: f.title, category: f.category, kind: f.kind, label: f.label }));`
- Restaurants (line ~430): `addLabel([r.lat, r.lng], resolveLabel({ title: r.label?.text ?? r.name, category: r.category }));`

### 4c. XSS / escaping

Label text goes in as a **text node** inside `<span>…</span>`, escaped with the existing `esc()` (line 117). ⚠️ **`esc()` escapes `& < > "` but NOT single-quote `'`** — safe here because text is never in an attribute. **Add a code comment** at the chip HTML: *"esc() does not neutralize `'`; keep label text a text node, never move it into an attribute."* If ever needed in an attribute, add `.replace(/'/g, "&#39;")` (one line) or a separate `escAttr()`.

### 4d. Styling & anchors (in the `PIN_CSS` block, line 607)

```css
.fm-label-wrap { background: transparent; border: none; }
.fm-label {
  display: inline-block;
  font: 600 11px/1.15 system-ui, sans-serif;
  color: #fff;
  background: #16405e;               /* OPAQUE — see a11y/contrast must-fix */
  border-radius: 2px;
  padding: 1px 6px;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0,0,0,.55);  /* halo over busy tiles */
  box-shadow: 0 0 0 1px rgba(255,255,255,.5); /* hairline lifts it off any tile */
}
```

`LABEL_ANCHOR` maps `dir` → `iconAnchor` matching the 30px teardrop offset, e.g. `top: [0, 34]` (chip sits above the pin tip), `right: [-18, 8]`, `bottom: [0, -6]`, `left: [18, 8]`. (Leaflet `iconAnchor` is subtracted from position, so a positive-y anchor shifts the chip *up*.) **Default first-choice = `top`** so the chip sits directly over its own pin and stays visually bound to it, not drifting toward a neighbor (stress-test: mobile "I tapped the name, nothing happened" — mitigated because the chip sits inside the 30px pin tap zone).

> **Why chips, not permanent `bindTooltip`:** a plain non-interactive marker on our own pane gives direct `getElement()` DOM control for an **O(n) `display` toggle** with zero add/remove churn. Permanent tooltips can't be batch show/hidden cheaply and drag in the `::before` arrow + auto-pane (650) quirks. This is the mechanical edge that won Design 1.

---

## 5. Collision & zoom behavior

Hand-rolled `declutter()` in `feature-map.tsx`. Bound to `map.on("zoomend moveend", scheduleDeclutter)` and run once after the initial `fitBounds`/render.

### 5a. Zoom gate (priority → min zoom) — the clutter dial

```ts
// Single absolute 0..100 priority → min zoom. Tuned so the food-drink view's
// post-fitBounds zoom (maxZoom 16 per feature-map.tsx:487) already shows a
// readable subset — NOT an empty opening frame (stress-test must-fix).
function zoomThreshold(priority: number): number {
  if (priority >= 80) return 13;  // stars/viewpoints survive town-wide
  if (priority >= 45) return 15;  // restaurants/mid appear near the downtown fit zoom
  return 16;                      // restroom/parking only when fully zoomed in
}
```

Because the food-drink view auto-fits to **z16** (`maxZoom:16`, line 487) for the tight ferry cluster, mid-tier restaurants (rank ~50 → threshold 15) **are already eligible at the opening frame** — the greedy pass then shows as many names as fit without overlap. This is the fix for the "opens showing zero restaurant names" failure.

### 5b. The pass

```ts
const rafRef = useRef<number | null>(null);
const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

function scheduleDeclutter() {           // debounce moveend bursts, then rAF-coalesce
  if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
  moveTimerRef.current = setTimeout(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = null; declutter(); });
  }, 120);
}

function declutter() {
  const map = mapRef.current;
  if (!map) return;                       // no-op on torn-down map (must-fix)
  const z = map.getZoom();
  const bounds = map.getBounds().pad(0.15);

  // Pass 1 — READS only (no interleaved writes → no layout thrash):
  const cands: (LabelRec & { x0:number;y0:number;x1:number;y1:number })[] = [];
  const hide: LabelRec[] = [];
  for (const r of labelsRef.current) {
    if (!r.el) continue;
    if (r.show === "off") { hide.push(r); continue; }
    if (!bounds.contains(r.latlng)) { hide.push(r); continue; }         // viewport cull
    if (r.show !== "on" && z < zoomThreshold(r.priority)) { hide.push(r); continue; } // zoom gate
    const p = map.latLngToContainerPoint(r.latlng);
    const [dx, dy] = boxOffset(r.dir === "auto" ? "top" : r.dir, r.w, r.h);
    cands.push({ ...r, x0: p.x+dx, y0: p.y+dy, x1: p.x+dx+r.w, y1: p.y+dy+r.h });
  }

  // Sort: priority desc, tie-break by lat (deterministic → no frame-to-frame flicker).
  cands.sort((a, b) => b.priority - a.priority || a.latlng[0] - b.latlng[0]);

  // Greedy placement with a 2px gutter. `on` bypasses the gate but still occupies space.
  const placed: {x0:number;y0:number;x1:number;y1:number}[] = [];
  const show: LabelRec[] = [];
  for (const c of cands) {
    const clash = placed.some(p =>
      !(c.x1+2 < p.x0 || c.x0-2 > p.x1 || c.y1+2 < p.y0 || c.y0-2 > p.y1));
    if (c.show === "on" || !clash) { placed.push(c); show.push(c); } else { hide.push(c); }
  }

  // Pass 2 — WRITES only (all display flips after all reads):
  for (const r of hide) if (r.el) r.el.style.display = "none";
  for (const r of show) if (r.el) r.el.style.display = "";
}
```

**`dir:"auto"` resolution:** try `[top, right, bottom, left]`; place at the first direction whose box doesn't collide with an already-placed box, else hide. (Implement by computing four candidate boxes for `auto` chips and short-circuiting on the first that fits.)

### 5c. Batched measurement (stress-test must-fix — emoji/CJK/RTL)

The arithmetic estimate `w ≈ 8 + text.length*6.2` is **wrong** for emoji (≈2× a Latin char), CJK (wider), and RTL — exactly this app's content (`Café`, `🍽️` in popups, potential non-Latin names). **Measure `offsetWidth` for ALL chips in ONE batched read pass immediately after the feature loop**, before the first `declutter()` — one forced reflow for ~34 elements is sub-ms and eliminates the per-reveal overlap frame entirely. Store `r.w = el.offsetWidth; r.h = el.offsetHeight`. Keep the arithmetic only as a pre-DOM fallback. The `dir="auto"` attribute on the span (§4b) makes mixed/RTL/CJK render in correct visual order, and measuring the *actual* rendered box resolves their width too. **Never interleave `offsetWidth` reads with `display` writes** inside `declutter()` (already structured as reads-then-writes above).

### 5d. Hydration safety & teardown (stress-test must-fix — StrictMode)

App Router has `reactStrictMode = true` by default in this Next.js, so the build effect runs → cleans up → runs again in dev. Design out the leak:

1. **Build labels only after** the existing `if (cancelled || !containerRef.current || mapRef.current) return;` (line 317), inside the same async IIFE — the second pass short-circuits on `mapRef.current`.
2. Use a **ref** for the labels array: `const labelsRef = useRef<LabelRec[]>([])`. Populate it inside the guarded block.
3. In the effect **cleanup** (lines 560–565): `cancelAnimationFrame(rafRef.current!); clearTimeout(moveTimerRef.current!); labelsRef.current = [];` **before** `mapRef.current = null`. (`map.remove()` drops the `zoomend/moveend` handlers automatically — it's the rAF/timer that would leak and call `latLngToContainerPoint` on a torn-down map.)
4. `declutter()` **no-ops on entry if `!mapRef.current`** (already shown above).

### 5e. Perf

At the real data scale — **17 restaurants** + a handful of custom markers → ~34 labels on the busiest (food-drink) view — the viewport-culled O(n²) greedy pass is a few thousand integer compares, **sub-millisecond on a phone**. The rAF coalescing + 120ms `moveend` debounce collapse flick/settle bursts to one pass so the inertia-settle frame doesn't hitch. If a future view grows to hundreds of labels, a grid-bucket spatial hash is a drop-in upgrade — not needed today.

---

## 6. Admin controls

### 6a. API route — validate `label` (HARD MUST-FIX — silent data loss otherwise)

`src/app/api/admin/map-features/route.ts` whitelists every field field-by-field; an **unvalidated `label` is dropped on save with a 200 OK** — the admin sees their override vanish and thinks it's broken. Add a `label` block mirroring the existing `parking` block (lines 176–201), before assembling `feature` (line 203):

```ts
const SHOW = new Set(["auto", "on", "off"]);
const DIR = new Set(["auto", "top", "right", "bottom", "left"]);
let label: MapLabel | undefined;
if (body.label && typeof body.label === "object" && !Array.isArray(body.label)) {
  const m = body.label as Record<string, unknown>;
  const text = typeof m.text === "string" && m.text.trim() ? m.text.trim().slice(0, 40) : undefined;
  const show = typeof m.show === "string" && SHOW.has(m.show) ? (m.show as LabelShow) : undefined;
  const dir  = typeof m.dir  === "string" && DIR.has(m.dir)   ? (m.dir  as LabelDir)  : undefined;
  const priority = typeof m.priority === "number" && Number.isFinite(m.priority)
    ? clamp(Math.round(m.priority), -50, 50) : undefined;   // matches the ±50 admin scale
  // Persist only when something non-default is set (keeps payloads lean).
  if (text || (show && show !== "auto") || (dir && dir !== "auto") || (priority != null && priority !== 0)) {
    label = { ...(text ? { text } : {}), ...(show ? { show } : {}),
              ...(dir ? { dir } : {}), ...(priority != null ? { priority } : {}) };
  }
}
// …then in the feature object (line ~203): ...(label ? { label } : {}),
```

Import `MapLabel, LabelShow, LabelDir` from `@/lib/map/types`. **Add a round-trip test** (§8) so a saved label survives POST→GET.

### 6b. Editor — Draft, toDraft, buildFeature

In `src/app/(site)/admin/maps/editor.tsx`:

- **`Draft` type** (line 138): add `labelText: string; labelShow: LabelShow; labelDir: LabelDir; labelPriority: string;` (priority as string for the `<input>`).
- **`toDraft(f)`** (line 157): `labelText: f.label?.text ?? "", labelShow: f.label?.show ?? "auto", labelDir: f.label?.dir ?? "auto", labelPriority: f.label?.priority != null ? String(f.label.priority) : "",`
- **`buildFeature()`** (line 953): assemble `label` only when a sub-field is non-default, via the existing conditional-spread style, and add `...(label ? { label } : {})` to the returned `feature`. Mirror the route's clamp/validation so client and server agree.

### 6c. Editor — the "Label" form group

Add a new `<Field>` group in `featureFormBody`, shown when `draft.kind === "marker"`, **right after the Icon category field (line 1438)**:

- **Short label** text input → `labelText`, with **`placeholder={shortenTitle(draft.title)}`** so the admin literally sees the auto value and only types to override (graft from Design 3). Helper: *"Blank = auto from title."*
- **Show** — 3-way segmented pill control (`Auto` / `Always` / `Hidden` → `auto`/`on`/`off`), reusing the exact Reshape/Move pill pattern at lines 1343–1364 (`rounded-full border px-3 py-1.5 text-xs font-semibold`, active = `border-tide bg-tide/10 text-tide-deep`).
- **Placement** — `<select>` (`INPUT` class) Auto / Top / Right / Bottom / Left → `labelDir`.
- **Priority bump** — small number input `−50…50` → `labelPriority`, helper: *"Higher = shows at lower zoom and wins space over nearby labels."*

### 6d. Editor — live preview (graft: canvas mirrors public map)

The builder canvas currently `bindTooltip(f.title, …)` on markers at **`editor.tsx:441`**. Swap the text to the effective label so the admin sees the real chip text as they type:

```ts
.bindTooltip(resolveLabel({
  title: draft?.labelText || f.title, category: f.category, kind: f.kind,
  label: f.label,
}).text, { direction: "top", offset: [0, -14] });
```

Extend the live-preview `useEffect` (lines 648–666) — add `draft?.labelText` to its dep array (line 666) and rebind the selected layer's tooltip so it updates on keystroke. This is a **hover-tooltip approximation** of the always-on chip, not a pixel-perfect mirror; if you want true parity later, render the same `fm-label` divIcon on a matching pane in the editor's `CONTEXT_PANE` context (the pane machinery already exists at line 744) — noted as out-of-scope polish, not required for v1. Document in a one-line hint under the group: *"On the live map, labels declutter by zoom — zoom in to see more."*

### 6e. Parallel `/admin/map` parking editor

Parking **zones** are edited in a separate editor (`/admin/map`) and rendered on the public map via `builtins.parkingZones`. **v1 scope:** parking zones do **not** get labels (their popups read fine on tap and they're low-priority). If you later want zone labels, thread a `label` default in `resolve.ts`'s `parkingZones` mapper (line 44) exactly like restaurants and add the same admin group to the `/admin/map` editor — but that's out of scope here (§9).

---

## 7. Build order (phased)

Each phase is independently shippable and leaves the map working.

| Phase | Scope | Files | Ships |
|-------|-------|-------|-------|
| **P1 — Smart always-on labels** | `MapLabel` type + `resolveLabel`/`shortenTitle`/`labelPriority`/`CATEGORY_LABEL_RANK`; restaurant `label` in `resolve.ts`; label pane + chip build + batched measure + `declutter()` + zoom gate + rAF/debounce + teardown; `fm-label` CSS; fix `restaurantPopupHtml` emoji (§8 note). | `types.ts`, `resolve.ts`, `feature-map.tsx` | Readable names on every pin, R1+R2+R6+R7 satisfied with **zero admin work**. Biggest UX win first. |
| **P2 — Admin overrides** | API `label` validation block; Draft/toDraft/buildFeature; the "Label" form group; live-preview tooltip swap. | `route.ts`, `editor.tsx` | R3+R4+R5 — per-feature short label, show/hide, placement. |
| **P3 — Collision polish** | `dir:"auto"` 4-direction placement; per-view density feel tuning; optional true-parity editor chip; optional parking-zone labels. | `feature-map.tsx` (+ editor) | Refinement only; P1's gate+greedy already prevents overlap. |

Ship **P1 alone** if time is short — it delivers the core requirement.

---

## 8. Testing checklist

- [ ] **Dense-downtown acceptance (the real test).** On the **food-drink view** (17 restaurants in the ~300m ferry district) at three zooms — town / mid / ferry — verify: (a) **no two chips overlap**, (b) the **opening (post-fitBounds z16) frame is NOT empty** — a readable subset of restaurant names shows, (c) pass time is sub-ms. This 17-restaurant cluster *is* the acceptance test, not a hypothetical.
- [ ] **R2 disambiguation.** 8 restaurants sharing 🍽️ each show their own name chip.
- [ ] **Mobile device test (primary).** Real phone: legible 11px chips over OSM tiles, smooth pan/zoom (no hitch at inertia-settle), no "tapped the name, nothing happened" confusion (chip sits over its pin).
- [ ] **Hydration / no leak (StrictMode).** In dev, mount→unmount→remount the map: no double map, no orphaned label markers, no `latLngToContainerPoint` error after teardown (rAF + timer cancelled in cleanup). Switch views repeatedly and confirm `labelsRef` resets.
- [ ] **a11y / contrast.** Chip span has `aria-hidden="true"` (popup carries the accessible name; no double-announce). White 11px/600 on **opaque `#16405e`** meets ≥4.5:1 over dark water/forest tiles (the semi-transparent `#16405ecc` does **not** reliably — use opaque + hairline + halo).
- [ ] **XSS via admin text.** Save a feature with label text `"><img src=x onerror=alert(1)>` and `'"&<>` — renders as literal text, no execution (esc() + text-node). Confirm no attribute-injection path.
- [ ] **RTL / CJK / emoji width.** A label with `Café ☕`, a CJK string, and an RTL string render in correct visual order (`dir="auto"`) and reserve correct space (batched `offsetWidth`) — no first-frame overlap.
- [ ] **Round-trip persistence.** POST a feature with a full `label` override → GET → the `label` survives with all sub-fields (guards the silent-drop must-fix). Automated route test.
- [ ] **Override behaviors.** `show:"on"` bypasses the zoom gate (visible town-wide); `show:"off"` never shows; `dir` places correctly; a `+40` priority bump surfaces a normally-hidden label at a lower zoom and wins a collision.
- [ ] **Graceful degradation.** Temporarily throw inside `declutter()` — pins + popups still work exactly as today (labels are pure enhancement).

> **Bundle-in note (not a separate task):** while threading `resolve.ts`, also fix `restaurantPopupHtml` (`feature-map.tsx:223`) to use `markerCategory(r.category).emoji` instead of the **hardcoded 🍽️** — today a coffee shop shows a ☕ pin but a 🍽️ popup, and adding a name chip spotlights the drift (☕ pin + "Java House" chip + "🍽️ Java House" popup). Pass `r.category` into the popup builder. One-line fix; do it in P1.

---

## 9. Risks & out-of-scope

**Risks (all designed-out above, kept for reviewer awareness):**
- **First-frame overlap** from wrong size estimate → eliminated by the **batched `offsetWidth` measure before the first declutter** (§5c), not lazy-on-reveal.
- **Very dense identical clusters** legitimately hide most labels at low zoom — **by design** (R6); the zoom gate + priority bump are the escape hatch, and pins+popups stay fully tappable so no info is lost.
- **StrictMode double-invoke / rAF-after-teardown** → guarded behind the post-await `mapRef.current` check + cleanup cancels rAF/timer + `declutter()` no-ops on null map (§5d).
- **API silent-drop of `label`** → validation block added (§6a) + round-trip test.
- **Incompatible priority formulas** → reconciled to one absolute 0..100 scale; the `17 − priority` graft is explicitly **not** used (§3c).
- **Popup pane (700) above label pane (620)** — a wide chip could visually crowd an open popup; acceptable since popups are modal-ish on tap (mitigated by the ~18-char cap + `top` default).
- **Marker count ~2× on food-drink** (34 vs 17) — trivial; label markers are non-interactive (no event listeners).

**Out of scope (v1):**
- Labels on **lines/trails/areas** (default `off`; their popups read well and center-anchoring long polylines is awkward — opt-in only).
- **Parking-zone labels** and a parking-zone label editor in `/admin/map` (§6e) — thread later if wanted.
- A **spatial-hash** declutter upgrade (only if a future view grows to hundreds of labels).
- **Per-restaurant admin label override** (name-as-label needs no admin surface; add a `shortName` to the restaurant editor later if desired).
- **True pixel-perfect editor-canvas parity** (v1 uses an always-on tooltip approximation; render the real chip on `CONTEXT_PANE` later for exact parity).
