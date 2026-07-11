# Roadmap v2 — improvement backlog

The prioritized backlog for evolving Explore Kingston (or re-creating it —
see [§11](#11-if-rebuilding-from-scratch)). Written **July 2026**, re-derived
against the current code after ~33 commits landed a whole seam of production
infrastructure. Every item carries a priority and a one-line rationale:

- **P0** — blocks real users or protects irreplaceable data/trust.
- **P1** — should land within the next season of work.
- **P2** — valuable; defer until P0/P1 are done.

Cross-references: [OPERATIONS.md](OPERATIONS.md) (deploy + env),
[DEPLOY.md](DEPLOY.md) (the running Render home), [DATA_SOURCES.md](DATA_SOURCES.md),
[SYNDICATION.md](SYNDICATION.md), [ARCHITECTURE.md](ARCHITECTURE.md),
[SDD.md](SDD.md).

**Read [§0](#0-shipped-since-v1) first.** Several items that led the old backlog
as P0s are now done and live; the backlog below is only what genuinely remains.

---

## 0. Shipped since v1

The original v2 backlog was written when the app was file-only, un-deployed, and
had no CMS. That season of work is done. These are no longer backlog — they are
the current baseline, recorded here so nobody re-lists them.

| Was | Now | Where |
|---|---|---|
| P0 — migrate file stores off the local disk | **Done.** Dual-backend seam: every store branches on env. Neon Postgres (`overlay`/`analytics_event`/`survey_response`/`ferry_observation` tables), Vercel Blob for images, Upstash Redis for shared rate-limit. Stores unchanged above the seam. | `src/lib/db.ts`, `src/lib/blob-store.ts`, `src/lib/rate-limit.ts`, `scripts/migrate-to-db.mjs` (schema since E05: `src/lib/db/schema.ts` + `db/migrations/`) |
| P0 — production deploy | **Done (Phase 1 live on Render).** Docker/standalone, Starter web + 1 GB disk at `/data`, filesystem mode, `/api/health` 503-gates on `dataWritable`. Auto-deploy on push. | `Dockerfile`, `render.yaml`, `fly.toml`, `src/app/api/health/route.ts`, [DEPLOY.md](DEPLOY.md) |
| P0 — persistent-disk portability | **Done.** `DATA_DIR` resolves all mutable state; health gate refuses to serve until the volume is writable. | `src/lib/data-dir.ts` |
| P0 — auth rate limiting | **Done.** login / setup / redeem are rate-limited; shared sliding window on Upstash when configured, in-process Map otherwise. | `src/lib/rate-limit.ts`, `src/app/api/auth/{login,setup,redeem}/route.ts` |
| P0 — analytics DB-backed store | **Done.** `saveEvent`/`summarize` branch on `hasDb()` → `analytics_event`. (Debt survives — see [§6](#6-analytics-v2).) | `src/lib/analytics-store.ts` |
| P1 — password reset / self-service account | **Done (admin + self-service half).** Admin generates a shown-once temp password (`/api/portal/users` `reset-password`); a signed-in user changes their own name/email/password (`/portal/account`, `/api/auth/{account,password}`). **Not** a public forgot-password magic-link flow — that half remains, see [§3](#3-auth-v2). | `src/app/api/portal/users/route.ts`, `src/app/api/auth/password/route.ts` |
| P1 — content CMS | **Done.** 77 editable copy blocks (client components reached via `copy-context`), per-page show/hide. | `/admin/content`, `src/lib/site-copy-registry.ts`, `src/lib/copy-context.tsx`, `src/lib/page-visibility.tsx` |
| — map CMS | **Done.** Named multi-view map builder with drawable markers/lines/trails/areas + built-in data layers; the public `/map` and `/parking` render CMS views. Polygon zone editor. | `/admin/maps`, `/admin/map`, `src/lib/map/*`, `src/components/feature-map.tsx` |
| — off-site backup | **Done.** Admin-gated JSON bundle of the whole `DATA_DIR` (`/api/admin/backup`, "⤓ Download backup" on `/admin`); restore via script. | `scripts/restore-backup.mjs`, `scripts/backup-data.sh` |
| — ATM / cash map | **Removed, not migrated.** The cash-machine map and `src/lib/data/atms.ts` were deleted; cash guidance is now a structured ferry-info "cash-tips" record. (`Atm`/`ParkingArea` remain orphaned in `types.ts` — see [§8](#8-quality-engineering).) | `src/lib/stores/ferry-info-store.ts` |
| — ferry reminders, phase 1 (`.ics` + in-page notify) | **Done.** Per-sailing `.ics` with a `REMINDER_LEAD_MIN = 20` alarm, plus a browser notification while the tab is open. Phase 2 (push when closed) remains — see [§1](#1-mobile-first--pwa-hardening). | `src/lib/ferry-reminder.ts`, `src/app/api/ferry/reminder/route.ts`, `src/components/next-ferries.tsx` |

Two mobile-hardening P0s from the old list are also **already done** and dropped
from [§1](#1-mobile-first--pwa-hardening): safe-area insets on the bottom nav
(`pb-[env(safe-area-inset-bottom)]` on the bar in `site-nav.tsx`; `body` bottom
padding `calc(4.5rem + env(safe-area-inset-bottom))` in `globals.css`), and the
home hero now goes through `next/image` (`fill` + `sizes="100vw"` + preload) —
so the LCP work below is measurement/CI, not a rewrite.

---

## 1. Mobile-first / PWA hardening (CRITICAL — owner-flagged)

The primary user is a phone on Highway 104, often in the ferry line
([REQUIREMENTS.md](REQUIREMENTS.md)). This section outranks everything except
test coverage ([§8](#8-quality-engineering)), which now protects the shipped
production surface.

**What already exists:** fixed bottom nav + "More" sheet with safe-area insets
(`src/components/site-nav.tsx`), responsive grids, mobile-first pages,
tap-friendly ferry board, and the hero on `next/image`. This is a real
baseline. The gap that remains is offline and installability.

**The v2 bar:**

- **P0 — PWA manifest + service worker caching the ferry schedule and tides for
  offline.** Still the killer feature and **still not built** — there is no
  `manifest.webmanifest`, no `sw.js`, no `serviceWorker` registration anywhere
  in `src/`. Cache the fallback schedule, the last-fetched live sailings, and
  today's tides so the board works **on the boat** and in the SR-104 dead zones.
  Show a "cached as of HH:MM" honesty label (consistent with the app's
  `live: false` pattern). Everything in this section that says "once the SW
  exists" is gated on this one item.
- **P0 — Lighthouse mobile performance budget: LCP < 2.5 s on throttled 4G, in
  CI.** The hero image now uses `next/image`, so the remaining work is
  *measurement and a regression gate*, not a rewrite: run Lighthouse against the
  home page, confirm the `next/image` `sizes`/priority actually produced a small
  LCP resource, and wire the budget into the CI added in [§8](#8-quality-engineering)
  so it can't silently regress.
- **P1 — installability.** Once the manifest + SW exist, verify the Android
  install prompt and iOS Add-to-Home-Screen (icons, splash, `standalone`
  display). iOS web push ([below](#1-mobile-first--pwa-hardening)) only works
  from an installed PWA, so this unblocks reminders phase 2.
- **P1 — ferry reminders, phase 2: web push when the app is closed.** Phase 1
  shipped (`.ics` + in-page `Notification` while the tab is open — see
  [§0](#0-shipped-since-v1)). Phase 2 is notifications that fire with the app
  closed. **Depends on the PWA manifest + SW above**, then adds VAPID keys, a
  push-subscription store (privacy-review the endpoint before shipping — it's a
  per-device identifier), and a scheduler firing ~20 min before departure (e.g.
  a Render cron scanning armed subscriptions — the same cron pattern already
  used for `ferry-observe`/`ferry-accuracy`). iOS only delivers web push to an
  installed PWA. This was the deliberately-deferred half of the "both, phased"
  reminder decision.
- **P1 — real-device test matrix.** iOS Safari (current + one back) and Android
  Chrome on a mid-range device. Test the hunt camera-capture path inside the
  Facebook/Instagram in-app browsers specifically — that's where Chamber
  promotion lands ([DATA_SOURCES.md](DATA_SOURCES.md)) and where camera/upload
  quirks bite.
- **P1 — 44 px minimum touch-target audit.** Sweep every interactive element
  (nav icons, badge chips, sailing rows, the 📅/🔔 reminder controls, portal
  form controls) against the 44×44 CSS-px floor; fix by padding, not font size.
- **P1 — thumb-zone placement for primary CTAs.** The one action per page
  (Ferry: next sailing / get-in-line; Eat: call/order; Hunt: submit photo)
  belongs in the bottom third of the viewport.
- **P1 — form input types / `inputmode` audit.** Portal + survey + hunt forms:
  `type="email"`, `inputmode="numeric"` for zips/counts, `autocomplete`
  attributes.
- **P2 — `prefers-reduced-motion` support.** Guard transitions/embeds; small
  effort, accessibility win.
- **P2 — ferry reminders phase-1 polish.** All optional: surface the 📅/🔔
  controls on `/ferry` too (home-only today); add fast-ferry (Seattle)
  reminders (car ferry only today); a lead-time choice (15/30/60 min vs the
  fixed `REMINDER_LEAD_MIN = 20`); a discoverability hint above the sailing rows.

## 2. Ferry busyness forecast — maturation to trust

The forecast **ships dark**: `ferry-prediction-store` defaults the public flag
**OFF**, so the `/ferry/plan` planner, the "how busy today" panel on `/ferry`,
and the home planning callout are visible only to signed-in admins for
validation until the Chamber flips it on. The model
(`src/lib/ferry-forecast.ts`) is a pure, client-safe heuristic calibrated to
WSF's "Best Times to Travel" grid, which already *blends in* empirical
observations per direction×season×weekday×hour bucket. The remaining work is
the path to trusting it enough to flip on.

- **P1 — accumulate `ferry_observation` data.** The blend only helps once
  buckets clear `MIN_SAMPLES`. Two schedulers already log snapshots:
  `/api/ferry/observe` (throttled; `.github/workflows/ferry-observe.yml` cron
  covers overnight gaps) writes sailing-space + delay, and organic traffic logs
  opportunistically. Keep the cron running through a full summer so weekend and
  holiday buckets fill.
- **P1 — the accuracy backtest, run on a cadence.** `/api/ferry/accuracy`
  (`recordAccuracySnapshot()`, driven by `.github/workflows/ferry-accuracy.yml`)
  backtests the heuristic against logged observed fullness and records a rolling
  history the admin surface shows. Define the go-live bar here: a target error
  band across the tiers (Light/Moderate/Busy/Very-busy/Extreme), sustained over
  N days, before flipping the flag.
- **P1 — a calibration cadence.** The model constants are hand-tuned to the
  Summer 2026 WSF grid. Schedule a re-calibration when WSF republishes the grid
  each season, and when a substitute vessel skews a stretch of observations
  (the one case the model explicitly can't see — the live board stays the
  authority for it).
- **P1 — flip the flag, then watch.** Once the backtest clears the bar, turn the
  public flag on in `/admin/ferry-info`, keep the "estimate — defer to the live
  board" labeling on every surface, and keep the accuracy snapshot running as a
  regression monitor (a drift alert should re-hide it, not a person noticing).

## 3. Auth v2

Rate limiting, admin password reset, and self-service account edits all shipped
([§0](#0-shipped-since-v1)). What remains:

- **P1 — public forgot-password via Resend magic links.** Today a locked-out
  user needs an admin to run a temp-password reset. A self-serve
  request-reset-link flow closes that gap. Resend is already the planned
  invite-email channel ([SYNDICATION.md §3](SYNDICATION.md)) — reuse it; wire it
  when the portal moves off localhost.
- **P1 — session revocation list.** Sessions are stateless HMAC cookies
  (`src/lib/auth.ts`); the only kill switch is rotating `AUTH_SECRET` (logs out
  everyone). A `revoked_sessions` table or a per-user session-version column
  enables single-account logout — cheap now that the DB seam exists.
- **P1 — CSRF hardening.** State-changing portal routes lean on `SameSite=Lax`
  alone; add an origin check or CSRF tokens on POSTs.
- **P2 — optional passkeys.** Nice for a non-technical business audience (no
  password to forget), but only after the reset-link + revocation exist.

## 4. Events v2

The events seed (`src/lib/data/events.ts`) is hand-curated against two live
calendars and its own header already names the ingest as the plan. No ingest
code exists yet — the only iCal the app emits is the *outbound*
`/api/feeds/events?format=ics`, not an inbound parser.

- **P1 — GrowthZone iCal ingest** from the Chamber's real calendar
  (business.kingstonchamber.com/events). Parse `VTIMEZONE` properly, expand
  `RRULE`s, dedupe on normalized title + start date, prefer the Chamber record.
- **P1 — The Events Calendar (Tribe) REST API on explorekingstonwa.com /
  portofkingston.org as a feed source.** Verified live
  (`/wp-json/tribe/events/v1/`) and Chamber-controlled — a machine-readable
  feed with zero new vendor relationships, a candidate to replace the seed.
- **P1 — recurring-event model.** The seed duplicates each occurrence as its own
  record (`public-market-2026-07-05`, `-07-12`, `-07-19`, …) — fine for a
  season, unmaintainable for a year. Store recurrence (RRULE or weekday+window),
  expand at read time, and make the deconfliction/dedupe logic operate on the
  expanded occurrences.

## 5. Syndication v2

From [SYNDICATION.md](SYNDICATION.md). Today `/portal/syndicate` is a
member-facing set of deep links and JSON/ICS feeds; there is **no write
adapter** to any platform yet.

- **P1 — Google Business Profile adapter first** ([SYNDICATION.md §2.1](SYNDICATION.md)),
  behind a feature flag, Chamber-as-Manager auth (one Chamber OAuth covers every
  listing). Hours via Business Information API v1 `PATCH`; posts via legacy v4
  `localPosts`. **Build the pending-edit read-back loop** (`hasPendingEdits`) —
  edits can sit in moderation, and silent failure would destroy the "update
  once, everywhere" promise. Gated on the Chamber's GBP verification (own
  verified profile, 60+ days old); batch each save into one patch (10
  edits/min/profile cap).
- **P1 — Meta pilot, ≤ a handful of tester businesses** ([SYNDICATION.md §2.2](SYNDICATION.md)).
  Add pilot businesses as Testers, post to Page/IG for 2–3 real venues, measure
  appetite before committing to the multi-week Advanced Access review. Build
  posting-failure alerts — long-lived Page tokens die on password change.
- **P2 — Apple Business + Bing Places applications.** Free and slow-to-approve;
  submit early, integrate later.
- **Never — Yelp.** No public write API at any tier; the biz.yelp.com deep link
  on `/portal/syndicate` is the permanent answer. Do not promise it to
  businesses.

## 6. Analytics v2

The store is now DB-backed ([§0](#0-shipped-since-v1)), and `summarize()`
already computes a **`byDay` time-series** (pageviews / outbound / sessions per
Pacific day) alongside totals. But the dashboard doesn't render it, the query
scans every row, and there is no bot filter or privacy floor.

- **P1 — dashboard time-series.** The data exists in `summarize()`'s `byDay`;
  `/admin` renders only totals, top paths, outbound links, and geo-area bars.
  Render daily/weekly trends per page and outbound target — "did the ferry-line
  QR campaign work" is a time-series question and the numbers are already there.
- **P1 — k-anonymity floor on area counts.** `summarize()` and the `/admin` geo
  bars publish a named-area geo-ping count of 1 directly. Never surface a
  named-area bucket with fewer than k (say 5) distinct sessions — small-town
  counts of 1 are re-identifiable, and the privacy posture is the feature.
- **P1 — bot filtering.** Counts include every crawler that executes JS and
  fires the beacon. Filter obvious bots (UA heuristics at ingest, honeypot
  paths) or the LTAC numbers overstate and can't be defended.
- **P1 — LTAC report export (CSV/PDF) aligned to JLARC categories.** One click
  produces the calendar-year summary in the six JLARC metric groups
  (Predicted/Actual/Method/Explain — see [DATA_SOURCES.md](DATA_SOURCES.md)) so
  the Chamber's submission to Kitsap County is copy-paste. The survey store
  already aggregates for LTAC (`/api/survey` GET, admin-only); fold analytics in
  and mirror the current-year portal form, not the 2018 PDF.
- **P2 — aggregate in SQL, not in memory.** `summarize()` still does
  `SELECT event FROM analytics_event` and reduces every row in Node on each
  admin load — correct, but it re-reads the whole table per call. Once volume
  or the reporting window grows, push the grouping into indexed SQL (on
  `ts`/`type`) and add a date filter.

## 7. Content v2

- **P1 — image pipeline for uploaded photos.** Portal/listing and hunt uploads
  land via Blob (`putImage()`) and are served raw through API routes with a bare
  `<img>` (`hunt-player.tsx` has an explicit `no-img-element` disable; there is
  no `images` config in `next.config.ts`). Add validate → resize to fixed
  variants → `next/image` for *uploaded* imagery (the brand hero already uses
  `next/image`; user photos don't). Unlocks businesses owning their imagery
  (OTA photos are copyrighted — [DATA_SOURCES.md](DATA_SOURCES.md)).
- **P1 — link-checker over ordering/menu/lodging URLs.** Weekly status + TLS
  check (it would have caught cellarcat.com), with a manual-review flag list for
  hosts that block bots (Toast, DoorDash 403; Skunk Bay 406) instead of
  auto-failing them.
- **P1 — audit log for portal edits.** Who changed what, when, old → new, on
  every overlay write. Add it at the `writeOverlayRecord` choke point
  (`json-store.ts`) — trivial now, painful to retrofit. The Chamber will want it
  the first time a listing is edited wrong.
- **P2 — menus as structured data with a restaurant-approval workflow.**
  Owner-approved transcribed menus with an update contact per venue — the only
  legal, accurate source (platform APIs are closed). Build the schema; gate the
  content on the Chamber's partnership workflow.
- **P2 — itinerary builder from live data.** Compose itineraries from what's
  actually open (the hours engine answers open-now) plus sailing times — "you
  have 90 minutes until your boat" is the magic Kingston use case. Rebuild the
  itinerary seeds as composable blocks first.

## 8. Quality engineering

There are still **zero tests** — `npm run lint` is the whole code-quality gate,
and the two `.github/workflows/` files (`ferry-observe.yml`,
`ferry-accuracy.yml`) are data-pipeline crons, **not** a build/test CI. This is
now the top engineering risk because the code it would protect is *live in
production*, not a prototype.

- **P0 — CI via GitHub Actions:** `tsc --noEmit` + `eslint` + tests +
  `next build` on every push. The build step alone catches the Next 16
  breaking-change class of error [AGENTS.md](../AGENTS.md) warns about — and the
  app now auto-deploys to Render on push, so a broken build ships without a gate.
- **P0 — hours-engine golden tests, including DST transitions.**
  `src/lib/hours.ts` + `src/lib/time.ts` drive the open-now badges (the most
  trusted pixel in the app): midnight-crossing spans, yesterday's tail, PDT/PST
  resolution. Fixed-clock golden cases incl. the March/November changeover
  nights.
- **P1 — ferry-forecast + observation tests.** `ferry-forecast.ts` is pure and
  deterministic — golden-case each tier, and test the empirical blend
  (below/above `MIN_SAMPLES`, weight ramp) so calibration changes can't silently
  break the score bands the go-live decision ([§2](#2-ferry-busyness-forecast--maturation-to-trust))
  depends on.
- **P1 — store-seam tests** (`json-store.ts`): overlay-wins-by-id, `_deleted`
  tombstone hiding, corrupt-record fallback to seed — and cover both backends
  (file and `overlay` table) since the seam is the whole persistence contract.
- **P1 — auth tests:** invite lifecycle (mint → redeem → reuse rejected),
  password verify, session token expiry/tamper, temp-password reset, and the
  **`canEdit` matrix** (role × linkedIds — the entire portal authorization model
  is that one function).
- **P1 — ICS output tests:** validate `/api/feeds/events?format=ics` and
  `/api/ferry/reminder` against an RFC 5545 parser; calendar subscribers are
  silent failers.
- **P1 — remove the orphaned legacy types.** `Atm` and `ParkingArea` remain in
  `src/lib/types.ts` after the ATM/cash removal and the parking move to
  `MapZone`; delete them so `tsc`/lint stop implying a dead feature exists.
- **P1 — error monitoring (Sentry free tier).** Adapters fail silent by design
  (`return null`) — great UX, invisible ops. Report the catch paths.
- **P1 — uptime check on `/api/ferry/status`** (UptimeRobot-class, free): the
  single endpoint whose failure most damages trust, and it can degrade to
  fallback without anyone noticing. Add one on `/api/health` too (it 503-gates
  the whole deploy).

## 9. Accessibility

- **P1 — full audit pass:** heading hierarchy per page, visible focus states on
  all interactive elements (including the bottom nav and More sheet), landmark
  roles, contrast against the brand palette.
- **P1 — keyboard/screen-reader alternative to the map.** `feature-map.tsx`
  labels its container `role="region"` + `aria-label` and marks decorations
  `aria-hidden`, but the map's *content* (parking zones, features) is reachable
  only by mouse/touch on Leaflet markers — there is no per-feature list a
  keyboard or screen-reader user can walk. `/parking` has rich prose but no
  programmatic list mirroring the CMS view's features. Build that contract:
  render every mapped feature as list content beside the map, and add a test
  that every feature in a view appears in the list.
- **P1 — color-only meaning on the map needs text labels.** Parking rules are
  color-coded by type (free-2hr / prohibited / ferry-holding…), auto-assigned in
  the CMS; colorblind users need the rule as text in the popup/legend pairing,
  not hue alone.
- **P1 — alt-text pass** over brand photography and webcam images (webcams
  should convey location + snapshot age; the hero currently ships `alt=""` as
  decorative, which is correct — audit the rest).

## 10. Data-layer follow-ons

The migration is done; the operational disciplines around it are not.

- **P1 — run the restore drill for real.** Render's daily disk snapshots
  (7-day) and the off-site `/api/admin/backup` bundle both exist; restore via
  `scripts/restore-backup.mjs` has not been exercised end-to-end. Do it once and
  document the runbook in [OPERATIONS.md](OPERATIONS.md).
- **P1 — decide the Neon vs. disk story deliberately.** Phase 1 runs
  filesystem-mode on Render's `/data`; Phase 2 (Neon/Blob/Upstash on Vercel)
  works but is unused. Pick the long-term home before the custom domain launch
  ([DEPLOY.md](DEPLOY.md)), so backups and the audit log ([§7](#7-content-v2))
  target the right backend.

## 11. If rebuilding from scratch

What this codebase proved out — and what to do differently on day one of any
rewrite. The seam and CMS are now keepers; the file-only start and the missing
tests/PWA are the "change" list.

**Keep (proven):**

- **The persistence seam.** Every store branches on env presence and nothing
  above it changes — the same modules run file-on-disk locally and
  Neon/Blob/Upstash on serverless. This is why the production migration was a
  swap of internals, not a rewrite. Start any v2 with this seam.
- **Seed + overlay editability, now with a CMS on top.** Typed git-reviewable
  seed files, portal edits overlaid by id with tombstones, plus the content/map
  CMS for non-developers — content *and* live editing without abandoning the
  git-reviewable seeds. Keep both layers.
- **Adapter isolation with honest degradation.** UI never fetches external
  services; every adapter returns `{ live }` and the UI labels non-live data.
  This is why WSDOT flakiness never breaks the site — and why the ferry forecast
  can ship dark behind a flag.
- **Pure, client-safe engines.** `ferry-forecast.ts` and `hours.ts` are pure
  and deterministic, so SSR and client agree and the planner recomputes
  instantly in the browser. Keep model logic free of fetch/env/server imports.
- **Token-only theming.** Brand palette/fonts as design tokens matching
  explorekingstonwa.com — restyles never touch component code.
- **Honesty labels** ("not live", "call first", "signs on the pole win",
  "estimate — defer to the live board") — trust is the product in a town this
  size.
- **The verified-data workflow.** [DATA_SOURCES.md](DATA_SOURCES.md)'s
  verify-then-publish discipline with `lastVerified` dates and load-bearing
  gotchas is worth more than any integration; keep maintaining it.

**Change from day one:**

- **Start on the DB seam, not files.** The file stores were the right
  local-first call, but every one became a migration; a rebuild starts with the
  same store-interface seam already dual-backed.
- **Start with tests + CI.** The hours engine, the forecast model, and the store
  seam should never have existed untested ([§8](#8-quality-engineering)) — and
  now they're live.
- **PWA from the start.** Offline-on-the-boat is the defining mobile feature
  ([§1](#1-mobile-first--pwa-hardening)); service-worker architecture is much
  cheaper before the routes ossify.
- **Image pipeline from the start** — every *uploaded* photo through
  upload/resize/`next/image` from the first commit ([§7](#7-content-v2)); the
  hero got there, user photos didn't.
- **i18n-ready strings if Spanish support is desired.** Extract user-facing
  strings behind an i18n layer on day one — the copy registry
  (`site-copy-registry.ts`) is a natural home. Retrofitting ~40 pages of prose
  is the expensive path; string extraction can't wait, *deciding whether* to
  translate can.
