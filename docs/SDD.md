# Software Design Document — Explore Kingston

**Project:** `visit-kingston` — the interactive companion to explorekingstonwa.com, built with the Greater Kingston Chamber of Commerce. Product name in the UI: **Explore Kingston**.
**Date:** July 2026
**Stack:** Next.js 16.2.10 (App Router, `output: "standalone"`), React 19.2, TypeScript 5, Tailwind CSS 4 (`@tailwindcss/postcss`, config-less), Leaflet 1.9 + OSM tiles, `@geoman-io/leaflet-geoman-free` (admin polygon/feature drawing). Production persistence deps: `@neondatabase/serverless`, `@vercel/blob`, `@upstash/ratelimit` + `@upstash/redis`.
**Audience:** an engineer (or AI agent) maintaining, extending, or faithfully re-implementing the system.

> **Caution for re-implementers** (`AGENTS.md`): this Next.js 16 differs from older training data. Route-handler/page `params` and `searchParams` are `Promise`s that must be awaited (visible throughout `src/app/**`). Read `node_modules/next/dist/docs/` before writing route/page code.

Sibling docs: [REQUIREMENTS.md](REQUIREMENTS.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [DATA_SOURCES.md](DATA_SOURCES.md) · [SYNDICATION.md](SYNDICATION.md) · [OPERATIONS.md](OPERATIONS.md) · [DEPLOY.md](DEPLOY.md) · [MAPS.md](MAPS.md). Index: [README.md](README.md).

---

## 1. Purpose & one-screen system overview

A tourism web app for Kingston, WA (unincorporated Kitsap County; the Edmonds–Kingston car-ferry gateway to the Kitsap/Olympic Peninsulas), serving three constituencies:

1. **Visitors** — public pages: live ferry departures (WSDOT + Kitsap Transit), a **ferry busyness forecast + trip planner**, restaurants with a live "Open now" badge, an events calendar, a **multi-view town map** (map CMS), parking, WSDOT/ferry webcams + live vessel & SR-104 traffic maps, itineraries, lodging, a GPS-verified photo scavenger hunt, and a volunteer/give-back page. The app also reframes itself by **which side of the water** the visitor is on (Kingston vs Edmonds).
2. **Local businesses & nonprofits** — an invite-only portal (`/portal/**`) to edit their own listing, weekly hours, events, and volunteer shifts, plus a syndication page packaging their data as JSON/iCal feeds + an embeddable widget.
3. **The Chamber** — `/admin/**`: a Visitor Insights dashboard (privacy-first analytics + LTAC survey aggregates), account/invite management, a scavenger-hunt builder, content and map CMSs, structured ferry-fact editors, and a ferry-prediction on/off switch.

**Core architectural decisions:**

- **Dual-backend persistence seam (§3) — the central architectural fact.** Every store branches on env presence; nothing above the store modules changes. Local / persistent-disk hosts write JSON/JSONL under `DATA_DIR` (default `.data/`); on Vercel-style serverless the same stores use Neon Postgres, Vercel Blob, and Upstash Redis, all auto-detected. **Phase 1 (filesystem) is the live production home** (Render, `/data` disk). *(Superseded by E05: structured data is Postgres-only — `record` + append tables, every write through the audited zod choke point `src/lib/db/records.ts`, `DATABASE_URL` required (health 503s without it); the `DATA_DIR` disk keeps only images/hunt photos until E15.)*
- **Self-hosted auth (§4).** Invite-based accounts, scrypt password hashes, stateless HMAC-signed session cookies carrying a revocation claim, five least-privilege roles over an org entity, invite expiry/email-binding/revoke, a request-boundary proxy gate, rate-limited login/setup/redeem, self-service and admin password flows. No third-party auth.
- **Fail soft everywhere (§5).** Every external dependency (WSDOT, NOAA, NWS, webcams, the stores themselves) degrades to a bundled fallback or a silent no-op, never an error page. Non-live data is always labelled (`live: boolean`, "estimate", "Schedule only").
- **Privacy-first analytics.** Cookie-less pageview/outbound tracking with server-side coarse geo; opt-in geo-pings rounded to ~100 m and bucketed into named areas; an anonymous survey. No PII, no IP storage.
- **Server components by default.** Client components are deliberate islands (§11) — anything needing the browser clock, geolocation, Leaflet, localStorage, or form state.

**Environment.** `AUTH_SECRET` (required; `auth.ts` throws if missing). Optional live-data/backend vars in the table below; absence degrades gracefully.

| Var | Effect | Notes |
|---|---|---|
| `AUTH_SECRET` | signs HMAC session cookies | **required** |
| `WSDOT_API_KEY` | live ferry data | absent → bundled fallback schedule, `live:false` |
| `NEXT_PUBLIC_SITE_URL` | share-card/canonical URL origin | **build-time** var (inlined into client bundle); **required in production** |
| `SETUP_TOKEN` | gates first-run admin bootstrap | fail-closed; unused once an admin exists |
| `DATA_DIR` | persistent-volume path (Phase 1) | e.g. `/data`; not set on Vercel *(E05: images/hunt photos only)* |
| `DATABASE_URL` | Neon Postgres (Phase 2) | pooled URL (host has `-pooler`) *(superseded by E05: **required** everywhere — health 503s without it)* |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob image store (Phase 2) | — |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | shared rate-limit (Phase 2) | else in-process Map |
| `FERRY_OBSERVE_TOKEN` | optional bearer gate on `/api/ferry/{observe,accuracy}` | absent → open (writes throttled, public data only) |

Scale: **33 pages, 40 API route files.** Scripts: `dev/build/start/lint`, plus (post-E02/E05) `typecheck`, `lint:boundaries`, `test`/`test:server`, `db:generate`/`db:migrate` (drizzle-kit).

---

## 2. Domain model (`src/lib/types.ts`)

Header contract: *"Every feature reads these types; data adapters in src/lib/data map external sources … into them so sources can be swapped without touching UI code."* Walk-through in file order:

| Type | Semantics & invariants |
|---|---|
| `FerryRoute` | `"edmonds-kingston"` (WSF car ferry) \| `"kingston-seattle-fast"` (Kitsap Transit passenger-only). |
| `Direction` | `"to-kingston"` \| `"from-kingston"`. Every sailing is normalized to Kingston's perspective. Reused throughout the ferry forecast, side classifier, and observation log. |
| `Sailing` | `departs` ISO 8601 **with local offset**; optional `arrives`, `vessel`, `notes` (fallback sailings carry a "confirm with WSDOT" note). |
| `TerminalStatus` | `driveUpSpaces?` (undefined when WSDOT reports −1/null), `waitEstimate?` (staff note text), `alerts: string[]`, **`live: boolean`** (the system-wide honesty flag: `false` = bundled fallback), `asOf` ISO. |
| `Webcam` | `imageUrl` is a hotlinked WSDOT JPEG (no CORS, no Cache-Control); `sourceUrl` credit link; `refreshSeconds` the measured source cadence. Now overlay-editable (listing-stores). |
| `DayHours` | `[open, close][]` of 24h `"HH:mm"` pairs. **Invariants:** empty = closed; two pairs = split shift; *a close at or before its open means the span runs past midnight* (`["17:00","01:00"]`). Honored by the hours engine (§12.1), hours editor, portal validation (rejects only `open === close`), and the JSON-LD emitter. |
| `WeeklyHours` | Seven `DayHours` keyed `mon..sun`. |
| `Restaurant` | Business listing. `weeklyHours?` powers the live badge; `hours?` the human string (regenerated by the portal editor); `hoursVerified?` ISO date of last verification; `orderingPlatform` enum (`toast\|square\|doordash\|own-site\|phone-only`); `priceLevel 1\|2\|3`; `lat/lng/walkMinutesFromFerry` admin-only placement fields; **`hidden?`** — *"admin show/hide toggle: when true, dropped from /eat, near-me, and maps"* (a reversible alternative to a tombstone delete, §3). |
| `EventCategory` | `festival\|market\|music\|community\|charity\|sports\|arts`. |
| `EventItem` | `start`/`end?` ISO 8601 (portal writes anchor to Pacific wall time via `pacificWallTimeToISO`); `charityId?` links nonprofit events into the charity portal; **`ownerId?` is the portal-ownership key** — `canEdit(user, ownerId)` gates every mutation (§4, §9). Midnight start renders "All day". |
| `Itinerary`/`ItineraryStop` | `mapQuery?` builds a Google Maps deep link; `mode: walk-on\|car\|either`. Overlay-editable via itinerary-store. |
| `Charity`/`VolunteerNeed` | Org profile (4 portal-editable fields) + a shift; `slotsFilled` clamped server-side to `0..slotsTotal`; `date` a full ISO instant. |
| `Hunt`/`HuntStop` | `radiusMeters` — the GPS check-in threshold (server clamps 20..1000, default 100); coordinates deliberately approximate (*"GPS is an assist, not a gate"*); `difficulty: easy\|moderate`. |
| `SurveyResponse` | One anonymous LTAC visitor-survey response, no PII. `distanceBand` (`local\|10-50mi\|50mi-plus\|out-of-state\|international`) is the only required field; `lodgingNights` capped 60, `partySize` 50 server-side. |
| `Lodging` | `type: hotel\|vacation-rental\|bnb\|camping\|marina`; links only (Airbnb/VRBO are search deep links per ToS). Overlay-editable via listing-stores. |

**LEGACY / ORPHANED — do NOT document as live features:**
- **`Atm`** (types.ts:94) — orphaned. `src/lib/data/atms.ts` is **deleted**; there is no ATM/cash map anywhere. Cash guidance now lives in the structured **ferry-info `cash-tips`** record ("no ATM at the dock; nearest cash machines up in downtown Kingston") — see §8/§5-adjacent.
- **`ParkingArea`** (types.ts:82) — the legacy flat record. It is still *imported* by `src/lib/data/parking.ts`, which exports a `parkingAreas: ParkingArea[]` array, but nothing consumes it (grep-verified). The live parking dataset is **`MapZone`** (in `src/lib/data/parking.ts`), edited through parking-store + `/admin/map`. (`ParkingArea`/`parkingAreas` are dead weight — see inconsistencies.)

**Domain extensions living outside types.ts** (deliberate — local modules extend rather than bloat the shared model):

- **Map CMS** — `src/lib/map/types.ts`: `MapView` (a named reusable map config: `center/zoom/sources[]/published`), `MapFeature` (a drawn thing: `kind: FeatureKind = marker|line|trail|area`, geometry `point|path|polygon`, `views[]` it appears on, optional `parking: ParkingMeta`, `images[]`), `BuiltInSource = "restaurants"|"parking-zones"|"streets"`, `ParkingType`/`ParkingMeta`, the `MARKER_CATEGORIES` and `PARKING_TYPES` palettes, and `ResolvedMapView` (the render payload). Pure helpers `featureColor`, `featureImages`, `markerCategory`, `parkingTypeInfo`.
- **`MapZone` + `ParkingRule`** (`src/lib/data/parking.ts`): the parking dataset. `rule: free-2hr | free-unrestricted | paid | park-and-ride-24h | prohibited | load-zone | permit`; **`confidence: "verified" | "probable" | "unverified"`** with `sourceNote` — a first-class product feature (badges, italic caveats, popup captions; "probable" curb entries all trace to the 2015 county study). `center: [lat,lng]`, optional `polygon`.
- **Ferry-info facts** (`src/lib/data/ferry-info.ts`): `FerryPayment`, `BoardingPass`, `Source`, `CASH_TIPS`, and the `FerryInfo` assembly — structured, admin-editable (§8).
- **Ferry forecast model types** (`src/lib/ferry-forecast.ts`): `BusyLevel`, `TravelMode`, `EmpiricalBucket`/`EmpiricalTable`, `ForecastAt`, `ForecastPoint`, `DayExtreme`, `LevelMeta` (§6).
- **Auth** — `SessionUser`/`OrgRow`/`InviteRow`/`Role` (`src/lib/auth/`, §4); tables in `src/lib/db/auth-schema.ts`.
- **Hunt store** — `StoredHunt`/`StoredHuntStop`/`AdminHunt`/`HuntSubmission` (`src/lib/hunt-store.ts`, §3).
- **Analytics/survey** — `AnalyticsEvent`/`AnalyticsGeo`/`AreaBox`/`AnalyticsSummary` (`analytics-store.ts`), `SurveyStore`/`SurveySummary` (`survey-store.ts`).
- **Side** — `WaterSide` (`src/lib/side.ts`, §7).

---

## 3. Persistence design — the central update

The app was file-only; it now runs on a **dual-backend seam** auto-selected by env presence. The store *interfaces* are the contract; the I/O behind them is an implementation detail sized for one node or for cloud stores. Nothing above the store modules branches. *(Superseded by E05: the dual-backend seam is gone from this layer — structured data lives only in Neon Postgres, `json-store.ts` is a thin delegate over `src/lib/db/records.ts` (zod-validated, audited writes), and `src/lib/db.ts`/`hasDb()` are deleted. The store interfaces and everything above them are unchanged, as promised.)*

### 3.1 The seam files

| File | `hasX()` gate | File-mode backend | Cloud backend |
|---|---|---|---|
| `data-dir.ts` | — | `dataDir()` = `$DATA_DIR` (resolved) or `<cwd>/.data`; `dataPath(...segs)` joins | (paths unused when a cloud store handles the domain) |
| `db.ts` | `hasDb()` = `DATABASE_URL` set | — | Neon Postgres via `neon()` (stateless HTTP tagged-template). `db()` throws if unset (callers gate on `hasDb()`). `ensureSchema()` lazily + idempotently creates tables (memoized per warm process; a failed setup clears the memo so the next call retries). *(Superseded by E05: `db.ts` deleted — `src/lib/db/client.ts` + Drizzle migrations applied at boot replace it; no lazy schema, no `hasDb()` gate.)* |
| `blob-store.ts` | `hasBlob()` = `BLOB_READ_WRITE_TOKEN` set | image bytes written under `.data/…` by the domain store | `putImage(key, bytes, type)` → Vercel Blob (public, `addRandomSuffix`) returns the full CDN URL. Callers store the returned **string** and hand it to `<img src>` — either a full https blob URL (prod) or a relative name the app's image routes serve (dev), *no branch in callers*. |
| `rate-limit.ts` | `hasUpstash()` = `UPSTASH_REDIS_REST_URL` set | in-process `Map` sliding window (correct only for a single instance) | Upstash Redis shared sliding window (correct across replicas/lambdas). `checkRateLimit(key,{limit,windowMs})` + `clientKey(req,bucket)` are identical across backends. |

**Legacy DB schema (`db.ts` `SCHEMA_STATEMENTS`, lazily self-created; superseded since E05 by `src/lib/db/schema.ts` + generated `db/migrations/`):** four tables.
- `overlay(store text, id text, doc jsonb, deleted boolean, PRIMARY KEY(store,id))` — backs **every** seed+overlay collection **and auth** (`store='auth-users' | 'auth-invites'`). `deleted` carries the `{_deleted:true}` tombstone.
- `analytics_event(ts, event jsonb)`, `survey_response(ts, response jsonb)`, `ferry_observation(ts, obs jsonb)` — append-only logs.

### 3.2 The backend-agnostic overlay store — `src/lib/stores/json-store.ts`

The ~75-line core all portal-editable data sits on. *(Superseded by E05: the file branch is gone — all three functions are thin delegates over `src/lib/db/records.ts` against the `record` table; writes are zod-validated per store, audited, and only `live` rows participate in the merge. The contracts below are otherwise unchanged.)*

- `readOverlay<T>(name)` — file mode: parse `.data/stores/<name>.json`, **any error returns `[]`** (fail-soft). DB mode: `SELECT id, doc, deleted FROM overlay WHERE store = name`, re-attaching `_deleted` onto the doc so downstream filters behave identically.
- `writeOverlayRecord<T>(name, record)` — file mode: read-modify-write the whole array (`JSON.stringify(…, null, 1)`), replace-by-id or append (no locking; last write wins). DB mode: a single `INSERT … ON CONFLICT (store,id) DO UPDATE`, lifting `_deleted` into the `deleted` column.
- `readMerged<T>(name, seed)` — **the merge**: `Map<id>` from `seed`, overlay each overlay record over it (overlay wins by id), drop `_deleted`, strip the flag. Deletion is a **tombstone** (`{id,_deleted:true}` hides a seed row forever and removes an overlay-only row); the tombstone itself persists.

Consequence: an overlay record fully *replaces* the seed record (no field-level merge — which is why portal PUT handlers merge onto the *stored* record before saving, §9). Reversible "take it off the page" for restaurants uses the `hidden` flag instead of a tombstone, so the record stays in the admin list.

### 3.3 Full store inventory (`src/lib/stores/` — 12 modules + json-store)

| Store module | Overlay store name(s) | Seed | Notes |
|---|---|---|---|
| `business-store.ts` | `restaurants` | `data/restaurants.ts` | `getRestaurants/getRestaurant/saveRestaurant/deleteRestaurant` (tombstone). `hidden` flag is the reversible hide. |
| `event-store.ts` | `events` | `data/events.ts` | `getEvents` (sorted by `start`), `saveEvent`, `deleteEvent`, **`eventsSharingDate(dateIso, excludeId?)`** — the deconfliction query (§12.3). |
| `charity-store.ts` | `charities`, `volunteer-needs` | `data/charities.ts` | orgs + shifts. |
| `parking-store.ts` | `parking-zones` | `data/parking.ts` (`parkingZones`) | `MapZone` CRUD; `/admin/map` polygon editor overlays the researched seed. |
| `map-store.ts` | `map-views`, `map-features` | `data/map-{views,features}.ts` | Map CMS. Also feature-image storage: `saveFeatureImage` (sha1-named; Blob in prod, `.data/map/images/` in dev), `readFeatureImage`, `featureImagePath` (traversal-rejecting), `isBlobUrl`. |
| `itinerary-store.ts` | `itineraries` | `data/itineraries.ts` | matches on slug across merged records. |
| `listing-stores.ts` | `lodging`, `webcams` | `data/{lodging,webcams}.ts` | two small stores in one file. |
| `site-store.ts` | `site-copy`, `site-pages` | none | CMS text overrides (`getCopyOverrides`, `copyText`, `saveCopyOverride`) + per-page visibility (`getPageSettings/getHiddenPaths/setPageHidden`). §8. |
| `ferry-info-store.ts` | `ferry-info` | four seed records | Exactly four id'd structured records: `payment`, `boarding-pass`, `cash-tips`, `sources`. Each `doc` is the whole object/array from `data/ferry-info.ts`; overlay wins per record. §8. |
| `ferry-prediction-store.ts` | `ferry-prediction` (id `settings`) | none (absence = OFF) | admin on/off flag for the whole prediction feature, **default OFF** (§6). `getFerryPredictionAccess()` → `{enabled, adminPreview}`: admins preview while off. |
| `boarding-pass-store.ts` | `boarding-pass-override` (id `override`) | none | admin daily override of the SR-104 pass verdict; lapses at Pacific midnight (§12.6). `getEffectiveBoardingPass()` returns override-or-estimate. |
| `ferry-observations.ts` | append log + `ferry-accuracy` overlay | none | Append snapshots of sailing fullness/delay → empirical busyness table + accuracy backtest (§6). |

**Auth files** live in the SAME overlay table in DB mode (`store='auth-users'`, `store='auth-invites'`; invites keyed by their code in the `id` column) or in `.data/auth/{users,invites}.json` in file mode. `auth.ts` branches on `hasDb()` per call. *(Superseded by E05: Postgres-only — `record` rows, same store names; the file branch and `hasDb()` are gone.)*

**Append paths** (all dual-backend, all fail-soft, corrupt lines skipped) *(superseded by E05: DB-only — the jsonl branches are gone; tables unchanged)*:
- **Analytics** — `analytics-store.ts` → `.data/analytics/events.jsonl` or `analytics_event`. `summarize()` re-reads and re-aggregates the whole log per call ("fine at Kingston scale").
- **Survey** — `survey-store.ts` → `.data/ltac-responses.jsonl` or `survey_response`. Pluggable behind a `SurveyStore` interface (`save`, `summarize` — aggregate counts only, never raw rows) with a single exported `surveyStore` instance.
- **Ferry observations** — `ferry-observations.ts` → `.data/ferry/observations.jsonl` or `ferry_observation`. Throttled to one write per 10 min per process; 90-day retention pruning; a 10-min aggregate cache.

### 3.4 The `.data/` tree (file mode) *(superseded by E05: only `map/images/`, `hunts/refs/`, `hunts/photos/` are still live on disk — the JSON/JSONL entries below moved to Postgres)*

```
.data/
├── auth/{users,invites}.json          # User[] / InviteCode[]  (file mode only)
├── stores/<name>.json                 # Overlay<T> per store name above
├── hunts/
│   ├── custom-hunts.json              # StoredHunt[]  (file mode)
│   ├── refs/<huntId>-<stopId>.<ext>   # reference photos
│   ├── photos/<huntId>/<stopId>/…     # player submissions
│   └── submissions.jsonl              # HuntSubmission per line (file mode)
├── map/images/<sha1>.<ext>            # feature images (file mode)
├── analytics/events.jsonl
├── ferry/observations.jsonl
└── ltac-responses.jsonl
```

Every writer `mkdir`s its parent recursively; a fresh file-mode checkout needs nothing but `AUTH_SECRET`. `/api/health` probes that `dataDir()` is writable (§9). *(Superseded by E05: a fresh checkout also needs `DATABASE_URL`, and the health route additionally pings Postgres — `dbOk` — 503ing without it.)*

### 3.5 Hunt store — `src/lib/hunt-store.ts`

Server-only (touches the filesystem; `import type` is fine anywhere). Dual-backend like the rest *(superseded by E05: hunts + submissions are Postgres-only records; photos stay on disk/Blob)*:
- **Custom hunts** → overlay store `custom-hunts` (DB) or `.data/hunts/custom-hunts.json` (file). `getAllHunts` merges seed with custom (custom wins by id, tagged `source:"custom"`; custom-only appended). No tombstones — hunts are never deleted through the app.
- **Submissions** → overlay store `hunt-submissions` (DB) or `.data/hunts/submissions.jsonl` (file). `HuntSubmission` now carries an optional `id` (overlay key on DB rows; legacy file rows may lack it).
- **Photos** → Blob in prod (`putImage`), `.data/hunts/{refs,photos}/…` in dev.
- `saveHunt` re-validates ids (`isSafeId` — ids become path segments), rejects slug collisions across the merged set, preserves a stop's existing `referencePhoto` when omitted, and only keeps an incoming `referencePhoto` if it passes sanitization and starts with `refs/`. `saveReferencePhoto` materializes a seed hunt into the custom store so the pointer has somewhere to live. `saveSubmission` computes `verified` (§12.2) and appends. `getPhotoAbsolutePath`/`readPhoto` do strict path sanitization (§13). `MAX_PHOTO_BYTES = 8 MiB`; images jpeg/png/webp/heic.

### 3.6 Migration path

`npm run import:data-dir -- --data-dir <dir>` (`scripts/import-data-dir.ts`, semantics in `scripts/import-core.ts`) loads a populated `DATA_DIR`-shaped tree — a `.data/` copy or a backup bundle restored via `scripts/restore-backup.mjs` — into Postgres: dry-run diff by default, `--apply` (+ typed host confirmation, or `--yes`) to write through the app's choke point with `import` audit rows; schema-invalid records are parked in the `quarantine` table, never `record`; append logs are run-once (`--force-append` to override); images are not moved (no Blob uploads this epic). The tables themselves come from checked-in Drizzle migrations (`db/migrations/`, generated from `src/lib/db/schema.ts`, applied at boot or via `npm run db:migrate`). `/api/admin/backup` streams the whole `DATA_DIR` as a JSON bundle for off-site backup (restore via `scripts/restore-backup.mjs`).

---

## 4. Authentication & authorization (`src/lib/auth/`)

Self-hosted, server-only. Invite-based accounts, scrypt hashes, stateless
HMAC cookies, Postgres-backed. No third-party auth provider or IdP — that was
rejected by the audit and is binding (decisions doc §4).

**E06 restructured the single `src/lib/auth.ts` into a directory.** The split is
by what each part is allowed to depend on, which is what makes the pieces
reusable:

| Module | Contains | Depends on |
|---|---|---|
| `tokens.ts` | password hashing, session-token make/verify, cookie attrs | **nothing** — pure `node:crypto` |
| `authz.ts` | the five roles, `can()`, gate response shapes | nothing (pure, synchronous) |
| `identity.ts` | users/orgs/invites as business operations (the rules) | `db/auth-store.ts` |
| `session.ts` | cookie → `SessionUser`, and the route gates | `next/headers`, `identity` |
| `index.ts` | the barrel every consumer imports (`@/lib/auth`) | all of the above |

`tokens.ts` is pure *deliberately*: `src/proxy.ts` must verify a token without
touching the database, and `tests/server/global-setup.ts` needs `hashPassword`
in a plain-Node context. Before E06 that file hand-copied the scrypt logic
because `auth.ts` imported `next/headers` at module scope.

Table SQL lives in `src/lib/db/auth-store.ts`, not in `src/lib/auth/` — only
`src/lib/db/**` may import the Postgres client (`db-client-only-via-db-layer`
in `.dependency-cruiser.cjs`). `identity.ts` is the domain layer over it, the
same shape as `json-store.ts` → `records.ts`.

### 4.1 Passwords
- `hashPassword`: 16-byte hex salt, `scryptSync(pw, salt, 64)`, stored `scrypt$<salt>$<hash>`.
- `verifyPassword`: splits on `$`, requires scheme `scrypt`, recomputes, `timingSafeEqual` after a length check. Any malformed value → `false`.
- **Unchanged from v1 byte-for-byte.** E06 ships no rehash migration, so every stored hash keeps verifying. A fixture in `tests/unit/auth-v2-identity.test.ts` pins a v1-format hash to catch any drift.

### 4.2 Session token — stateless HMAC cookie with a revocation claim
- **Format:** `base64url(JSON{uid,sv,exp}) + "." + base64url(HMAC-SHA256(payload, AUTH_SECRET))`. `exp` = `Date.now() + 30 days`.
- **`sv` is new in E06** — the user's `session_version`. `getSessionUser()` rejects the token when it does not equal the stored value, so bumping that integer invalidates **every outstanding cookie for one user** without any server-side session store.
- Bumped by: self password change, admin reset, disable, enable, and role change.
- **Tokens without `sv` are rejected.** Pre-E06 cookies cannot be versioned, therefore cannot be revoked, therefore are not honored — this forces one re-login for everyone at the auth-v2 deploy (see `docs/OPERATIONS.md`).
- **Verify** (`verifySessionToken`, pure): split, recompute, length-guarded `timingSafeEqual`, parse, enforce `exp >= now` and an integer `sv`. Signature and expiry ONLY — it cannot see `disabled` or the stored `sv`.
- **Cookie** (`sessionCookie`): name **`vk-session`**, `httpOnly`, `sameSite:"lax"`, `path:"/"`, `maxAge` 30 days, `secure` in production. Unchanged; renaming it is a non-goal.
- `getSessionUser()` re-reads the user every request and rejects: unknown uid, `disabled`, and `sv` mismatch.

### 4.3 Role model, orgs, and `can()`
Five least-privilege roles (`src/lib/auth/roles.ts` — a zero-import module, so
client components share the vocabulary without pulling drizzle into the bundle):

| Role | May do |
|---|---|
| `admin` | everything: accounts, invites, backups, all content |
| `moderator` | the moderation queue (E08). Hard 403 on accounts, invites, resets, backup |
| `org-editor` | their org's profile, events, volunteer needs (replaces `nonprofit`) |
| `member-business` | their org's linked listings and events (replaces `business`) |
| `viewer` | read-only reporting/grant views (E10). No writes anywhere |

`moderator` and `viewer` are provisioned and **enforced** in E06 — they sign in
and get correct 403s — but have no UI surfaces until E08/E10.

**Orgs.** An `orgs` row sits between users and content. `linked_ids` moved off
the user onto the org, so permission follows the organization and a second
account at the same business inherits it. Users carry `org_id`; Chamber-staff
roles carry `NULL` (enforced by the `users_org_binding` check constraint).
`orgs.external_ids` (E16, AMS member id) and `orgs.entitlements` (E19, paid
tiers) exist and are empty.

`canEdit(user, id)` is replaced by:

```ts
can(user: AuthSubject, action: Action, resource?: Resource): boolean
```

Actions are a closed set: `edit-record`, `manage-accounts`, `moderate`,
`view-reports`, `manage-site`. Adding one without a rule is a **compile error**
(the `never` exhaustiveness branch), so a new action fails closed.

`can()` is synchronous and pure — portal server pages call it inline while
rendering, and the data it needs (the org's linked ids and entitlements) is
joined once by `getSessionUser()`.

**Entitlements narrow, never widen.** `can()` consults `org.entitlements`
structurally so E19 wires tiers without a signature change, but an entitlement
may only turn an allowed action into a denied one. `roleAllows()` is therefore
the permanent ceiling: since E16 syncs that jsonb blob from an external AMS,
a widening contract would make a bad sync a privilege escalation. Full matrix
(5 roles × 5 actions × 3 resource contexts) in `tests/unit/authz-matrix.test.ts`.

**Stored-record-decides is preserved.** Every portal route checks authorization
against the loaded record's owner, never a client-sent id.

### 4.4 Invite lifecycle
1. **Mint** (`POST /api/portal/invites`, admin): `randomBytes(12)` hex code; `linkedIds` validated against the *real* stores; note ≤ 200 chars; **`expires_at` = now + 14 days**; optional **email binding**; either an existing `org_id` or a `new_org_name`+`new_org_kind` to create on redemption.
2. **Redeem** (`POST /api/auth/redeem` → `redeemInvite`): the invite row is re-read `FOR UPDATE` inside the transaction that creates the org + user and burns the code, so a double-redeem serializes and the second attempt loses. Expired / revoked / used / unknown all return the SAME message — the endpoint is not an oracle for which codes exist.
3. **Revoke** (`DELETE /api/portal/invites?code=`, admin): sets `revoked_at` on an un-redeemed code (FR-A09).
4. `/admin/accounts` shows derived state (active / used / revoked / expired) and generates a paste-ready join blurb.

Three invariants are enforced by the **database**, not app code, because an
in-app check is a TOCTOU window and E16's AMS sync will be a second writer:

- `users_email_lower_idx` — one account per email, case-insensitively.
- `invites_admin_requires_email` — an admin invite must be email-bound, so a forwarded code can never be a bearer admin grant.
- `invites_org_binding` — join XOR create, never both or neither.

### 4.5 First-run bootstrap
- `POST /api/auth/setup` creates the **first** account (`role:"admin"`, `org_id: null`); 403 once any user exists, and 403 unless the request carries the operator-set **`SETUP_TOKEN`** (E01).
- `/portal/setup` UI redirects to `/portal` once users exist; `/portal` redirects to `/portal/setup` while none.
- **The `/admin` no-users grace is GONE (E06).** It previously left `/admin` world-readable behind an amber banner whenever the user store was empty — the audit's highest-risk finding, because the event that empties the store (bad restore, failed migration) is exactly the event that re-opened `/admin`, while the operator was distracted. Bootstrap still works: `/portal` is the front door and redirects to `/portal/setup`, so `/admin` is never the entry point.

### 4.6 Account lifecycle & self-service
- **`PUT /api/auth/account`** — self-service profile (name/email), session-gated, rate-limited (`profile`, 10/window).
- **`POST /api/auth/password`** — self-service change (`changeOwnPassword` verifies the current password; new ≥ 8 chars), rate-limited (`pwchange`, 5/window per IP and per user). Bumps `session_version` and **sets a fresh cookie on the response** — otherwise the user would log themselves out by changing their own password, while every *other* session stays correctly dead.
- **`POST /api/portal/users`** (admin) — `reset-password` (temp returned **once**; only the hash is persisted, and the temp is never audited), plus `disable`, `enable`, `set-role`, `delete`. All bump `session_version`, so a change takes effect on the target's next request rather than whenever their 30-day cookie expires.
- **Last-admin guard:** disabling, deleting, or demoting the only *enabled* admin returns 400 with an explanation. Mechanical — it counts enabled admins rather than trusting the caller.
- **`delete` is a hard delete.** Audit rows survive with the actor id intact: a dangling reference by design, because the trail must outlive the account.
- **`GET /api/portal/users`** returns `role`, `disabled`, `lastLoginAt`, `orgId` (FR-A09's account list) via `toPublicUser()`, a type with **no `passwordHash` field at all** — hashes cannot leak by a careless spread.

### 4.7 Rate limiting (§3.1 `rate-limit.ts`)
Unchanged by E06 — every call site and key is ported as-is. Login, setup, and
redeem are limited (8/60 s default; setup 5), keyed by IP (`clientKey`) **and**
by account dimension (`login:<email>`, `redeem:<code>`) so IP rotation cannot
fully escape. Profile/password changes limited too.

### 4.8 Page-level visibility gating (`src/lib/page-visibility.tsx`)
Public pages call `await assertPageVisible("/hunt")` at the top of their server component. Hidden page + visitor → `notFound()`; hidden page + admin → renders with `<HiddenPageBanner/>` for preview. `HIDEABLE_PAGES` (11 paths) is the single source of truth shared by the admin UI and the nav filter.

### 4.9 Defense in depth — four layers
1. **`src/proxy.ts`** (E06, Next 16 convention — *not* `middleware.ts`). Matches `/admin`, the signed-in `/portal` sub-pages, `/api/admin/*`, `/api/portal/*`. Verifies the cookie's signature + expiry only: **no database access**, per the Next docs' rule that a proxy must not rely on shared app state. It therefore cannot see `disabled`, `session_version`, or role — a valid signature is not a valid session. Unauthenticated: `/api/*` → 401 JSON, pages → redirect to `/portal`. Fails **closed** if `AUTH_SECRET` is missing.
2. **The `/admin` layout** re-checks `role === "admin"`.
3. **Every route handler** calls the shared gate — `requireRole()` / `requireCan()` / `requireUser()` from `@/lib/auth`. This is the **authoritative** check, because it is the only layer that can read the database. Route handlers bypass layouts entirely, so this is not optional.
4. **CI tripwires:** the generated unauthenticated admin-walk (`tests/server/admin-walk.test.ts`) hits every `/api/admin/*` and `/api/portal/*` route with no cookie and asserts 401/403; the gate-coverage static test (`tests/unit/authz-gate-coverage.test.ts`) fails the build if any route file stops referencing a gate. E06 collapsed ~12 divergent private copies of the admin check into one import, and normalized the contract: **401 unauthenticated, 403 wrong role**, everywhere.

**CSRF:** unchanged in E06. The posture is `SameSite=Lax` plus non-GET JSON
mutations; no token framework was added (explicit non-goal).

---

## 5. External adapters & graceful degradation

Shared contract: **never throw, never block the page — return a fallback and mark it.** Server fetches use `fetch(..., { next: { revalidate: N } })` for self-throttling.

### 5.1 WSDOT Ferries — `wsf.ts`
- Constants (verified 2026-07-02): Edmonds `TerminalID=8`, Kingston `=12`, Ed-King `RouteID=6`. Bases: schedule/terminals/vessels REST.
- Key rides in the URL query string (`apiaccesscode=`) — **server-side only**. `wsfFetch` returns `null` on missing key / non-OK / thrown error → everything falls back.
- WCF `/Date(ms-0700)/` unwrapped by `parseWsdotDate` (regex extracts absolute epoch-ms, ignores the embedded offset, emits UTC ISO).
- Functions: `getTodaysSailings()` (`/scheduletoday`, both directions, revalidate 900 s; both must succeed for `live:true` else fallback), `getSailingsForDate(dateStr)` + `getValidDateRange()` (for the planner, revalidate 3600 s), `getTerminalStatus(t)` (`terminalsailingspace` 60 s + `terminalwaittimes` 300 s; drive-up nested and filtered to `count>=0`; wait note filtered to `RouteID===6`), `getSailingSpace(from)` (per-departure drive-up space for the observation log + planner), `getRouteDelays()` (per-direction lateness from the vessels feed: `LeftDock − ScheduledDeparture`, or now−scheduled while still docked), `getVesselLocations()` (live positions for the vessel map), `getRouteAlerts()` (filtered to route 6). `getBoardingPassStatus(now)` and `pacificDayString(now)` support the SR-104 pass subsystem (§6/§12.6).
- **Fallback** — `data/ferry-fallback.ts`: a typical summer timetable rebuilt for the requested day each call, every sailing annotated "confirm with WSDOT"; UI shows "Schedule only" badges.

### 5.2 Kitsap Transit fast ferry — `kitsap.ts`
No live API. Times extracted from the official GTFS feed (valid to 2026-09-12). Hardcoded arrays: 6 weekday + 8 summer-Saturday sailings each way, **no Sunday service**; `CROSSING_MINUTES = 39`; always `{live:false}`. Exports `FAST_FERRY_FACTS` (verified fare/pier/URL prose).

### 5.3 NWS weather — `weather.ts`
`gridpoints/SEW/121,78/forecast` (dock gridpoint), identifying User-Agent required, revalidate 1800 s; `[]` on failure → home renders "See forecast at weather.gov".

### 5.4 NOAA tides — `tides.ts`
Station **9445639** (Kingston, Appletree Cove — *not* 9445478). One GET, revalidate 21600 s; NOAA station-local time strings (home slices, doesn't parse); `[]` on failure.

### 5.5 Assembled snapshot — `ferry-status.ts`
`getFerryStatusSnapshot()` runs `getTodaysSailings` + both `getTerminalStatus` + `getRouteAlerts` + `getRouteDelays` + both `getSailingSpace` + `getEffectiveBoardingPass` + `getFastFerrySailings` in parallel into `FerryStatusSnapshot` (car/fast ferry, terminals, alerts, delays, sailingSpace, boardingPass). It fires `recordSailingSpaceSnapshot(...)` **void, un-awaited** (best-effort logging that can't slow or break the response). Shared by `/api/ferry/status` and the server pages that seed the widget so SSR and polling agree.

### 5.6 Pacific time — `time.ts`
`todayPacific()`, `pacificWallTimeToISO(dateStr, hhmm)` (probes noon UTC for the offset in effect, PDT/PST per-date), `formatPacificTime/Date`. The lynchpin that keeps fallback schedules and portal dates correct regardless of server zone. `hours.ts` (§12.1) uses the same Intl-based Pacific wall clock.

**Degradation catalogue (selected):** WSDOT down → fallback schedule + "Schedule only"; wait-notes fail (space ok) → still `live:true` without the note; NWS/NOAA fail → friendly copy pointing at the source; webcam image error → per-card offline placeholder + auto-retry; ferry poll fails → keep last good data; any store/JSONL read error → fallback value / skip corrupt line; localStorage/sessionStorage throws → fresh state / in-memory session id.

---

## 6. Ferry busyness forecast subsystem

The route publishes live space only for the next few sailings *today*; there is no "how busy is next Saturday" API. So this is an **estimate**, labelled as such on every surface.

### 6.1 The model — `ferry-forecast.ts` (PURE, client-safe)
No fetch/env/server imports, so the planner recomputes in the browser and SSR/hydration agree. Calibrated (July 2026) against WSF's per-sailing "Best Times to Travel" grid.
- **Curves**: `CURVES[dayCategory][direction]` — 24-hour demand arrays (0–100, peak ≈ 80) encoding the route's directional asymmetry (eastbound AM commute + Sunday-evening return; westbound PM commute + Friday-afternoon getaway; the 2:30 Kingston→Edmonds boat fills daily).
- **Multipliers**: `seasonFactor` (peak Jun 14–Sep 19 = 1.0, shoulder 0.82, off 0.58) × `holiday` (July 4th 1.5, Memorial/Labor/Thanksgiving 1.3, etc). `scoreAt(date, minutes, direction, empirical?)` clamps to 0–100; `scoreToLevel` maps to `light|moderate|busy|very-busy|extreme`.
- **Empirical blend**: when an `EmpiricalTable` bucket (direction × season × weekday × hour, key from `empiricalBucketKey`) has ≥ `EMP_MIN_SAMPLES` (3) observations, the heuristic is blended toward the observed value, weighted by sample count up to `EMP_MAX_WEIGHT` (0.75, so the prior always keeps a voice). **Holidays skip the blend** (rare spikes would wash out). `forecastAt` returns level, `arriveEarlyMinutes` (drive vs walk buffers), `boatWait` prose, `boardingPassActive` (mirrors `getBoardingPassStatus`), `factors[]` explanation chips, and `empiricalApplied`/`empiricalSamples`. `dayCurve` samples every 30 min and returns quietest/busiest **windows** (first→last time at the min/max, so a plateau reads honestly).

### 6.2 The observation log & accuracy — `stores/ferry-observations.ts`
`recordSailingSpaceSnapshot(space, delays)` snapshots the next ~2 sailings/direction (throttled 10 min/process; claims the slot synchronously to avoid double-writes) into the append log. `getEmpiricalBusyness()` aggregates the log into the `EmpiricalTable` (mean observed fullness `1 − driveUp/max`, nudged by mean delay), cached 10 min. `computeAccuracy()` backtests the **heuristic-only** prediction (honest out-of-sample) vs observed fullness → `AccuracyMetrics` (mae/rmse/bias/levelMatchRate/within1Rate). `recordAccuracySnapshot()` appends to a rolling ~60-run history in the `ferry-accuracy` overlay store.

### 6.3 Endpoints & UI
- `GET /api/ferry/plan?date=YYYY-MM-DD` — real sailings for a Pacific date within `[today, today+365]` (`isPlannableDate` rejects overflow/out-of-range), plus live `sailingSpace` when the date is today. The forecast itself is computed client-side; this route only serves schedule + live corroboration.
- `GET|POST /api/ferry/observe` — records one snapshot (point a ~15-min cron here for overnight coverage). Optional `FERRY_OBSERVE_TOKEN` gate.
- `GET|POST /api/ferry/accuracy` — runs the backtest and records a snapshot (daily cron). Same optional token gate. Admin viewing goes through `/api/admin/ferry-accuracy`.
- **Feature gating**: `ferry-prediction-store` **defaults OFF** — the whole prediction feature (the `/ferry/plan` planner, the "how busy today" panel on `/ferry`, the home planning callout) ships dark; `getFerryPredictionAccess()` still shows it to signed-in admins for validation. `/api/admin/ferry-prediction` toggles it.
- **Planner UI**: `/ferry/plan` renders the page-local client component `ferry-planner.tsx` (§11).

### 6.4 SR-104 vehicle boarding pass
- **Estimate** — `wsf.ts getBoardingPassStatus(now)`: active during peak hours (8 a.m.–8 p.m. Pacific) on any weekend, in season (≈ May 10–Oct 13), or a holiday week. Returns `{active, reason, source:"estimate"}`.
- **Admin daily override** — `boarding-pass-store.ts`: one record stamped with the Pacific day it was set; `getBoardingPassOverride` honors it only while that day is still today, so it **lapses at Pacific midnight** with no timer. `getEffectiveBoardingPass()` returns the override (`source:"override"`) or the estimate. `/api/admin/boarding-pass` sets/clears it.
- **Nav routing** — `ferry-line.ts`: when a pass is required the "get in the ferry line" link routes drivers to the SR-104 **staging point** (not the dock) via a forced turnaround waypoint (Barber Cutoff for a normal line, Miller Bay Rd when the wait tops 2 hr per `parseWaitHours`/`lineBacksPastBarberCutoff`) so nobody U-turns mid-highway. `ferryLineNavUrl(longWait)` builds the keyless Google Maps deep link.

### 6.5 Departure reminders — `ferry-reminder.ts`
Pure module. `reminderIcsUrl(dir, departs)` points the widget at `GET /api/ferry/reminder`, which validates `dir` against `FERRY_DIRS` (fixed labels) and parses `departs` to an instant, then `buildFerryIcs` emits an RFC-5545 `VEVENT` with a `VALARM` firing `REMINDER_LEAD_MIN` (20) before departure. Injection-safe by construction (nothing from the query string is echoed; times re-emitted as UTC stamps; year 1–9999 guarded; TEXT escaped + 75-octet folded).

---

## 7. Side-of-water mode

Reframes the app for Kingston-side (default, "leaving Kingston") vs Edmonds-side ("getting to Kingston") visitors.
- **`side.ts`** (client-safe): `WaterSide`, `SIDE_COOKIE = "vk-side"`, `SIDE_ASKED_COOKIE = "vk-side-asked"`, `SIDE_DIVIDE_LNG = -122.44`, and the pure classifier `sideFromLngLat(lat,lng)` (returns null outside the crossing box).
- **`side-server.ts`**: `getSide()` reads `vk-side` (needs `next/headers`); defaults `"kingston"`. Server components render for the current side.
- **`side-switcher.tsx`** (client): a segmented Kingston/Edmonds toggle + "use my location" button; writes the cookie and calls `router.refresh()` (no full reload — polling and scroll survive). **Opt-out**: on a visitor's first arrival it asks for location once and sets the side automatically; a hand-picked side or a prior ask (either cookie) suppresses the prompt forever.

---

## 8. Content CMS + map CMS + structured ferry facts

### 8.1 Content CMS (editable copy)
- **Registry** — `site-copy-registry.ts` exports `COPY_BLOCKS: CopyBlock[]` = **91 editable copy blocks** (grep-verified; GROUND_TRUTH's "77" is stale — see inconsistencies). Each block names a headline (`key = "<page>.<block>"`), an admin group `page`, `label`, optional `multiline`/`rich`, and a `fallback` (the exact string hardcoded in the component). Pure data, importable anywhere.
- **Overrides** — `site-store.ts` `site-copy` overlay holds only non-empty overrides; an untouched block always tracks the code fallback (`copyText(overrides,key,fallback)`).
- **Server** components read `copyText(...)` directly. **Client** components can't (the store is server-only/async), so `RootLayout` loads `getCopyOverrides()` once and provides them through **`copy-context.tsx`** `CopyProvider`; client components use `useCopy(key,fallback)` or **`<EditableText copyKey fallback rich?/>`**. `rich` text runs through `RichText` (parses `**bold**` and `[links](url)`).
- **Editor**: `/admin/content` (client `content/manager.tsx`) via `POST /api/admin/site`; page show/hide toggles too.

### 8.2 Page show/hide
`site-store` `site-pages` overlay (`{id:path, hidden}`); `getHiddenPaths()`; enforced by `assertPageVisible` (§4.8). Hidden pages drop from nav/footer/home grid and 404 for visitors; admins preview with a banner.

### 8.3 Map CMS
- **Types** in `src/lib/map/types.ts` (§2). **Seed** in `data/map-{views,features}.ts`; **overlay** in `map-store.ts`.
- **`resolve.ts`** `resolveMapView(viewId)` → `ResolvedMapView`: the view config, its custom features (`getFeaturesForView`), and lightweight **built-in-source** payloads (`restaurants` filtered to `!hidden` with a server-chosen marker category; `parkingZones`; `streets` = a boolean flag, the client fetches `/geo/street-parking.json` itself).
- **Public read** — `GET /api/map/[viewId]`: 404 unknown; **unpublished (draft) views are served only to admins** (dynamic-imports auth to check); `Cache-Control: s-maxage=60`. Feature images via `GET /api/map/image?p=` (redirects Blob URLs 302; streams sanitized fs names otherwise).
- **Builders**: `/admin/maps` (general map CMS — named views + drawable markers/lines/trails/areas + built-in layers; client `maps/editor.tsx` via `/api/admin/map-views`, `/api/admin/map-features`, `/api/admin/map-features/image`) and `/admin/map` (the parking-zone polygon editor with leaflet-geoman; `map/editor.tsx` via `/api/admin/parking`).
- **Public output**: `/map` renders the published views through `<FeatureMap/>` (§11).

### 8.4 Structured ferry facts — `ferry-info-store.ts` + `data/ferry-info.ts`
Four id'd records (`payment`, `boarding-pass`, `cash-tips`, `sources`), each field-editable at `/admin/ferry-info` via `/api/admin/ferry-info`. Rendered on `/ferry` (and cash guidance that formerly lived in an ATM section). `cash-tips` is where the removed cash/ATM content now lives ("no ATM at the dock…"). The editor page also hosts the boarding-pass override (`override-control.tsx`) and the prediction on/off toggle (`prediction-control.tsx`).

---

## 9. API surface — all 40 route files

Every route is `fs`/DB-backed and therefore effectively dynamic; only the feeds and `/api/map/*` set explicit cache headers. Admin routes re-check role because API routes bypass the `/admin` layout.

| # | Route | Methods | Auth | Purpose |
|---|---|---|---|---|
| 1 | `/api/auth/setup` | POST | none (self-locking) + rate-limit | Create first admin; 403 once any user exists |
| 2 | `/api/auth/login` | POST | none + rate-limit (IP+email) | Verify creds, set `vk-session` |
| 3 | `/api/auth/logout` | POST | none | Clear cookie |
| 4 | `/api/auth/redeem` | POST | invite code + rate-limit (IP+code) | Redeem → create user → cookie |
| 5 | `/api/auth/account` | PUT | session + rate-limit | Self-service name/email |
| 6 | `/api/auth/password` | POST | session + rate-limit | Self-service password change |
| 7 | `/api/portal/listing` | PUT | session + `canEdit` | Update restaurant listing (whitelisted fields) |
| 8 | `/api/portal/events` | GET/POST/DELETE | mixed | Business-portal events + public date deconfliction |
| 9 | `/api/portal/org` | PUT/POST | session + `canEdit` | Nonprofit profile; nonprofit events via `action` |
| 10 | `/api/portal/needs` | GET/POST/DELETE | mixed | Volunteer shifts + slots stepper + deconfliction |
| 11 | `/api/portal/invites` | GET/POST | admin | List / mint invites |
| 12 | `/api/portal/users` | GET/POST | admin | User list (hash stripped) / admin password reset |
| 13 | `/api/feeds/events` | GET | none, CORS `*` | Public events feed — JSON or iCalendar |
| 14 | `/api/feeds/business/[id]` | GET | none, CORS `*` | One listing + computed `openNow` |
| 15 | `/api/hunts` | GET/POST | **admin** | Hunt list/merge + submissions; hunt CRUD |
| 16 | `/api/hunts/photo` | GET | refs public; `photos/` **admin** | Stream a stored hunt image by sanitized path |
| 17 | `/api/hunts/reference` | POST | **admin** | Attach a stop reference photo (multipart) |
| 18 | `/api/hunts/submit` | POST | none (public by design) | Player photo submission → verified/unverified |
| 19 | `/api/survey` | POST / GET | POST none; **GET admin** | Save response / aggregate summary |
| 20 | `/api/track` | POST | none | Analytics beacon; always `{ok:true}` |
| 21 | `/api/ferry/status` | GET | none | Assembled snapshot the widget polls |
| 22 | `/api/ferry/vessels` | GET | none | Live vessel positions for the map |
| 23 | `/api/ferry/plan` | GET | none | Real sailings + live space for a chosen date |
| 24 | `/api/ferry/observe` | GET/POST | optional token | Record an observation snapshot (cron) |
| 25 | `/api/ferry/accuracy` | GET/POST | optional token | Run + record the accuracy backtest (cron) |
| 26 | `/api/ferry/reminder` | GET | none | Build a sailing `.ics` reminder |
| 27 | `/api/health` | GET | none | Liveness + data-dir writability (503 if not) |
| 28 | `/api/admin/backup` | GET | admin | Whole-`DATA_DIR` JSON backup bundle |
| 29 | `/api/admin/boarding-pass` | GET/POST | admin | Get/set/clear the SR-104 pass override |
| 30 | `/api/admin/content-records` | GET/POST/DELETE | admin | Itineraries/lodging/webcams/restaurants CRUD |
| 31 | `/api/admin/ferry-accuracy` | GET/POST | admin | View/record forecast accuracy |
| 32 | `/api/admin/ferry-info` | GET/POST | admin | Edit the four structured ferry-fact records |
| 33 | `/api/admin/ferry-prediction` | GET/POST | admin | Toggle the prediction feature on/off |
| 34 | `/api/admin/map-features` | GET/POST/DELETE | admin | Map CMS feature CRUD |
| 35 | `/api/admin/map-features/image` | POST | admin | Upload a feature image |
| 36 | `/api/admin/map-views` | GET/POST/DELETE | admin | Map CMS view CRUD |
| 37 | `/api/admin/parking` | GET/POST/DELETE | admin | Parking-zone (MapZone) CRUD |
| 38 | `/api/admin/site` | GET/POST | admin | Copy overrides + page show/hide |
| 39 | `/api/map/[viewId]` | GET | none (draft→admin) | Resolved public map view |
| 40 | `/api/map/image` | GET | none | Serve a feature image (redirect Blob / stream fs) |

**Non-obvious details:**
- **`/api/portal/listing`** — loads the **stored** restaurant, 403 unless `canEdit(user, stored.id)`, merges only whitelisted fields (`weeklyHours` through a strict `parseWeeklyHours`: 7 day keys, ≤ 2 spans/day, `HH:mm` regex, `open !== close`, close < open allowed = past-midnight); **admin-only** fields `name/lat/lng/walkMinutesFromFerry`; re-pins `next.id = stored.id`.
- **`/api/portal/events`** — `?onDate=…[&exclude=id]` is **public** (same data the events page shows); `?ownerId=X` needs `canEdit`. POST/DELETE resolve ownership from `existing.ownerId`.
- **`/api/portal/org`** POST is an action dispatcher (`saveEvent`/`deleteEvent`) so the two portals never collide on one file; nonprofit events set both `charityId` and `ownerId` to the org and re-check `canEdit(existing.ownerId ?? charityId)`.
- **`/api/portal/needs`** — `{action:"slots", id, delta:±1}` clamps `slotsFilled` to `0..slotsTotal`; bare `YYYY-MM-DD` anchored at Pacific midnight.
- **`/api/feeds/events`** — CORS `*`, `s-maxage=300`; filters to not-yet-finished; `?format=ics` emits RFC-5545 (UTC stamps, TEXT escaping, 75-octet code-point-safe folding). Public projection omits `ownerId`/`charityId`. **`/api/feeds/business/[id]`** returns server-computed `openNow`/`openLabel` (the anti-drift mechanism for a business's own site); consumed by `public/embed/kingston-events.js` (self-removing IIFE).
- **`/api/track`** — reads raw text (sendBeacon posts `text/plain`), always returns `{ok:true}`; drops `/admin` paths; enforces the geo-ping privacy box (lat 47.5–48.1, lng −123.0–−122.2), rounds to 3 decimals, classifies into an area — *nothing finer ever reaches the store*; IP peeked only to label loopback/RFC-1918 as `dev-local`, never stored.
- **Hunts group** carries a **stale** in-code warning ("local-only … NO auth on these endpoints") — the app is now deployed to Render, so these are effectively public write/read endpoints (§13, inconsistencies).

---

## 10. Pages — all 33 with rendering mode

`export const revalidate = 60` → ISR-60; `dynamic = "force-dynamic"` → per-request; `generateStaticParams` where present. `/admin/map` declares both `revalidate=60` and `force-dynamic` (dynamic wins).

| Route | Mode | Data deps / notes |
|---|---|---|
| `/` | ISR-60 | ferry snapshot, weather, tides, event-store, side; hero + live strip (`<NextFerries/>`), side-switcher, planning callout (prediction-gated) |
| `/ferry` | ISR-60 | ferry snapshot, kitsap, ferry-info, prediction access; `<NextFerries/>`, vessel + SR-104 maps, webcams box, boarding-pass line, "how busy today" (gated) |
| `/ferry/plan` | ISR-60 | wsf schedule; renders `<FerryPlanner/>` (client) |
| `/eat` | ISR-60 | business-store; curated groups, `<OpenBadge/>`, `<NearMe/>`, per-card JSON-LD; drops `hidden` |
| `/events` | ISR-60 | event-store; weekend + month grouping; midnight = "All day" |
| `/give` | ISR-60 | charity-store, event-store; shifts + deconfliction calendar |
| `/map` | ISR-60 | map-store views; `<FeatureMap/>` view switcher |
| `/parking` | ISR-60 | parking-store (MapZone), ferry-info; `<FeatureMap/>` / town map + confidence-badged zone cards. (No ATM section — removed.) |
| `/about` | ISR-60 | — | LTAC/JLARC explainer, tracking-honesty table, `<VisitorSurvey/>` |
| `/itineraries` | ISR-60 | itinerary-store | cards |
| `/itineraries/[slug]` | force-dynamic | itinerary-store | timeline; `notFound()` |
| `/stay` | ISR-60 | listing-stores (lodging) | Airbnb/VRBO search deep-links only |
| `/webcams` | ISR-60 | listing-stores (webcams) | static shell; liveness in `<WebcamGrid/>` |
| `/hunt` | force-dynamic | hunt-store | admin-created hunts appear immediately |
| `/hunt/[slug]` | force-dynamic | hunt-store | maps `StoredHunt`→`PlayerHunt`; `generateMetadata` |
| `/portal` | force-dynamic | auth | redirects to setup when no users; login/dashboard |
| `/portal/setup` | force-dynamic | auth | redirects once users exist |
| `/portal/account` | force-dynamic | auth | self-service profile/password |
| `/portal/join` | static | — | invite redemption form |
| `/portal/business` | force-dynamic | auth, business-store | admins see all; businesses their `linkedIds` |
| `/portal/business/[id]` | force-dynamic | auth, business/event stores | `canEdit` redirect; `<BusinessEditor/>` |
| `/portal/nonprofit` | force-dynamic | auth, charity-store | mirror of business list |
| `/portal/nonprofit/[id]` | force-dynamic | auth, charity/event stores, time | `<NonprofitEditor/>` |
| `/portal/syndicate` | force-dynamic | auth, stores, `headers()` | feeds + platform checklist + prewritten posts |
| `/admin` | force-dynamic | analytics-store, survey-store | Visitor Insights dashboard |
| `/admin/accounts` | force-dynamic | auth, business/charity stores | re-checks role; strips hashes; `<AccountsManager/>` |
| `/admin/content` | force-dynamic | site-store, registry | CMS text + page show/hide |
| `/admin/ferry-info` | force-dynamic | ferry-info/prediction/boarding-pass stores | structured facts + prediction toggle + pass override |
| `/admin/hunts` | force-dynamic | hunt-store | hunt cards + submissions + `<HuntEditor/>` |
| `/admin/itineraries` | force-dynamic | itinerary-store | `itineraries/editor.tsx` |
| `/admin/listings` | force-dynamic | business/listing stores | restaurants (add/hide) + lodging + webcams |
| `/admin/map` | force-dynamic | parking-store | leaflet-geoman polygon editor |
| `/admin/maps` | force-dynamic | map-store | general map builder |

Layout (`src/app/layout.tsx`): fonts + `<CopyProvider overrides>` wrapping `<Tracker/>` + nav + `<main>` + footer; overrides loaded via `getCopyOverrides()`.

---

## 11. Client-component islands

All in `src/components/` unless noted; each is client only for a browser reason.

- **`tracker.tsx`** — `usePathname`, `sessionStorage`, `sendBeacon`. `Tracker` (one pageview per path, skips `/admin`), `trackOutbound`, `OutboundLink` (backs `ui.tsx`'s `ExternalLink`). Session id `vk-sid` with in-memory fallback.
- **`next-ferries.tsx`** — the home/ferry live widget (replaces the old "ferry-board"). Props: server-fetched `FerryStatusSnapshot` + `serverNow` + `side` + `tone` (light/dark). Per direction: delay, next sailings with live countdown and open car spots, alert banner, boarding-pass indicator, `.ics` reminder link. Polls `/api/ferry/status` every 60 s (paused while `document.hidden`), countdown ticks 20 s; keeps last good data on poll failure.
- **`ferry-planner.tsx`** (page-local, `src/app/ferry/plan/`) — the planner. State: date, time, `Direction`, `TravelMode`. Recomputes the forecast **entirely client-side** via `ferry-forecast`; changing the date fetches `/api/ferry/plan` to snap to real sailings + show live space. Renders `<Trendline/>` + `<LevelLegend/>` (from `ferry-trendline.tsx`) and an "arrive by" recommendation.
- **`ferry-busy-today.tsx`**, **`ferry-prediction-banner.tsx`**, **`ferry-trendline.tsx`** — the "how busy today" panel, the estimate/admin-preview banner, and the SVG trendline (colors are raw hex — SVG can't reliably use CSS vars).
- **`ferry-vessel-map.tsx`**, **`sr104-traffic-map.tsx`**, **`ferry-webcams-box.tsx`** — Leaflet vessel map (polls `/api/ferry/vessels`), the WSDOT SR-104 traffic map, and the ferry-webcams box.
- **`feature-map.tsx`** — the public map CMS renderer. Leaflet (dynamically imported), fetches `/api/map/[viewId]`, draws the view's features + built-in layers (restaurants/parking zones/streets); a published-view switcher; Street View deep links.
- **`near-me.tsx`** — geolocation. `NearMePlace[]` (serializable Restaurant subset). State `idle→locating→ready|denied|error`; one `getCurrentPosition` per tap; sorts by client haversine; sends at most one geo-ping (a `useRef` latch), coords rounded before leaving the device.
- **`hunt-player.tsx`** — geolocation + camera + localStorage. `PlayerHunt`. Three state machines: `CheckState (idle|locating|too-far|confirmed|gps-unavailable)`, `UploadState (idle|uploading|failed)`, persisted `StopStatus (verified|unverified|offline|honor)`. Stops unlock sequentially; POSTs multipart to `/api/hunts/submit`; "Mark complete anyway" → `offline`; no-photo escape → `honor`. Progress in `vk-hunt-<id>` / `vk-hunt-<id>-status`.
- **`open-badge.tsx`** (`OpenBadge`/`OrderTimingNote`) — browser clock; renders nothing until mounted, re-runs `getOpenStatus` every 60 s.
- **`webcam-grid.tsx`** — timers + `<img>` error handling; cache-busts on each cam's `refreshSeconds`; offline placeholder + auto-retry.
- **`visitor-survey.tsx`** — localStorage step machine `distance→overnight→details→done`; "local" short-circuits; `vk-survey-done` so the visitor is never re-asked.
- **`site-nav.tsx`** — `usePathname` active states + "More ▾" desktop dropdown + mobile bottom sheet; filters hidden pages.
- **`side-switcher.tsx`** — §7.
- **`copy-context.tsx`** `EditableText`/`useCopy` — §8.1.
- **Portal editors:** `portal/forms.tsx` (login/setup/join), `portal/business/[id]/editor.tsx` (`BusinessEditor` — details/hours/events, hours editor + live preview, save stamps `hoursVerified=today`, deconfliction effect), `portal/nonprofit/[id]/editor.tsx` (`NonprofitEditor` — profile, shifts with ±1 stepper, events), `components/portal/hours-editor.tsx` (`HoursEditor` — ≤ 2 spans/day, "Copy Monday to all weekdays", non-blocking "past midnight" badge via `weeklyHoursIssues`).
- **Admin editors** (in `src/app/admin/*`): `accounts/manager.tsx` (accounts, invites, password reset shown-once), `content/manager.tsx` (copy + page toggles), `ferry-info/editor.tsx` + `override-control.tsx` + `prediction-control.tsx`, `hunts/editor.tsx` (numeric fields held as strings, client-mirror validation, reference-photo upload after auto-save), `itineraries/editor.tsx`, `listings/editor.tsx`, `map/editor.tsx` (geoman parking polygons), `maps/editor.tsx` (general map builder — draw markers/lines/trails/areas, assign to views, upload images).
- **`components/ui.tsx` is server-safe** (its only client dependency is delegated to `OutboundLink`); **`json-ld.tsx`** is a server component emitting schema.org `Restaurant` with per-span `OpeningHoursSpecification` and `<` escaping.

---

## 12. Algorithms

### 12.1 Hours engine — `hours.ts`
Pure. `getOpenStatus(weekly, now)`: (1) Pacific wall clock via `Intl.formatToParts` (weekday index + minutes-since-midnight — no local Date math). (2) Today's spans: a `crossesMidnight` span (`close <= open`) matches when `minutes >= open`; else half-open `open <= minutes < close`. (3) Yesterday's past-midnight tail (`(dayIndex+7)%7`, crossing span matches `minutes < close`) — keeps "closes 1 am" showing at 12:30 am. (4) Next-open scan 0..6 days with today/tomorrow/weekday grammar; empty week → "Closed". Consumers: `OpenBadge`, the business feed `openNow`, NearMe rows, the portal preview.

### 12.2 Haversine + GPS verification — `hunt-store.ts`
6 371 000 m sphere (`haversineMeters`; duplicated in `hunt-player.tsx`/`near-me.tsx` which can't import the server module). `saveSubmission`: `verified = coords finite && haversine ≤ radiusMeters`; `radiusMeters` clamped 20..1000 (default 100); missing GPS still saves `verified:false` (honor system); `distanceMeters` stored rounded.

### 12.3 Deconfliction — Pacific date keys
`eventsSharingDate` (event-store) uses `pacificDateKey(iso)`: a naive datetime-local string (no offset) is sliced (`iso.slice(0,10)`), an offset/`Z` string is reformatted via `Intl` in Pacific — so both the portal's wall-time strings and any offset-carrying ISO bucket correctly. `/give` and analytics use the same Intl-based day key. Portals surface conflicts *before commit* as an informational callout.

### 12.4 Area classification — `analytics-store.ts`
`classifyArea(lat,lng)`: linear scan over six axis-aligned boxes around downtown Kingston, **first match wins** (list ordered specific-before-broad; boxes overlap). Miss → `outside-uga`. Inputs already `roundCoord`ed to 3 decimals.

### 12.5 Ferry busyness scoring
`scoreAt` blends the calibrated hourly curve × season × holiday with the empirical table (weighted by sample count, gated at 3 samples, capped at 0.75 weight, holidays excluded). Accuracy backtests heuristic-only vs observed fullness. See §6.

### 12.6 Boarding-pass midnight lapse
`pacificDayString(now)` produces `YYYY-MM-DD` from typed Intl parts (locale-independent). An override stamped with that day is honored only while it still equals today's Pacific day — so it lapses at the next Pacific midnight with **no timer and no DST math**. The same day-key idiom scopes the observation aggregate cache and empirical buckets.

### 12.7 Street-parking overlay — `scripts/gen-street-parking.py`
Offline pipeline → `public/geo/street-parking.json` (segments classified free-2hr/free-unrestricted/prohibited/ferry-holding/default, plus a UGA boundary). Overpass highways ∩ Census CDP point-in-ring; exact-name rules then per-street midpoint thresholds; rules trace to the 2015/2016 county study. `feature-map.tsx`/town map fetch it at runtime so the JS bundle stays lean (fetch failure → base map still works). Regeneration is manual; the JSON is committed.

---

## 13. Security posture & pre-public hardening remaining

**Path sanitization** — `hunt-store.ts getPhotoAbsolutePath` (rejects non-string / > 400 chars / null bytes / backslashes / absolute / `~` / `.`/`..` segments / non-whitelisted ext; re-verifies the resolved path is inside `.data/hunts`) and `map-store.ts featureImagePath` (sha1-name pattern only). `isSafeId` (`^[a-z0-9][a-z0-9_-]{0,63}$/i`) gates every id-that-becomes-a-path-segment.

**Uploads** — 8 MiB cap (413), MIME/ext whitelist (415), empty-file rejection; stored filenames server-generated. No total-disk quota on submissions.

**Secrets** — `AUTH_SECRET`/`WSDOT_API_KEY`/`SETUP_TOKEN` server-side (WSDOT key rides in server-only URLs); `NEXT_PUBLIC_SITE_URL` intentionally public (build-time).

**Injection** — Leaflet popups escape data; the embed writes only `textContent`; JSON-LD escapes `<`; ICS escapes per RFC 5545; the reminder route echoes nothing from the query string.

**Intentionally unauthenticated** (by design): the public feeds (CORS `*`), the `?onDate=` deconfliction lookups, `/api/track` POST, `/api/survey` POST, `/api/ferry/{status,vessels,plan,reminder}`, `/api/hunts/submit`. `/api/ferry/{observe,accuracy}` have an *optional* `FERRY_OBSERVE_TOKEN`.

**Done (July 2026):**
- **Hunt admin API gated** — `/api/hunts` (GET + POST), `/api/hunts/reference`, and submission-photo reads (`/api/hunts/photo?p=photos/…`) now require an admin session via `requireAdmin()`. Reference photos (`refs/…`) stay public so players see "what you're looking for"; `/api/hunts/submit` stays open by design.
- **`secure` session cookie** in production (see the cookie note above).

**Pre-public hardening remaining:**
1. CSRF tokens for portal mutations (current mitigation: `sameSite=lax` + JSON bodies).
2. Consider invite expiry and admin-visible session revocation.
3. Private-blob follow-up: in the Vercel/Blob config, submission images live in a *public* blob store, so their URLs are unguessable-but-public — move submissions to a private store or signed URLs if that deployment shape is used. (Not an issue on the current Render/filesystem deployment, where `/api/hunts/photo` gates them.)
5. In file mode on a single instance the overlay writes are read-modify-write with no locking (last-write-wins) and the rate limiter is per-instance — both correct for the single-instance Render deploy, both wrong the moment a second instance exists (move to the DB + Upstash backends first). *(E05 resolves the write half: overlay writes are now Postgres upserts. The per-instance rate limiter concern stands until Upstash is configured.)*

**Privacy posture** (a feature): no visitor cookies beyond side/session, no IPs stored, geo-pings opt-in + bounded + rounded + area-bucketed server-side, survey PII-free, `/admin` traffic never tracked (client skip + server drop), the survey aggregate GET now admin-gated.

---

## 14. Testing status (honest)

**There is no automated test suite.** No `*.test.*`/`*.spec.*` files, no test runner in `package.json` (scripts are `dev/build/start/lint`, `db:setup`, `db:migrate`), no CI test job. The GitHub workflows that exist are the ferry-observe/accuracy crons, not tests.

**How it has actually been verified** (manual): curl smoke flows against a dev server (auth lifecycle, portal field policies + ownership 403s, feeds JSON/ICS/CORS, hunt submit with/without coords, `/api/track` edges, `/api/health`); preview/browser checks of the client islands (ferry widget polling + tab-pause, planner recompute, webcam refresh, hunt player on a phone, hours-editor↔badge agreement, the maps + Street View panel); `tsx` one-offs for the pure engines (`getOpenStatus` span shapes + DST, `pacificWallTimeToISO`, `scoreAt`/`dayCurve`); `next build` + `eslint` as the standing static gate. Data files carry their own verification discipline in dated comments.

**What a proper suite should cover first** (highest value ÷ risk, all pure or near-pure):
1. **Hours engine** — every span shape (normal/split/past-midnight/yesterday-tail), next-open grammar, empty week, PST vs PDT.
2. **Auth token** — sign/parse round-trip, expiry, tamper (payload swap, sig truncation, wrong secret), length-mismatch safety, password hash/verify malformed strings.
3. **Store merge** (`json-store`) — overlay-wins-by-id, tombstone hides seed + overlay rows, `_deleted` stripped, corrupt-file → seed-only, DB `readOverlay` reconstructing `_deleted`.
4. **Ferry forecast** (`ferry-forecast`) — curve/season/holiday scoring, `scoreToLevel` bands, the empirical blend gate (min-samples, weight cap, holiday exclusion), `dayCurve` plateau windows, `empiricalBucketKey` stability.
5. **ICS output** (`feeds/events`, `ferry-reminder`) — TEXT escaping, UTC stamps, 75-octet folding, injection safety.
6. **`canEdit` matrix** across routes (events `ownerId`, needs `charityId`, org events `ownerId ?? charityId`, listings, invite `linkedIds` validation, admin-only fields).
7. Next tier: `getPhotoAbsolutePath` adversarial paths, `/api/track` validation table (bounds/rounding/`/admin` drop), `classifyArea` ordering, `parseWeeklyHours`, `parseWaitHours`, `pacificDayString`/override lapse, `isPlannableDate` overflow rejection.

---

## Appendix: file map (orientation)

```
src/lib/types.ts                    domain model (§2; Atm/ParkingArea LEGACY)
src/lib/map/types.ts                map CMS domain (§2, §8.3)
src/lib/{data-dir,blob-store,rate-limit}.ts   image/rate seams (§3.1; db.ts deleted by E05)
src/lib/db/records.ts               E05 audited zod write choke point (all structured writes)
src/lib/stores/json-store.ts        seed+overlay core (§3.2; E05: thin delegate over db/records.ts)
src/lib/stores/*                    12 store modules (§3.3)
src/lib/auth/                       auth (§4; E06: tokens/authz/identity/session + roles)
src/lib/page-visibility.tsx         page show/hide gate (§4.8)
src/lib/wsf.ts | kitsap.ts | weather.ts | tides.ts   external adapters (§5)
src/lib/ferry-status.ts             assembled snapshot (§5.5)
src/lib/ferry-forecast.ts           pure busyness model (§6.1)
src/lib/ferry-line.ts               SR-104 staging routing (§6.4)
src/lib/ferry-reminder.ts           .ics reminders (§6.5)
src/lib/{side,side-server}.ts       side-of-water mode (§7)
src/lib/{time,hours}.ts             Pacific time + open/closed engine (§5.6, §12.1)
src/lib/site-copy-registry.ts       91 editable copy blocks (§8.1)
src/lib/copy-context.tsx            EditableText / useCopy for client comps (§8.1)
src/lib/map/resolve.ts              ResolvedMapView builder (§8.3)
src/lib/data/*                      seed data (parking.ts has MapZone + legacy ParkingArea)
src/lib/db/schema.ts + db/migrations/   E05 Drizzle schema (record/audit/quarantine + append tables)
src/app/**                          33 pages + 40 API route files (§9, §10)
src/components/** + src/app/**/*editor.tsx   client islands (§11)
scripts/gen-street-parking.py       street overlay generator (§12.7)
public/embed/kingston-events.js     self-removing events widget (§9)
.data/                              images/hunt photos since E05 (§3.4, gitignored)
```
