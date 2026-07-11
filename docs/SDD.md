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

- **Dual-backend persistence seam (§3) — the central architectural fact.** Every store branches on env presence; nothing above the store modules changes. Local / persistent-disk hosts write JSON/JSONL under `DATA_DIR` (default `.data/`); on Vercel-style serverless the same stores use Neon Postgres, Vercel Blob, and Upstash Redis, all auto-detected. **Phase 1 (filesystem) is the live production home** (Render, `/data` disk).
- **Self-hosted auth (§4).** Invite-based accounts, scrypt password hashes, stateless HMAC-signed session cookies, rate-limited login/setup/redeem, self-service and admin password flows. No third-party auth.
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
| `DATA_DIR` | persistent-volume path (Phase 1) | e.g. `/data`; not set on Vercel |
| `DATABASE_URL` | Neon Postgres (Phase 2) | pooled URL (host has `-pooler`) |
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
- **Auth** — `User`/`InviteCode`/`Role` (`src/lib/auth.ts`, §4).
- **Hunt store** — `StoredHunt`/`StoredHuntStop`/`AdminHunt`/`HuntSubmission` (`src/lib/hunt-store.ts`, §3).
- **Analytics/survey** — `AnalyticsEvent`/`AnalyticsGeo`/`AreaBox`/`AnalyticsSummary` (`analytics-store.ts`), `SurveyStore`/`SurveySummary` (`survey-store.ts`).
- **Side** — `WaterSide` (`src/lib/side.ts`, §7).

---

## 3. Persistence design — the central update

The app was file-only; it now runs on a **dual-backend seam** auto-selected by env presence. The store *interfaces* are the contract; the I/O behind them is an implementation detail sized for one node or for cloud stores. Nothing above the store modules branches.

### 3.1 The seam files

| File | `hasX()` gate | File-mode backend | Cloud backend |
|---|---|---|---|
| `data-dir.ts` | — | `dataDir()` = `$DATA_DIR` (resolved) or `<cwd>/.data`; `dataPath(...segs)` joins | (paths unused when a cloud store handles the domain) |
| `db.ts` | `hasDb()` = `DATABASE_URL` set | — | Neon Postgres via `neon()` (stateless HTTP tagged-template). `db()` throws if unset (callers gate on `hasDb()`). `ensureSchema()` lazily + idempotently creates tables (memoized per warm process; a failed setup clears the memo so the next call retries). |
| `blob-store.ts` | `hasBlob()` = `BLOB_READ_WRITE_TOKEN` set | image bytes written under `.data/…` by the domain store | `putImage(key, bytes, type)` → Vercel Blob (public, `addRandomSuffix`) returns the full CDN URL. Callers store the returned **string** and hand it to `<img src>` — either a full https blob URL (prod) or a relative name the app's image routes serve (dev), *no branch in callers*. |
| `rate-limit.ts` | `hasUpstash()` = `UPSTASH_REDIS_REST_URL` set | in-process `Map` sliding window (correct only for a single instance) | Upstash Redis shared sliding window (correct across replicas/lambdas). `checkRateLimit(key,{limit,windowMs})` + `clientKey(req,bucket)` are identical across backends. |

**Legacy DB schema (`db.ts` `SCHEMA_STATEMENTS`, lazily self-created; superseded since E05 by `src/lib/db/schema.ts` + generated `db/migrations/`):** four tables.
- `overlay(store text, id text, doc jsonb, deleted boolean, PRIMARY KEY(store,id))` — backs **every** seed+overlay collection **and auth** (`store='auth-users' | 'auth-invites'`). `deleted` carries the `{_deleted:true}` tombstone.
- `analytics_event(ts, event jsonb)`, `survey_response(ts, response jsonb)`, `ferry_observation(ts, obs jsonb)` — append-only logs.

### 3.2 The backend-agnostic overlay store — `src/lib/stores/json-store.ts`

The ~75-line core all portal-editable data sits on:

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

**Auth files** live in the SAME overlay table in DB mode (`store='auth-users'`, `store='auth-invites'`; invites keyed by their code in the `id` column) or in `.data/auth/{users,invites}.json` in file mode. `auth.ts` branches on `hasDb()` per call.

**Append paths** (all dual-backend, all fail-soft, corrupt lines skipped):
- **Analytics** — `analytics-store.ts` → `.data/analytics/events.jsonl` or `analytics_event`. `summarize()` re-reads and re-aggregates the whole log per call ("fine at Kingston scale").
- **Survey** — `survey-store.ts` → `.data/ltac-responses.jsonl` or `survey_response`. Pluggable behind a `SurveyStore` interface (`save`, `summarize` — aggregate counts only, never raw rows) with a single exported `surveyStore` instance.
- **Ferry observations** — `ferry-observations.ts` → `.data/ferry/observations.jsonl` or `ferry_observation`. Throttled to one write per 10 min per process; 90-day retention pruning; a 10-min aggregate cache.

### 3.4 The `.data/` tree (file mode)

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

Every writer `mkdir`s its parent recursively; a fresh file-mode checkout needs nothing but `AUTH_SECRET`. `/api/health` probes that `dataDir()` is writable (§9).

### 3.5 Hunt store — `src/lib/hunt-store.ts`

Server-only (touches the filesystem; `import type` is fine anywhere). Dual-backend like the rest:
- **Custom hunts** → overlay store `custom-hunts` (DB) or `.data/hunts/custom-hunts.json` (file). `getAllHunts` merges seed with custom (custom wins by id, tagged `source:"custom"`; custom-only appended). No tombstones — hunts are never deleted through the app.
- **Submissions** → overlay store `hunt-submissions` (DB) or `.data/hunts/submissions.jsonl` (file). `HuntSubmission` now carries an optional `id` (overlay key on DB rows; legacy file rows may lack it).
- **Photos** → Blob in prod (`putImage`), `.data/hunts/{refs,photos}/…` in dev.
- `saveHunt` re-validates ids (`isSafeId` — ids become path segments), rejects slug collisions across the merged set, preserves a stop's existing `referencePhoto` when omitted, and only keeps an incoming `referencePhoto` if it passes sanitization and starts with `refs/`. `saveReferencePhoto` materializes a seed hunt into the custom store so the pointer has somewhere to live. `saveSubmission` computes `verified` (§12.2) and appends. `getPhotoAbsolutePath`/`readPhoto` do strict path sanitization (§13). `MAX_PHOTO_BYTES = 8 MiB`; images jpeg/png/webp/heic.

### 3.6 Migration path

`scripts/migrate-to-db.mjs` (run directly: `node --env-file=… scripts/migrate-to-db.mjs`) copies a populated `.data/` into a Neon database; since E05 the tables come from checked-in Drizzle migrations (`db/migrations/`, generated from `src/lib/db/schema.ts`, applied at boot or via `npm run db:migrate`). `/api/admin/backup` streams the whole `DATA_DIR` as a JSON bundle for off-site backup (restore via `scripts/restore-backup.mjs`).

---

## 4. Authentication & authorization (`src/lib/auth.ts`)

Self-hosted, server-only (node:crypto + fs + `next/headers`). Invite-based accounts, scrypt hashes, stateless HMAC cookies. Dual-backend (`hasDb()` per call).

### 4.1 Passwords
- `hashPassword`: 16-byte hex salt, `scryptSync(pw, salt, 64)`, stored `scrypt$<salt>$<hash>`.
- `verifyPassword`: splits on `$`, requires scheme `scrypt`, recomputes, `timingSafeEqual` after a length check. Any malformed value → `false`.

### 4.2 Session token — stateless HMAC cookie
- **Format:** `base64url(JSON{uid,exp}) + "." + base64url(HMAC-SHA256(payload, AUTH_SECRET))`. `exp` = `Date.now() + 30 days`.
- **Verify** (`parseSessionToken`): split on `.`; recompute; length-guarded `timingSafeEqual`; parse; enforce `exp >= now`. No server-side session list.
- **Cookie** (`sessionCookie`): name **`vk-session`**, `httpOnly`, `sameSite:"lax"`, `path:"/"`, `maxAge` 30 days, and `secure` in production (`NODE_ENV==="production"` → the `Secure` attribute; off in dev so `http://localhost` login works).
- `getSessionUser()` reads the cookie, parses, and looks the uid up in the live user list — so **deleting a user invalidates their outstanding tokens** despite statelessness.
- `secret()` **throws** if `AUTH_SECRET` is missing — auth cannot run unsigned.

### 4.3 Role model & `canEdit`
`Role = "business" | "nonprofit" | "admin"`. `User.linkedIds` = the restaurant/charity ids the account manages. The single authz primitive:

```ts
export function canEdit(user: User, id: string): boolean {
  return user.role === "admin" || user.linkedIds.includes(id);
}
```

Admins edit everything; others exactly their linked ids. No finer grain anywhere.

### 4.4 Invite lifecycle
1. **Mint** (`POST /api/portal/invites`, admin): 12-hex code, validated `linkedIds` against the *real* stores; admin invites forced `linkedIds:[]`; note ≤ 200 chars.
2. **Redeem** (`POST /api/auth/redeem` → `redeemInvite`): unused code required; creates the user (email unique, case-insensitive) and marks `usedBy`. One-time; used codes kept as an audit record. Invites don't expire.
3. `/admin/accounts` generates a paste-ready join blurb.

### 4.5 First-run bootstrap
- `POST /api/auth/setup` creates the **first** account (hard-coded `role:"admin"`, `linkedIds:[]`); 403 once `hasAnyUsers()`.
- `/portal/setup` UI redirects to `/portal` once users exist; `/portal` redirects to `/portal/setup` while none.
- **`/admin` no-users grace** (`src/app/admin/layout.tsx`): one server layout gates everything under `/admin` — role `admin` → allowed; **zero users → allowed with a loud amber banner** (so a fresh install can bootstrap); anyone else → `redirect("/portal")`.

### 4.6 Self-service & admin password flows (added since v1)
- **`PUT /api/auth/account`** — self-service profile (name/email; email uniqueness enforced), session-gated, rate-limited (`profile`, 10/window). Backs `/portal/account`.
- **`POST /api/auth/password`** — self-service password change (`changeOwnPassword` verifies the current password; new ≥ 8 chars), session-gated, rate-limited (`pwchange`, 5/window per IP and per user).
- **`POST /api/portal/users`** with `{action:"reset-password", userId}` — admin resets to a random temp password (`adminResetPassword`) returned **once** (`{ok, tempPassword}`); hashes are one-way, so a lost temp requires another reset.

### 4.7 Rate limiting (§3.1 `rate-limit.ts`)
Login, first-run setup, and redeem are rate-limited (8/60 s default; setup 5), keyed by IP (`clientKey`) **and** by account dimension (`login:<email>`, `redeem:<code>`) so IP spoofing can't fully escape. Profile/password changes limited too. Upstash-shared in cloud mode, per-instance Map otherwise.

### 4.8 Page-level visibility gating (`src/lib/page-visibility.tsx`)
Public pages call `await assertPageVisible("/hunt")` at the top of their server component. Hidden page + visitor → `notFound()` (clean 404); hidden page + admin → renders with `<HiddenPageBanner/>` for preview. `HIDEABLE_PAGES` (11 paths — ferry, eat, events, itineraries, stay, parking, webcams, map, give, hunt, about) is the single source of truth shared by the admin UI and the nav filter. Home, portal, admin, and api are deliberately not hideable.

### 4.9 Defense in depth
The layout gate is not trusted alone: every `/api/portal/*` and `/api/admin/*` route independently calls `getSessionUser()` and re-checks role/ownership from the **stored** record; `/admin/accounts` re-checks role and strips `passwordHash` before serializing to the client. Portal `[id]` pages redirect server-side on `!canEdit`.

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
5. In file mode on a single instance the overlay writes are read-modify-write with no locking (last-write-wins) and the rate limiter is per-instance — both correct for the single-instance Render deploy, both wrong the moment a second instance exists (move to the DB + Upstash backends first).

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
src/lib/{data-dir,db,blob-store,rate-limit}.ts   the persistence seam (§3.1)
src/lib/stores/json-store.ts        seed+overlay core, dual-backend (§3.2)
src/lib/stores/*                    12 store modules (§3.3)
src/lib/auth.ts                     auth, dual-backend (§4)
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
src/lib/db/schema.ts + db/migrations/   E05 Drizzle schema (legacy overlay + append tables: §3.1)
src/app/**                          33 pages + 40 API route files (§9, §10)
src/components/** + src/app/**/*editor.tsx   client islands (§11)
scripts/gen-street-parking.py       street overlay generator (§12.7)
public/embed/kingston-events.js     self-removing events widget (§9)
.data/  (file mode)                 all mutable state (§3.4, gitignored)
```
