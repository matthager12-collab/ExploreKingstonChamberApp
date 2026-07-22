# Explore Kingston — Architecture

**Version 3.0 · July 2026.** Structure, boundaries, and the reasoning behind
them. Code-level design is in [SDD.md](SDD.md); requirements in
[REQUIREMENTS.md](REQUIREMENTS.md); the step-by-step deploy in [DEPLOY.md](DEPLOY.md);
runbook in [OPERATIONS.md](OPERATIONS.md); data provenance in
[DATA_SOURCES.md](DATA_SOURCES.md).

Explore Kingston is the companion app to explorekingstonwa.com — a single
Next.js 16 deployable that surfaces ferry, dining, lodging, events, parking,
give-back, and scavenger-hunt content for visitors to Kingston, WA, plus
invite-only portals for businesses / nonprofits and an admin CMS for the
Chamber. The headline architectural fact in this version is the **Postgres
substrate (E05)**: all structured data lives in Neon Postgres (`record` +
append tables), every write goes through one audited, zod-validated choke
point (`src/lib/db/records.ts`), and `DATABASE_URL` is required at runtime —
`/api/health` 503s without it. The `DATA_DIR` disk remains only for images and
hunt photos (until E15); nothing above the store layer knows any of this.

---

## 1. System context

```
                     ┌──────────────────────────────────────────────┐
 Visitors (phones) ─▶│                                              │─▶ WSDOT WSF API (live boats, drive-up
 Business owners   ─▶│      Explore Kingston (Next.js 16.2.10)      │     space, wait notes, boarding-pass hours)
 Nonprofits        ─▶│      output:"standalone" · one image         │─▶ Kitsap Transit (fast-ferry, GTFS-derived)
 Chamber admin     ─▶│                                              │─▶ NWS api.weather.gov (keyless)
                     │  pages · portals · admin CMS · API routes    │─▶ NOAA CO-OPS tides 9445639 (keyless)
 Their websites    ◀─│  feeds · embed widget · JSON-LD              │─▶ OSM tiles + Overpass (map render/gen)
 Calendar apps     ◀─│                                              │─▶ Google Maps deep links + Street View embed
 Search engines    ◀─└───────────┬──────────────────┬───────────────┘
                                 │                  │
              ┌──────────────────┘                  └────────────────────┐
              ▼ NEON POSTGRES (required, E05)        DATA_DIR disk (/data on Render) ▼
     record + audit + quarantine tables          images only: hunt photos + map
       analytics_event · survey_response ·        images (until E15), plus the
       ferry_observation (append logs)            health disk-probe + backup walk
       (schema.ts → db/migrations, applied      (Vercel Blob / Upstash Redis are
        at boot; writes via records.ts)          the serverless-only image/rate seams)

  Host: Render Blueprint (Docker, Starter web + 1GB disk) — https://explore-kingston.onrender.com
  Future outbound (SYNDICATION.md): Google Business Profile, Meta, Apple Business — adapters behind the same seam.
```

The app is **one deployable unit**: pages, portals, admin CMS, API routes, and
feeds in a single `output: "standalone"` Next.js image. What the system *owns*
lives in the repo (typed seed data) plus exactly one mutable substrate — and
since E05 that substrate is **Neon Postgres**: the `record` table + append logs
hold every piece of structured data, with schema DDL generated from
`src/lib/db/schema.ts` into `db/migrations/` and applied at boot. The seeds in
git remain the merge baseline. The old "no `DATABASE_URL` = filesystem mode"
dual-backend seam is gone: the DB is a hard runtime dependency, and the mounted
`DATA_DIR` disk keeps only images/hunt photos (until E15). No queue or auth
SaaS is required.

---

## 2. Principles (the load-bearing ones)

1. **Adapters isolate every external source.** UI never fetches an external
   service; it calls `src/lib/*` functions returning domain types. Swapping a
   source touches one file. Every adapter returns a degraded-but-honest result
   on failure (`{live:false}`, `[]`, a bundled fallback schedule) — an upstream
   outage must never blank a page. Adapters: `wsf.ts` (WSDOT), `kitsap.ts`
   (fast ferry), `weather.ts` (NWS), `tides.ts` (NOAA), with `time.ts`/`hours.ts`
   as the Pacific-time engine underneath.

2. **Seed + overlay.** Checked-in typed seed files in `src/lib/data/*.ts` define
   baseline content; runtime edits are stored as overlays that win by id, with
   `{_deleted:true}` tombstones hiding seed rows. `readMerged(name, seed)` in
   `src/lib/stores/json-store.ts` does the merge — since E05 as a thin delegate
   over `src/lib/db/records.ts`, with overlay rows living in the Neon `record`
   table — and nothing above the store notices. Result: git-reviewable defaults,
   portal/admin editability without deploys, trivially resettable state.

3. **Tokens are the only theming channel.** Twelve semantic color tokens + four
   font variables (`globals.css` `@theme`); pages/components never use raw hex
   (map canvas colors excepted — they aren't part of the page theme, e.g.
   `PARKING_TYPES` / `MARKER_CATEGORIES` in `src/lib/map/types.ts`). The Explore
   Kingston rebrand was a pure token remap; the next one should be too.

4. **Pacific-anchored time.** All wall-clock logic (hours badges, schedule
   fallbacks, date grouping, the boarding-pass day-stamp, the forecast's
   weekday/season buckets) goes through Intl-based helpers in `src/lib/time.ts`
   / `hours.ts` so the server's timezone never matters. Anything time-of-day
   sensitive that must be *fresh* is computed client-side (open-now badges,
   the forecast planner) rather than baked into cached HTML.

5. **Honesty is architectural.** Confidence/verification metadata travels *with*
   data (types carry `confidence`, `hoursVerified`, `live`, `sourceNote`) so UIs
   can't accidentally present stale or derived data as fact. The whole ferry
   **busyness forecast** is labeled an *estimate* at every surface and defers to
   the live board; it ships **dark by default** (admin on/off flag) precisely so
   an unvalidated model never masquerades as measurement.

6. **No third party until forced — and the DB is now the required substrate
   (E05).** Auth, analytics, feeds, ICS, embeds are self-implemented. The store
   seam was *always designed* to accept a database; since E05 Neon Postgres is
   no longer an optional backend but **the** home for structured data —
   `DATABASE_URL` must be set on every deploy, and there is no filesystem
   fallback. Blob/Upstash remain env-selected serverless seams. External SaaS
   still enters only with a verified free tier and a documented reason (see
   the decision log).

---

## 3. Layers and their contracts

```
routes (src/app/**)             pages: RSC by default; revalidate=60 for store-backed
                                content; force-dynamic for portals/admin/hunts
   │        │
   │        └── API routes (src/app/api/**, 40): auth, portal writes, feeds,
   │            ferry status/plan/observe/accuracy/reminder, map, hunts, survey,
   │            track, admin CMS, health — thin, validating, store/adapter-calling
   ▼
client islands (src/components/**)   only where interactivity demands it:
                                     tracker, open-badge, near-me, town-map,
                                     hunt-player, ferry board + forecast planner,
                                     side switcher, webcam-grid, survey, nav,
                                     portal + admin editors, EditableText
   ▼
domain layer (src/lib/)
   types.ts        one domain model for content; map/types.ts for the map CMS
   stores/*        seed+overlay + append persistence (see §4)
   adapters        wsf, kitsap, weather, tides (+ time/hours engines)
   engines         ferry-status, ferry-forecast, ferry-line, ferry-reminder,
                   side/side-server, page-visibility, copy-context, map/resolve
   auth/           users, orgs, invites, sessions, can() over 5 roles (E06)
   ▼
persistence substrate   db/records.ts (audited zod write choke) | data-dir.ts | blob-store.ts | rate-limit.ts
   ├─ POSTGRES (required)  Neon: record + audit + quarantine + append tables
   │                       (schema.ts → db/migrations, applied at boot) · seeds in git = merge baseline
   └─ DISK (DATA_DIR)      images/hunt photos only, until E15 (Blob on Vercel) · Upstash = serverless rate limit
   generated       public/geo/street-parking.json (scripts/gen-street-parking.py)
```

**Rendering strategy per class of route** (verified against `export const`
declarations in `src/app/**/page.tsx`):

| Class | Strategy | Routes (examples) |
|-------|----------|-------------------|
| Store-backed content | `revalidate = 60` (ISR) | `/`, `/eat`, `/events`, `/give`, `/parking`, `/stay`, `/webcams`, `/about`, `/itineraries`, `/ferry`, `/ferry/plan`, `/map` |
| Auth-dependent / always-fresh | `force-dynamic` | all `/portal/*`, all `/admin/*`, `/hunt`, `/hunt/[slug]`, `/itineraries/[slug]` |
| Route handlers | uncached by default | auth, portal writes, ferry, hunts, track, admin, map |
| Feeds | cached + CORS-open | `/api/feeds/events` (JSON + `?format=ics`), `/api/feeds/business/[id]` (`s-maxage`, `Access-Control-Allow-Origin: *`) |

Note `/itineraries/[slug]` is `force-dynamic` (not ISR) — the list page
`/itineraries` is ISR-60 but the detail renders dynamically.

---

## 4. Data architecture

### 4.1 Domain model
Single content model in `src/lib/types.ts`: `Sailing`, `TerminalStatus`,
`Webcam`, `DayHours`/`WeeklyHours`, `Restaurant` (structured `weeklyHours`,
`hoursVerified`, `hidden?`), `EventItem` (`ownerId`, `charityId`), `Itinerary`/
`ItineraryStop`, `Charity`, `VolunteerNeed`, `Hunt`/`HuntStop`, `Lodging`,
`SurveyResponse`, plus enums (`FerryRoute`, `Direction`, `EventCategory`). The
**map CMS** has its own model in `src/lib/map/types.ts`: `MapView`, `MapFeature`,
`FeatureKind`, `BuiltInSource`, `ParkingMeta`. Parking zones are `MapZone`
(`src/lib/data/parking.ts`), edited via the polygon editor.

> **Legacy note (honesty):** `Atm` and `ParkingArea` still exist as interfaces
> in `types.ts` but are **orphaned/unused** — `src/lib/data/atms.ts` was deleted
> and the cash/ATM map is gone. Do not present an ATM feature as live. Cash
> guidance now lives as a structured ferry-info record (`cash-tips`: "no ATM at
> the dock; nearest cash machines up in downtown Kingston"). The dead types are
> tracked in the debt list (§9).

### 4.2 Store inventory (`src/lib/stores/`)
All are seed+overlay via `json-store.ts` unless marked append.

| Store | Backs | Notes |
|-------|-------|-------|
| `business-store` | restaurants | `deleteRestaurant` tombstones / `hidden` |
| `event-store` | events | `ownerId`/`charityId` cross-refs |
| `charity-store` | charities + volunteer needs | |
| `parking-store` | parking zones (`MapZone`) | polygon geometry |
| `map-store` | map views + features + images | image bytes via blob-store seam |
| `itinerary-store` | itineraries | |
| listing stores | lodging + webcams | |
| `site-store` | `site-copy` overrides + `site-pages` visibility | content CMS backing |
| `ferry-info-store` | 4 structured records: `payment` / `boarding-pass` / `cash-tips` / `sources` | field-by-field edits |
| `ferry-prediction-store` | one `settings` record | admin on/off flag, **default OFF** (absence = off) |
| `boarding-pass-store` | one `override` record | admin daily SR-104 verdict, lapses at Pacific midnight |
| `ferry-observations` | **append** (`ferry_observation` table) | sailing-space snapshots for the forecast |
| `analytics-store` | **append** (`analytics_event` table) | 3 event types |
| `survey-store` | **append** (`survey_response` table) | LTAC/JLARC responses |
| `auth` (`src/lib/auth/` + `db/auth-store.ts`) | users + orgs + invites | **not** the `record` table — dedicated `users` / `orgs` / `invites` tables since E06 |

### 4.3 The Postgres substrate (the headline fact — E05)
Structured data no longer branches on env: it lives in Neon Postgres,
**every write goes through the audited zod choke point**
`src/lib/db/records.ts` (`readRecords` / `readMergedRecords` / `writeRecord`),
and `DATABASE_URL` is required — `/api/health` reports `db:false` and 503s
without it, so a release without `DATABASE_URL` never serves traffic. Since
E15 removed the disk that IS a safe abort: the previous release keeps serving.
(Before E15 it was not — a disk can be held by only one
instance can hold it, so Render stops the old instance *before* starting the
new one. A release that never goes healthy therefore leaves the site down (502)
until a good release lands — the previous release is already gone and does not
resume. See [RUNBOOK-CUTOVER.md](RUNBOOK-CUTOVER.md) § "Migrations under
auto-deploy". The env-detected seams that remain cover only images and rate
limiting:

| Seam file | Detector | Disk host (Render) | Serverless (Vercel) |
|-----------|----------|--------------------|---------------------|
| `data-dir.ts` | `DATA_DIR` set → that path, else `.data/` | images/hunt photos under the volume (until E15), plus the health disk-probe + backup walk | (DATA_DIR unset on Vercel) |
| `blob-store.ts` | `hasBlob()` = `BLOB_READ_WRITE_TOKEN` set | image bytes under DATA_DIR, served by app image routes | Vercel Blob public CDN URL |
| `rate-limit.ts` | `hasUpstash()` = `UPSTASH_REDIS_REST_URL` set | in-process `Map` sliding window (correct for one instance) | Upstash Redis shared sliding window (correct across lambdas) |

The schema's source of truth is `src/lib/db/schema.ts` (Drizzle); DDL is
generated into checked-in `db/migrations/` and applied at boot
(`src/instrumentation.ts`) or via `npm run db:migrate`. The tables:

- `record(store, id, doc jsonb, deleted, status, source, external_id,
  owner_org_id, created/updated…)` — the generic table backing **every**
  seed+overlay collection. Auth is **not** in this table: since E06 users, orgs
  and invites have their own first-class tables (§5).
  `readRecords()` reconstructs the old file-shaped contract (re-attaches
  `_deleted` from the `deleted` column) so `readMerged()` behaves identically.
- `audit` — append-only trail of every record write (a DB trigger rejects
  UPDATE/DELETE); `quarantine` — importer rejects, kept whole with zod issues.
- `analytics_event(ts, event jsonb)`, `survey_response(ts, response jsonb)`,
  `ferry_observation(ts, obs jsonb)` — append logs (no audit rows).

The legacy `src/lib/db.ts` (`hasDb()` / lazily self-created `overlay` table) is
deleted; the seeds in `src/lib/data/*.ts` remain the merge baseline.

`putImage()` returns a *string* that is either a full https blob URL (prod) or a
relative path the app's image routes serve (dev); it's stored on the record and
handed to `<img src>` either way, so callers never branch.

**Why this shape:** one record table + one audit trail + three append logs is
the minimum surface that gives every structured write validation and
provenance. It is the "clean DB seam" the v1/v2 file design promised, hardened
into the only path — without touching a single page or component.

### 4.4 Generated artifacts
`public/geo/street-parking.json` is produced by `scripts/gen-street-parking.py`
(OSM Overpass + Census CDP inputs; re-run on rule changes) and fetched at
runtime by the client map when a view includes the `streets` built-in source —
so street geometry never bloats the JS bundle and there is zero runtime Overpass
dependency.

### 4.5 Identity
Every record's id is a human-readable slug; overlays and cross-references
(events↔owners, needs↔charities, orgs↔`org.linked_ids`, features↔views) join on
it. The `record` table's `(store, id)` primary key mirrors the old file model
exactly.

---

## 5. Auth architecture

Invite-only, five roles (`admin`, `moderator`, `org-editor`, `member-business`,
`viewer`) over an **org** entity, **no visitor accounts**. scrypt password
hashes; stateless HMAC-signed session cookies
(`vk-session`, 30 days, signed with `AUTH_SECRET`); a first-run bootstrap page
(`/portal/setup` → `/api/auth/setup`) that self-destructs once any user exists;
`src/proxy.ts` (the Next 16 file convention — **not** `middleware.ts`) turns
unauthenticated requests away at the request boundary, and
`src/app/admin/layout.tsx` gates all of `/admin` behind role `admin` — there is
**no pre-setup grace** (E06 removed it): `/admin` always redirects to `/portal`,
even on a fresh install with zero users, so it is never world-readable.
Bootstrap runs through `/portal` → `/portal/setup` instead. Every write handler
re-validates the session + `can(user, action, resource)` — defense in depth,
never trusting the UI.

Storage lives in Postgres with everything else: since E06, users, orgs and
invites have their own first-class tables (`users` / `orgs` / `invites` — see
`src/lib/db/auth-schema.ts` and `src/lib/db/auth-store.ts`), invites keyed by
their code. `linked_ids` lives on the **org**, not the user, so permission
follows the organization rather than the account. Both the E05-era
`auth-users` / `auth-invites` `record` stores and the older
`DATA_DIR/auth/*.json` files are gone. The former v1
limits are **now addressed**: login / setup / redeem are rate-limited
(`rate-limit.ts`, per-IP + per-account buckets), `/portal/account` gives
self-service name/email/password changes (`/api/auth/account`, `/api/auth/password`),
and admins can reset an account's password to a shown-once temporary value.

---

## 6. Analytics architecture

First-party only, append-only, no cookies, no third parties. `AnalyticsEvent`
has **four types**: `pageview`, `outbound`, `geo-ping` (opt-in), and `consent`
(E11 — records the privacy-notice version granted, nothing else). Survey
responses are a **separate** store (`survey_response`), not an analytics type.
Ingest is via `navigator.sendBeacon` → `POST /api/track` (text/plain, parsed
manually; always answers `{ok:true}` so telemetry never breaks a session).
Privacy invariants are enforced **server-side in the route regardless of client
input**: the IP is inspected once only to label dev-vs-unknown (or for the
in-memory GeoLite2 lookup) and is never stored; geo-ping coordinates are
bounds-checked to a Kitsap box (else dropped), rounded, classified into a named
area bucket, and then **discarded — only the area bucket is stored, never a
coordinate** (E11); outbound taps to food/health-assistance destinations are
never persisted at all (`SENSITIVE_DESTINATIONS`, `src/lib/privacy/policy.ts`). Coarse
country/region/city geography is derived from platform headers. `/admin`
insights are aggregate-only; the area classifier (first-match bounding boxes) is
data the Chamber can refine. Zip codes come **only** from the anonymous survey —
IP geolocation can't produce them reliably.

---

## 7. Ferry-forecast subsystem architecture

The busyness forecast is a distinct subsystem, deliberately split into a **pure
client model** plus a **server-side learning loop**:

- **`ferry-forecast.ts` — pure, client-safe** (no fetch, no env, no server-only
  imports). A deterministic model of the Edmonds–Kingston route's documented
  rhythms (directional commute peaks, weekend leisure surges, summer season,
  worst holidays), **calibrated (July 2026) against WSF's own "Best Times to
  Travel" grid** for Summer 2026. Five levels: `light`/`moderate`/`busy`/
  `very-busy`/`extreme`. It is pure so the `/ferry/plan` planner can recompute
  instantly in the browser as the visitor drags time or flips direction, and so
  SSR and hydration agree.
- **`ferry-observations` (append store) — the learning loop.** WSF exposes live
  drive-up space + per-direction delay but never archives them, so the app
  snapshots them (throttled ~10 min) from the same feed the ferry pages already
  fetch and aggregates them into an **empirical table** the forecast blends in,
  weighted by sample count (`EMP_MIN_SAMPLES`, ramps to `EMP_MAX_WEIGHT` capped
  below 1 so the researched prior always keeps a voice). Estimates start
  heuristic and grow data-driven over time.
- **Endpoints:** `/api/ferry/plan` (planner data), `/api/ferry/observe` (logs a
  snapshot), `/api/ferry/accuracy` (backtests the forecast against the log).
- **Gating:** `ferry-prediction-store` is an admin on/off flag defaulting to OFF
  — the planner, the "How busy today" panel on `/ferry`, and the home callout
  are visible to admins for validation but ship dark to the public.

Adjacent ferry engines: **`ferry-line.ts`** routes drivers to the SR-104 staging
point via a forced turnaround waypoint (Barber Cutoff ≤2 hr wait, Miller Bay
when the line tops 2 hr) so Google can't send them into a mid-highway U-turn;
**`boarding-pass-store`** holds the admin daily override of the SR-104 pass
verdict (`getBoardingPassStatus()` in `wsf.ts` is the season/hours estimate;
the override lapses at Pacific midnight by day-stamp comparison, no timer);
**`ferry-reminder.ts`** builds an injection-safe RFC-5545 `.ics` with a VALARM
for `/api/ferry/reminder`; **`ferry-status.ts`** assembles one
`FerryStatusSnapshot` shared by `/api/ferry/status` and the SSR pages so the home
widget hydrates from the shape it later polls.

---

## 8. Content CMS & Map CMS architecture

**Content CMS (`/admin/content`)** — two independent registry-driven mechanisms
over the `site-store`:

- *Editable copy.* `src/lib/site-copy-registry.ts` is a pure data array of
  **91 `CopyBlock`s** (key, page group, label, fallback, optional `rich`/
  `multiline`), each naming one headline string hardcoded in a page. Server
  components resolve `copyText(overrides, key, fallback)` directly from
  `site-store`; **client components** get the same overrides through
  `copy-context.tsx` (`CopyProvider` loaded once in the root layout, then
  `useCopy()` / `<EditableText/>`). An untouched block costs nothing and always
  tracks the code fallback; overrides live in the `site-copy` overlay.
- *Page visibility.* `page-visibility.tsx` holds the single source of truth for
  hideable paths (`HIDEABLE_PAGES`). Public pages call
  `await assertPageVisible("/hunt")` at the top of their server component:
  hidden + visitor → `notFound()` (clean 404); hidden + admin → renders with a
  `<HiddenPageBanner/>` so the Chamber can prep content before launch.
  Home, portal, admin, and api routes are deliberately not hideable. Backed by
  the `site-pages` overlay.

**Map CMS (`/admin/maps` builder, `/admin/map` parking polygon editor)** — a
general-purpose map system on `map-store` + `src/lib/map/`:

- A **`MapView`** is a named, reusable config (center, zoom, `published` flag,
  and a set of **built-in `sources`**: `restaurants` / `parking-zones` /
  `streets`). A **`MapFeature`** is a drawn marker/line/trail/area declaring
  which views it appears on, with an optional `ParkingMeta` (type-driven color).
- **`map/resolve.ts`** (server-only) turns a view id into a `ResolvedMapView`:
  its config, its custom features, and lightweight payloads for the built-in
  layers (restaurants mapped to marker categories, parking zones, and a boolean
  flag for streets — the client fetches the static street JSON itself). Public
  output is served at `/map` via `/api/map/[viewId]`; images via `/api/map/image`
  (filesystem) or the blob URL (cloud).
- Admin editing uses `@geoman-io/leaflet-geoman-free` for polygon/feature
  drawing; feature images ride the `blob-store` seam (`saveFeatureImage`).

---

## 9. Decision log (ADR summary)

| # | Decision | Why | Rejected alternatives |
|---|----------|-----|----------------------|
| 1 | Next.js 16 App Router + TS, single app | One deployable, RSC fits read-heavy site, free/cheap hosting path | Separate SPA+API; WordPress plugin on the existing site |
| 2 | Seed+overlay stores with a **dual backend** (file OR Neon overlay table), auto-detected by env | $0 baseline, git-reviewable content, and a real DB path for serverless — same store code both ways | Postgres-only from day 1 (adds ops before value); CMS SaaS |
| 3 | Hand-rolled invite auth (scrypt + HMAC cookie), storage on the same seam | No third-party dependency/cost; tiny trusted user set; full control | NextAuth (heavier, still needs a DB/adapter); Clerk/Auth0 ($, external) |
| 4 | Google Maps *deep links* everywhere; Leaflet+OSM only where we render; Street View via build-time embed key | $0 at any scale; no key management for links; native app handoff on phones | Google Maps JS embeds (billable SKUs, ToS caching limits) |
| 5 | WSDOT native REST over GTFS/GTFS-RT | Instant free key, richer data (drive-up space, wait notes, boarding-pass hours), no protobuf | OneBusAway GTFS-RT (key wait, less data) |
| 6 | Structured `WeeklyHours` + client-computed open-now badges | Static/ISR pages can never show stale open/closed state; DST-safe via Intl | Server-computed badges (stale in cache); Google Places hours (billing + caching ToS) |
| 7 | Two-source verification with dated stamps + visible disputes for operational facts | Wrong hours/parking data does real-world harm; trust is the product | Trust-the-first-source; scraping aggregators |
| 8 | Hunt photos upload with GPS verify; image bytes on the blob seam | Owner requirement: auto check-off "when a pic is posted at that spot" | On-device only (no admin visibility); image-content ML matching (cost — roadmap) |
| 9 | Analytics: first-party append log + opt-in coarse GPS; survey separate | LTAC needs aggregates, not surveillance; zero third-party leakage | GA4 (ad-tech baggage, consent complexity); paid analytics |
| 10 | Rebrand via token remap only | One-file restyle; provable contrast decisions; repeatable | Per-page restyling (drift, unreviewable) |
| 11 | Street geometry baked to static JSON by script | Runtime has zero Overpass dependency; regeneration is explicit and rare | Live Overpass queries (rate limits, latency, fragility) |
| 12 | Feeds: hand-rolled ICS + JSON + vanilla embed script, CORS-open | RFC-simple, no deps, works in Google/Apple Calendar | ical libraries (a dep for ~40 lines); iframe embeds (styling/clickjack) |
| 13 | geoman for admin polygon/feature editing | Only mature free Leaflet editing plugin; admin-only bundle cost | Hand-rolled vertex math (days of work); Google My Maps (data leaves the system) |
| 14 | Docker `output:"standalone"` + Render Blueprint as the **Phase-1 live home** | One reproducible image, persistent disk keeps file mode working, ~$7.25/mo, auto-deploy | Vercel-first (no persistent disk forces the DB before it's needed); raw VPS (more ops) |
| 15 | **Upstash Redis** as the shared rate-limit backend for serverless; in-process Map otherwise | Serverless lambdas can't share an in-memory counter; single-instance disk host can | Rate-limit only in memory (wrong across replicas); a bespoke DB counter table |
| 16 | Ferry forecast as a **pure client model** + server empirical loop, shipped dark behind an admin flag | Instant browser recompute, SSR/hydration parity, and an unvalidated model never fronts as fact | Server-only forecast (round-trip per interaction); trusting the heuristic live from day 1 |
| 17 | Side-of-water framing via a `vk-side` **cookie** + a geo divide at -122.44 lng | Reframe for Kingston-side vs Edmonds-side visitors, ask location once (opt-out), no account needed | Two separate sites; a required account/profile; re-detecting on every request |
| 18 | Content CMS as a **registry pattern** (pure `COPY_BLOCKS` array + fallbacks in code) | Untouched copy always tracks the code; overrides are diffable rows; client + server share one registry | A full headless CMS (SaaS, overkill); editing strings straight in components (unreviewable, no admin UI) |
| 19 | Removed the cash/ATM map; **structured ferry-info** records instead | ATM data was low-value and rots; cash guidance belongs with ferry payment facts, editable field-by-field | Keeping a live ATM map (stale, unmaintained); free-text cash prose (unstructured) |
| 20 | Syndication = feeds + checklists now, APIs later in verified order (Google→Meta→Apple; never Yelp) | Every claim to businesses must be deliverable; API gates verified against primary docs | Promising auto-sync before access approvals exist |

---

## 10. Deployment topology

**Two phases; DEPLOY.md is the step-by-step.** Neon Postgres is common to both
(E05); the remaining image/rate-limit seams (§4.3) are the entire difference
between them.

| | Phase 1 — **LIVE** | Phase 2 — supported alternative |
|--|--------------------|---------------------------------|
| Host | **Render** Blueprint (`render.yaml`), Docker `output:"standalone"`, Starter web + 1GB disk at `/data` (~$7.25/mo) | Vercel serverless (no persistent disk) |
| URL | https://explore-kingston.onrender.com | (not the running home) |
| Mode | **Postgres + disk (E05)** — `DATABASE_URL` (Neon) for structured data, `DATA_DIR=/data` for images/photos | **Cloud** — Neon + Blob + Upstash; `DATA_DIR` unset |
| Rate limit | in-process Map (one instance — correct) | Upstash Redis (shared) |
| Images | under `/data`, served by app routes | Vercel Blob CDN URLs |
| Health | `/api/health` → `{ok, db, storage, time}`; **503 until Postgres answers** (E15 — it no longer touches the filesystem, which is what allowed the disk to be removed). `storage` is reported but never gates. With no disk the instances overlap, so a release that never goes healthy is **held back** and deploys are zero-downtime — see [RUNBOOK-CUTOVER.md](RUNBOOK-CUTOVER.md) | `/api/health` (same DB gate) |
| Secrets | `AUTH_SECRET` (Render-generated, stable), `SETUP_TOKEN` (Render-generated, first-run bootstrap only), `WSDOT_API_KEY`, `NEXT_PUBLIC_SITE_URL` (**build-time**, baked into the client bundle), `DATABASE_URL` (Neon pooled url — E05) set in dashboard | + `BLOB_READ_WRITE_TOKEN`, `UPSTASH_REDIS_REST_URL/TOKEN` |

Environment variables (authoritative — `.env.production.example`, `render.yaml`,
`fly.toml`):

| Var | Required? | Effect |
|-----|-----------|--------|
| `AUTH_SECRET` | **yes** | signs HMAC session cookies (`src/lib/auth/session.ts`) |
| `WSDOT_API_KEY` | optional | live ferry data; absent → bundled fallback schedule |
| `NEXT_PUBLIC_SITE_URL` | **required in production**, **build-time** | absolute origin for share-card/canonical URLs (`layout.tsx` `metadataBase`); inlined at `npm run build`, not read at runtime |
| `SETUP_TOKEN` | optional (first-run bootstrap only) | gates `POST /api/auth/setup` fail-closed; never consulted once an admin exists |
| `DATA_DIR` | disk hosts | persistent volume path (e.g. `/data`) — images/hunt photos only since E05; **unset on Vercel** |
| `DATABASE_URL` | **yes (E05)** | Neon Postgres (POOLED url, host has `-pooler`, `?sslmode=verify-full` — docs/DEPLOY.md §2e) — the structured-data home; `/api/health` 503s without it |
| `BLOB_READ_WRITE_TOKEN` | Phase 2 | Vercel Blob for uploaded images |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Phase 2 | shared rate limiter |

**Live-on-Render facts (confirmed):** admin account created + persisted; WSDOT
key set → ferry LIVE; auto-deploy on push ON; repo made **public** to bypass a
Render↔GitHub sync issue (no secrets in git — all `sync:false`). The DB
migration is done (commit `c74ebb0`), so Phase 2 is a real option, but Render is
the running home. Alternative host config `fly.toml` ships for Fly.io (Seattle
region, `fly volumes create data`). The custom domain
`app.explorekingstonwa.com` (one CNAME → `explore-kingston.onrender.com`,
added in the zone editor on the Chamber's WordPress VPS — the registrar,
NameCheap, is not authoritative; **never** a nameserver move, since that VPS
also serves the domain's DNS and mail) is **deferred until launch**.

**Backups:** (1) Render daily disk snapshots (7-day restore); (2) off-site
admin-gated `/api/admin/backup` — a JSON bundle of the whole `DATA_DIR`
("⤓ Download backup" on `/admin`), restored via `scripts/restore-backup.mjs`;
`scripts/backup-data.sh` (tar) is the local equivalent. Full runbook:
[OPERATIONS.md](OPERATIONS.md).

Migration path (rebuilt by E05): schema DDL is generated from
`src/lib/db/schema.ts` into `db/migrations/` (`npm run db:generate`) and
applied at boot (`src/instrumentation.ts`) or via `npm run db:migrate`; the
one-time data move is **`npm run import:data-dir`** (`scripts/import-data-dir.ts`),
which reads a restored backup bundle or `DATA_DIR` tree read-only, dry-runs by
default (`--apply --yes` to write), validates records against the store
schemas, and parks failures in the `quarantine` table instead of `record`. The
legacy data-move script and `db.ts` / `ensureSchema()` are gone.

---

## 11. Known debt & risks (honest list)

- **No automated tests.** (SDD §12 defines the priority suite; ROADMAP-V2 P0.)
- **Orphaned legacy types.** `Atm` and `ParkingArea` remain in `types.ts` with no
  users after the ATM/cash map was removed and `atms.ts` deleted — dead code to
  prune; a doc reader must not mistake them for live features.
- **Record writes are last-write-wins.** Concurrent admin edits can last-write-win
  at the record level (fine for a one-admin Chamber) — the `record` upsert
  (`ON CONFLICT DO UPDATE`) does no field-level merge; a property of the design
  carried over from the file era.
- **In-process rate limiting is per-instance.** Correct on the single-instance
  Render host; it would NOT limit across replicas or lambdas — which is exactly
  why the Upstash backend exists for the serverless path.
- **The ferry forecast is an estimate, not a measurement.** Calibrated to a
  Summer-2026 WSF grid and still light on empirical samples; it can't see a
  substitute small vessel. It ships dark behind the admin flag for this reason;
  don't trust it in front of visitors until the accuracy backtest earns it.
- **Migrations run at boot** (`src/instrumentation.ts`) — a release with a bad
  or missing migration fails its health check and, because the persistent disk
  forces stop-before-start, takes the whole service down until a good release
  deploys; it does **not** roll back to the previous release. `main`
  auto-deploys on every merge, so this is one merge away at all times — see
  [RUNBOOK-CUTOVER.md](RUNBOOK-CUTOVER.md) § "Migrations under auto-deploy".
  (The legacy lazy `ensureSchema()` path was removed by E05.)
- **Seasonal data rots on a schedule** (GTFS, WSF fares ~Oct, hours quarterly) —
  mitigated by the OPERATIONS.md calendar, not by code.
- **Parking polygon geometry** is schematic-georeferenced (±10 m) pending the
  admin's hand-correction pass in `/admin/map`.
- **`/admin` insights include opt-in GPS samples** — small-n; treat as sample,
  not census (labeled in UI).
- **Legacy Google v4 localPosts dependency** (when the GBP syndication adapter
  ships) is Google's risk to force-migrate; the adapter must stay isolated
  behind the seam.
