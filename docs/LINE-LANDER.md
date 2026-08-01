# /line — the Line Lander (E33)

The page for people sitting in the SR-104 ferry boarding line west of the
Lindvog Rd dispenser, reached by a QR code on a physical roadside sign.

**Status: LIVE BUT UNLISTED since 2026-08-01.** It shipped dark through slices
1–3; an explicit `hidden: false` record has since made it public, so it answers
200 to anyone with the URL. It is deliberately not advertised — no nav link, no
sitemap entry, `noindex` on the page — because its framing ("you're in the
line") is wrong for anyone who is not, and it would compete with /ferry for
queries /ferry should win. The QR/sign slice (4) and the service-worker slice
(5) still wait for the custom domain.

Owner: `vk/line-lander`. Geometry: `vk/ferry-line-geometry`
(src/lib/ferry-line-geometry.ts — polyline + `distanceToLineMeters` /
`walkMinutesFromLine`; the SR-104 map component consumes the same constants).

## Current state (slices 1–3)

- `src/app/(site)/line/page.tsx` — ISR (`revalidate = 60`), `noindex`, and
  listed in `UNLISTED_PAGES` so it never enters sitemap.xml. Still in
  `DEFAULT_HIDDEN_PAGES`, which is now a **restore-safety net**, not a
  ship-dark gate: the live `hidden: false` record makes it public, and if that
  record is ever lost the page falls back to 404 for **everyone** rather than
  republishing itself unattended. Do not remove it from that list as a
  tidy-up — with no record, removing it means public by default.
- `src/app/(site)/line/preview/page.tsx` — the admin preview (banner + the
  exact visitor body). Admin-only, always.
- Body: `src/components/line-lander.tsx` (+ `line-food.tsx`,
  `line-amenities.tsx`). Every visitor sentence is a `line.*` key in
  `src/lib/site-copy-registry.ts`, editable at Admin → Content. Boarding-pass
  FACTS (when-required/exempt + the transient notice) come from
  Admin → Ferry info, shared with /ferry.

### Why /line has no in-place admin preview (deviation from the /es pattern)

`assertPageVisible`'s admin pass-through reads the session cookie on the
hidden branch. `next build` prerenders with an empty store, so a
default-hidden route is hidden AT BUILD TIME — that cookie read would mark
the route dynamic and make `revalidate` inert forever (the /ferry trap). The
whole premise of /line is a cache hit on cellular, so it uses
`assertPageVisibleStatic` (cookie-free, 404s admins too) and the preview
lives at `/line/preview` instead. Details: `src/lib/page-visibility.tsx`.

## Flip procedure — ALREADY DONE (2026-08-01). Kept as the record and the recipe

The page is live. Steps 1–3 below have happened; step 4 (service worker +
Lighthouse URL set) has not. Re-read this before flipping any other
default-hidden page, and before flipping /line back.

1. Someone who knows the highway reads the page at `/line/preview` — the
   amenity block especially (Open question 2) — before anything goes public.
   *This is what caught the portable toilet, and then caught it being pinned at
   the wrong end of the line.*
2. Admin → Site content → "Ferry line (SR-104)" → unhide. That writes
   `{ id: "/line", hidden: false }` — a runtime data change, no deploy,
   audited.
3. The public 404 is ISR-cached: allow up to ~2 minutes for the flip to reach
   visitors. Verify with an anonymous/private window.
4. THEN the slice-5 follow-up PR: `/line` into `public/sw.js` `NAV_ALLOWLIST`
   (exact path) + VERSION bump + sw-contract test in the same commit. Never
   while dark — the cached-404 trap documented in sw.js. Same PR: add
   `http://127.0.0.1:3000/line` to the `.lighthouserc.json` URL set — the
   0.85/4300 floors can't be measured by CI while `/line` 404s in the CI
   build, so until this lands the floor is inferred (real ISR, no dynamic
   APIs, deferred map), not measured.
5. Re-hide = the same toggle. The page 404s again within the same window.

## Perf floor (hard — this is the page's reason to exist)

- No `cookies()`/`headers()`/`getSide()` anywhere in the page tree;
  `side="kingston"` is hardcoded. CI greps for this (epic Verification).
- `getEmpiricalBusyness()` is never called here (observation-log full scan —
  see memory `visit-kingston-ferry-perf`). The busyness panel renders
  heuristic-only, and only while the prediction feature flag is on
  (session-free `getFerryPredictionEnabled`).
- `Sr104TrafficMap` stays below the fold (IntersectionObserver-deferred).
- Lighthouse CI floors (0.85 perf / 4300 ms TTI) apply.

## Composition contract (what this page must never grow)

- **E25** owns queue sensing, the `/queue` self-mark page, and the versioned
  prediction API. `// E25 swap point` comments mark where the contract will
  substitute (`line-lander.tsx`). E25 Phase 0's map-features queue geometry
  supersedes `ferry-line-geometry.ts` as canonical when it lands.
- **E26** owns pay-links — /line links `/parking`, never rebuilds payment.
- **E21** owns outbound sends — no "text me when the line moves", ever.
- Food is deep-links out (`orderingUrl` / `tel:`) — zero order capture, zero
  payment, never merchant-of-record (00-DECISIONS §4; VISION-LINESIDE-DELIVERY
  §7 seam #3 — this page is that vision's future front door, so the stable
  URL + deep-link-only + swap-point seams are load-bearing).
- Nothing position-derived is collected or transmitted. The page ranks places
  against the LINE, not against the visitor.
- No UGC.

## Amenity truth block (Open question 2 — ANSWERED 2026-08-01)

The block is data-driven over the sourced amenities layer (M-19-03) with a
10-straight-line-minute threshold (`WALKABLE_FROM_LINE_MAX_MIN`).

It shipped leading with the honest empty state — "no restroom walkable from the
line" — pending Chamber ground-truth for the stretch west of Lindvog. **That
ground-truth arrived:** the Chamber confirmed a **portable toilet at the
boarding-pass dispenser** (step 2 of the pass system, just west of Lindvog Rd),
seeded as `restroom-dispenser-portable`. The dispenser is the eastern end of
`LINE_WEST_OF_DISPENSER`, so its distance to the waiting stretch is ~0 and it is
the first amenity ever to land in the `walkable` half.

Consequences, all live:

- the empty state no longer renders; the `walkable` branch does. Its heading and
  note (`line.amenities.walkableTitle` / `.walkableNote`) were added at the same
  time, because that branch had **never rendered before** — an unlabelled
  "~1 min from the line" reads as "~1 min from *me*" to a driver parked a mile
  back at Barber Cutoff. The note says the figure is measured to the nearest
  point of the line, not to their car.
- `line.amenities.empty` is kept and reworded: the split is data-driven, so a
  future data change could empty it again.
- the unit test now pins the seed to *exactly this one* walkable amenity, and
  asserts the dispenser toilet does **not** appear in the at-the-dock list.

Note the earlier miss: it was first seeded at the **tollbooths**, which put it in
`atTerminal` and left the empty state intact. The Chamber corrected the location
to the dispenser, which is what flipped the answer — the pin's position, not the
threshold, is what decides this.

## Attribution (decided in slice 4)

Default: /line self-attributes (nobody types it — arrivals ≈ scans; the
tracker records pathname only). Per-sign paths (`/line/s/a`) only if Mat
wants per-location counts. **Do not print any QR until the custom domain is
live** — `NEXT_PUBLIC_SITE_URL` is build-inlined and a printed sign is
forever.

## Remaining slices

- Slice 4: `/admin/line-sign` print page (vendored QR encoder, QUARTILE) +
  sign copy. Physical sign needs the WSDOT right-of-way question answered
  (Open question 1).
- Slice 5: flip + SW allowlist follow-up PR (incl. `/line` into the
  `.lighthouserc.json` URL set) + analytics sanity in /admin/ops.
