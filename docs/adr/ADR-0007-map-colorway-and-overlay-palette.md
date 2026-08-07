# ADR-0007 — Map colorway ("Evergreen & Sound") and the overlay palette it requires

## Status

Accepted — records the 2026-07-31 owner decision. Supersedes the `PALETTE`
**values** introduced by commit `8266f1c` ("E31 P7: brand-anchor the basemap
palette") on the unmerged branch `e31-p7-style-close`; keeps that commit's
**structure** and doctrine. ADR-0006's deferred list already reads "Brand
palette (E31 phase 7): LANDED" — true on that branch, not yet on `main`.
Evaluation that produced this decision, including rendered specimens:
<https://claude.ai/code/artifact/bf677835-9d13-42ba-be40-bdb416fdfbee>

## Context

ADR-0006 made the base layer *data* — a hand-rolled MapLibre style in
`src/lib/map/basemap.ts` — but left it wearing the stock Protomaps "light"
flavour: warm-cream paper, agricultural greens, mustard arterials. That was a
tileset default, never a decision, and it fails two jobs a basemap can fail
independently:

1. **It doesn't say "Kingston."** Flat beige land reads as a desert town. The
   site's own copy calls Kingston a "harbor and marina wrapped in evergreen
   forest"; the map showed neither.
2. **It doesn't get out of the way of the data.** This is the measurable one.
   The most saturated thing on the map was a road casing (highway `#f4c667`,
   chroma 141) rather than the parking, ferry and trail overlays drawn on top,
   and **none** of the seven base surfaces were achromatic — so every overlay
   colour was arguing with a tinted fill somewhere.

`8266f1c` addressed (1) and scoped itself explicitly to it: its comment says
"the phase-6 look is kept; this pass only pulls temperature and saturation
toward the brand." Measured against (2), it moved the wrong way on two counts —
water grew *more* saturated (chroma 62 → 66), and warming the arterial toward
coral moved it **closer** to the `park-and-ride-24h` badge it already muddled
with (Δhue 9° → 5°). Peak base chroma fell 141 → 116; still the loudest thing
on the map.

Two constraints emerged from measuring, both non-obvious:

- **Contrast ratio alone mis-ranks map layers.** A green line on blue water
  reads fine at 2:1 — hue carries it. What kills a thematic overlay is
  *same-hue plus small value step*. Judge overlay-against-base on hue, value
  and chroma together, never on WCAG ratio alone. (WCAG ratio remains the right
  and only test for *text*.)
- **The `park-and-ride-24h` badge was over-constraining the basemap.** With it
  at `#e8891d`, exactly one warm sand (`#e6dcc4`) clears it, and only on
  lightness — no warm arterial escapes orange on hue. Escaping sideways fails
  too: a green-grey arterial clears the badge but lands ΔL* 0.2 from parkland,
  so the road merges into parks instead.

That badge also carries a **WCAG failure**: `.fm-pr-pin` sets `color:#fff` on
`#e8891d` = **2.62:1**, at 12px/800 — bold, but under the 18.66px that would
make it WCAG "large text", so it needs 4.5:1.

## Decision

### 1. Keep the phase-7 structure, replace the values

The named `PALETTE` constant, its derive-from-`globals.css`-tokens doctrine,
and its "if a brand token changes, re-derive rather than edit ad hoc"
instruction all stay. Only the hex values below change. Tints of the brand
tokens remain correct — a basemap needs near-neutral surfaces the UI tokens are
too saturated to supply.

### 2. The base is a LIGHT family; the overlay is a DARK family

The organising rule. Base surfaces stay light and desaturated; overlay colours
stay dark and saturated. Hue is then free to carry meaning on both sides, which
is what lets the land finally own green. Concretely: **the two largest surfaces
(`earth`, `building`) become achromatic** (chroma 4 and 6), giving every
overlay hue somewhere safe to land.

```
bg              #eef0ee    paper — marine-layer light, cooled off the cream
earth           #e4e8e4    land — chroma 4, neutral ground
forest          #b3cbad    fern-derived
grassland       #c3d4bd
farmland        #dad7c4
landcover       #cdd6c8
cemetery        #c9d2c4
pedestrian      #e7e9e5
greenspace      #aac4a4    parks/gardens
water           #b5d2de    tide/seaglass family, quieted
building        #d8ddd7    chroma 6, neutral
buildingOutline #bfc6be
highway         #e6dcc4    warm sand — NOT mustard, NOT coral-amber
majorRoad       #eee7d6
road            #ffffff
path            #d6cfbd
rail            #c6c2b4
labelMinor      #59645d
labelMain       #3f4b45
```

### 3. Land depth is capped by label contrast, not by the overlay

`forest #b3cbad` puts the worst text surface at **4.84:1 — AA**. One step
deeper (`#9bbd96`, true Douglas-fir) drops to 4.04:1 and fails. This colorway
deliberately sits one step under that ceiling. **Do not deepen the greens
without re-running text contrast on every surface.** If it reads too dark in
daylight on a phone, the sanctioned fallback is `forest #cbdac5` /
`greenspace #c4d5be` with everything else unchanged.

### 4. Four overlay colours move — and free-parking green is NOT one of them

In `feature-map.tsx` (whose comment says these conventions are *kept in sync
with both admin editors*, so this is three files, not one):

| key | from | to | why |
| --- | --- | --- | --- |
| `park-and-ride-24h` | `#e8891d` | `#8a4c22` | brand `coral-deep`; white text 2.62:1 → **6.69:1**, fixing the AA failure, and unpinning the arterial |
| `load-zone` | `#f0b429` | `#b8860b` | the yellow fought the new sand arterial |
| `ferry-holding` | `#64748b` | `#3f5473` | was a near-twin of `permit`; navy suits the ferry |
| `permit` | `#6b7280` | `#7a7468` | warm taupe — the deliberate odd-one-out among the neutrals |

**Unchanged: `free-2hr` green `#2e9e4f`, `free-unrestricted` cyan, `paid`
purple, `prohibited` red, trail fern, route teal, boundary navy.**

The owner offered to give up parking green so the land could own it. Measurement
said the trade was unnecessary: land green and parking green separate on
**saturation** (forest chroma 30 vs parking green 112, ΔC ≈ 82), not on hue, at
every land depth tested. Recorded here so it is not re-litigated.

Result: **zero confusable pairs inside the parking legend.** That is new — the
shipped palette has two (`permit`/`ferry-holding`, and P&R orange against
load-zone yellow).

### 5. If the base ships without the overlay changes

Keep the arterial at `#e6dcc4` exactly. It is the only warm sand that clears
today's P&R orange, and only by lightness (ΔL* 22, on the threshold).

## Consequences

- `basemap.ts` remains the single place the base layer is defined; this is a
  values-only change to `PALETTE` plus the label colours.
- `basemap.test.ts` asserts layer ids, zoom ranges, the no-POI/no-sprite
  guarantees and label fields — **it asserts no colours**, so the swap is
  test-safe. Colour intent is therefore protected by this ADR and by review,
  not by a test. Adding a chroma/contrast invariant test is open (below).
- The P&R change fixes a live accessibility defect and should land regardless
  of whether the colorway does.
- Three files move together for the overlay half; confirm the admin-editor
  scope before starting.
- Peak base chroma 141 → 41; achromatic surfaces 0 → 2; coastline separation
  8.3 → 9.1 L*. Worst text contrast moves 5.57:1 → 4.84:1 — still AA, and that
  is the price of the evergreen; §3 is the guard on it.

## Deferred (tracked, not silently dropped)

- **A contrast/chroma invariant test.** The a11y suite has static invariant
  tests; a basemap analogue (peak chroma ceiling, per-surface label-contrast
  floor) would keep §2 and §3 from eroding. Not written.
- **Dark map variant.** Still blocked on the app having any dark theme
  (ADR-0006). This colorway is the light `PALETTE`; a dark one is a second.
- **`sr104-traffic-map` / `ferry-vessel-map` overlay colours** were not audited
  against the new base — only `feature-map`'s conventions were.
- **Per-kind road widths.** The style comment in `basemap.ts` notes MapLibre
  forbids mixing `["zoom"]` with `["get","kind"]` in one interpolate, so roads
  are differentiated by colour at a uniform width. A quieter arterial leans
  harder on that missing width hierarchy; separate line layers per kind is the
  real fix.

---

## Amendment 1 — an eighth parking colour: `business-customer` (2026-08-04)

**Status:** accepted (owner request, 2026-08-04).

§4 above closed with *"zero confusable pairs inside the parking legend"*. Adding
a colour is the one change that can quietly undo that, so the new entry was
measured against every existing rule colour before it was picked, and the claim
is now enforced rather than asserted (`tests/unit/parking-rule-palette.test.ts`).

### The new rule

| key | colour | label |
| --- | --- | --- |
| `business-customer` | `#9c2f6f` | "Customer parking" |

A lot a business keeps for the people visiting it. It is deliberately its own
rule rather than `free-unrestricted` plus a note: in Kingston the question a
visitor needs answered is not *"does this cost money"* but *"am I the person
this space is for"*, and only a distinct colour answers that at a glance.

### Why this hue

Deep magenta was the one region of the wheel the legend had left. Measured
(CIE Lab ΔE76, against the base palette in `mapStyle()`):

- **ΔE 41.3** from its nearest neighbour, `paid` purple `#7c4dbe` — *wider than
  any pair already in the legend* (the tightest shipped pair is
  `park-and-ride-24h` / `load-zone` at 36.3). It does not become the new worst
  case, which is the specific thing the test now pins.
- **3.65:1** against the worst base surface (greenspace `#aac4a4`), clearing
  WCAG 1.4.11's 3:1 for graphical objects.
- **6.89:1** for the white pill text in the popup — slightly better than the
  `park-and-ride-24h` badge (6.69:1) that §4 was written to fix.

Teal, indigo, orchid and olive were all measured and rejected: each landed
within ΔE 28 of an existing rule, or under 3:1 on the base.

### What this exposed, and did NOT change

Measuring the whole legend showed that **five of the seven original rule colours
already sit below 3:1 against the lightest base surfaces**, and three below
4.5:1 for the white pill text:

| bar | rules currently under it |
| --- | --- |
| 3:1 vs base surfaces (1.4.11) | `free-2hr`, `free-unrestricted`, `prohibited`, `load-zone`, `permit` |
| 4.5:1 white pill text | `free-2hr`, `free-unrestricted`, `load-zone` |

These predate this amendment and are **left alone** — they are §4's values, and
repainting the parking legend is a colorway decision, not a side effect of
adding a rule. The exact set is pinned in the test as a **ratchet**: a new
colour cannot join it silently, and fixing one of them fails the test too, which
is the prompt to amend this ADR deliberately. Worth scheduling on its own.

### The cost badge

`freeOrPaidFromRule("business-customer")` returns `"free"`. It is the closest
call in that function — a customer lot is free only to customers, the same
conditional shape that makes `permit` return `undefined` — and the reasoning
either way is written out at the bottom of `src/lib/map/parking-labels.ts`. The
deciding difference: a visitor becomes a customer by walking in, whereas nobody
acquires a permit that way. Flipping it is a one-line change and the test that
pins it names the tradeoff.

---

## Amendment — the Port bay palette (E34, 2026-08-06)

The bay layer (`docs/MAPS.md`, "The Port bay layer") draws the Port lot's 302
individual spaces coloured by **which text-to-pay code applies**, which is a
distinction the `ParkingRule` palette cannot express: POKPARK, POKHILL and
POKTT are all `rule: "paid"` and rendered as one purple, hiding the only
decision a driver at the lot actually has to make.

### What was measured

The first pass used the brand tokens raw. Measuring them against this ADR's own
two tests found that **none of them qualified**:

| bay colour | token | nearest legend colour | ΔE76 | worst contrast on PALETTE bases |
| --- | --- | --- | --- | --- |
| POKPARK | tide-deep `#16758f` | `free-unrestricted` `#1E96C0` | 15.4 | **2.80:1 — fails 1.4.11** |
| POKHILL | fern `#4a7c59` | `permit` `#7a7468` | 26.0 | **2.58:1 — fails 1.4.11** |
| POKTT | coral `#a85c28` | `park-and-ride-24h` `#8a4c22` | **11.4** | 3.6:1 |
| disabled | sound `#324a6d` | `ferry-holding` `#3f5473` | **5.2** | 5.9:1 |
| port-use | `#7d2740` | `business-customer` `#9c2f6f` | 22.5 | 5.6:1 |

Two of those are outright defects: `disabled` at ΔE 5.2 from `ferry-holding` is
the same navy, and the two contrast failures put small filled shapes under the
3:1 that WCAG 1.4.11 requires for graphics.

### Decision

1. **Contrast is the hard floor.** Each pay-code colour moved to the nearest
   value to its brand token clearing **≥3:1 on every base surface** and **ΔE76
   ≥30 from the other bay colours**: POKPARK `#096f8a`, POKHILL `#3f6f4e`,
   POKTT `#9c511e`, disabled `#33395d`. Drift from the tokens is ΔE 2.5–8.7 —
   not visible side by side.
2. **Port-use and KCYC reuse `permit` `#7a7468`** instead of taking a seventh
   hue. Both mean "you need something you do not have", which is what `permit`
   already says. The Port's map splits them; a visitor's decision does not.
3. **Free-2hr green and permit taupe are unchanged** on bays, so a bay and the
   zone it sits in agree.

### Open — the call to review

Judged against the **full** parking legend rather than against each other, two
pairs still sit under 30: POKPARK is ΔE 15.4 from `free-unrestricted`, and
POKHILL is ΔE 26.0 from `permit`. They differ in form — small filled bays
against a street stroke and a zone wash — and this ADR's own Context section
says to judge on hue, value and chroma together rather than on one number. That
argument is real on the canvas and weaker inside one flat legend, where a reader
sees swatches with no form to distinguish them.

So §4's "zero confusable pairs inside the parking legend" **no longer holds as
written**. The honest options are to accept these two on form, to regroup the
legend so the bay palette reads as its own question, or to move
`free-unrestricted` and `permit`. That is a design decision, recorded here
rather than settled quietly.
