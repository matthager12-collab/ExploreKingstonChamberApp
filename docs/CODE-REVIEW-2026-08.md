# Code review — August 2026

**Date: 2026-08-07 · Baseline: `main` @ d6d73e0 · Status: findings, not yet applied**

A seven-dimension review of the current build (core domain logic, API routes,
performance, simplification, Next.js 16 usage, security, test coverage). Every
finding below survived an independent adversarial verification pass that
re-read the cited code and rejected roughly 40% of the raw claims; severities
were corrected where the verifier found them overstated.

Baseline at review time: typecheck clean, eslint 0 errors / 88 warnings,
dependency-boundary check clean, 2,220 unit tests passing (server suite not
run — requires Docker). So none of this is caught by the existing gates.

Companion documents: [STATUS-2026-08.md](STATUS-2026-08.md) (state vs. plan),
[COMPLETION-PLAN.md](COMPLETION-PLAN.md) (forward plan). Roadmap-level quality
items live in [ROADMAP-V2.md](ROADMAP-V2.md); this review supersedes its
"suspected" test-coverage list with verified gaps.

## Summary

| Severity | Count | Read as |
|---|---|---|
| High | 3 | fix before or alongside the next feature work |
| Medium | 20 | schedule deliberately; several gate planned features |
| Low | 22 | batch opportunistically |

| Dimension | High | Med | Low |
|---|---|---|---|
| Core domain logic | 1 | 4 | 5 |
| Performance | 2 | 3 | 2 |
| API routes | 0 | 2 | 5 |
| Next.js 16 usage | 0 | 2 | 3 |
| Security | 0 | 2 | 2 |
| Simplification & duplication | 0 | 3 | 4 |
| Test coverage | 0 | 3 | 2 |


## High severity

### Admin takedown leaves seed-backed listings publicly visible

**`src/lib/moderation.ts:307`** · Core domain logic

takedownLiveRecord promises to "pull it from every public surface now" but hides nothing for any record that exists in the git-checked seed arrays (restaurants, lodging, webcams, charities, events, itineraries — the bulk of the content). Both branches set status='pending' on an overlay row (setRecordStatus at line 307, or writeOverlayRecord at line 311). But the public merge readMergedRecords (src/lib/db/records.ts:131-142) fetches only status='live' overlay rows and seeds the map with ALL seed records — a non-live overlay row simply doesn't participate, so the seed doc remains in the output. Result: an admin taking down an objectionable seeded listing (in the seed-only case, the very doc they wanted removed) sees the worklist item resolve as 'taken_down' while the listing keeps serving publicly. Only overlay-only records (member-created, no seed) actually disappear. No test covers the seeded case.

**Fix:** For takedown, write a tombstone that preserves the doc — writeOverlayRecord(store, { ...doc, _deleted: true }, meta) — which the merge already honors regardless of seed (records.ts filters _deleted after overlay-wins-by-id). Re-publish is then an admin save of the preserved doc (the audit row retains it). Alternatively, teach readMergedRecords to also fetch status='hidden' rows and let them shadow seed ids (while 'pending' keeps its current non-shadowing semantics, which member edit-holds rely on), and have takedown use 'hidden'. Add a test: seed record + takedown → absent from readMerged.

### Home and /ferry are cookie-dynamic, so their declared ISR (revalidate=60) is inert and every ferry-burst request is a full server render

**`src/app/(site)/(home)/page.tsx:73`** · Performance

Both `/` and `/ferry` call getSide() (src/lib/side-server.ts:10 reads cookies()), and per the bundled Next 16 docs (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md:69) any cookies() read in a page opts the whole route into dynamic rendering. So the `export const revalidate = 60` on both pages does nothing — the /ferry comment at src/app/(site)/ferry/page.tsx:48-50 ('Regenerate at most once a minute') is factually wrong, and src/components/site-chrome.tsx:46-48 admits both are 'genuinely per-request'. tests/server/static-rendering.test.ts confirms neither route is in MUST_BE_STATIC. Cost per request on `/`: ~10 Neon round trips (getEvents, getCopyOverrides, getEffectiveHiddenPaths, getFerryPredictionEnabled, getPhotoContext x2 stores, getEffectiveBoardingPass, plus SiteChrome's two reads) through a pg Pool capped at max:5 (src/lib/db/client.ts:51). Ferry-burst scenario: 200 phones hitting `/` in the same minute ≈ 2,000 queries queued on 5 connections plus 200 full React renders on one Render instance — multi-second p95 exactly when the site's pitch is 'instant on the dock'. The repo already solved this for /line by hardcoding side and keeping cookies out (src/components/line-lander.tsx:10-13); / and /ferry, the two highest-traffic pages, never got the same treatment.

**Fix:** Make `/` and `/ferry` genuinely ISR the same way /line and simple-mode already are: drop getSide() from the server render (default to kingston), and resolve the side client-side — a small client component reads the vk-side cookie/localStorage and swaps the few side-dependent strings after hydration, or render both variants and toggle with CSS on a data-side attribute like simple mode's data-simple. Alternatively adopt Next 16 cacheComponents/PPR and push the getSide() read into a Suspense-wrapped leaf so the shell stays cached. Also correct the stale 'Regenerate at most once a minute' comment on /ferry, and raise the pool max (Neon's pooler easily handles 10-20) as a belt-and-braces measure.

### getEmpiricalBusyness() full-scans ~52k observation rows in JS on /ferry's per-request path; its cache is invalidated every ~10 minutes

**`src/lib/stores/ferry-observations.ts:174`** · Performance

getEmpiricalBusyness() reads every ferry_observation row in the 90-day retention window (readFerryObservations transfers and parses each JSONB row) and aggregates in JS. At ~4 rows per 10-min snapshot that is ~50k rows, and the repo's own comment (src/components/line-lander.tsx:15-17) measures it at '5-8s warm-prod worst case'. The 10-minute aggCache (line 40, 175) does not save you: recordSailingSpaceSnapshot() sets aggCache = null on every successful snapshot write (line 155), and snapshots fire from visitor-driven getFerryStatusSnapshot() calls throttled to every 10 minutes — so the cache is guaranteed to be cold roughly every 10 minutes. Since /ferry is dynamic (finding 1) and calls getEmpiricalBusyness() in its render Promise.all (src/app/(site)/ferry/page.tsx:98), one real visitor eats a 5-8 second page load every ~10 minutes, and during a boat-unloading burst several concurrent requests can all miss the cache and run the scan simultaneously (no single-flight guard), multiplying Neon transfer and Node CPU.

**Fix:** Aggregate in SQL instead of JS: one query like `SELECT obs->>'dir' AS dir, EXTRACT(dow FROM (obs->>'departs')::timestamptz AT TIME ZONE 'America/Los_Angeles') AS dow, EXTRACT(hour FROM ...) AS hour, AVG(LEAST(1, GREATEST(0, 1 - (obs->>'driveUp')::float / NULLIF((obs->>'max')::float,0)))) * 100 AS fullness, AVG(NULLIF((obs->>'delayMin')::float, 0)) AS delay, COUNT(*) FILTER (WHERE obs->>'max' IS NOT NULL) AS n FROM ferry_observation WHERE ts > now() - interval '91 days' GROUP BY 1,2,3` (mapping season/bucket in JS from the small grouped result). Or, simpler: have the observe cron compute the table and persist it as a record (like the accuracy snapshot already does via recordAccuracySnapshot), so pages do a single cheap record read. Add a single-flight promise around recomputation either way.


## Medium severity

### Rate-limit client key trusts the first (attacker-controlled) X-Forwarded-For hop

**`src/lib/rate-limit.ts:166`** · API routes

clientKey() takes xff.split(",")[0] — the FIRST entry of X-Forwarded-For. Behind Render's proxy (and most reverse proxies), a client-supplied X-Forwarded-For header is appended to, not replaced, so the first hop is whatever the caller sent. Every IP-bucket rate limit in the app keys off this: login, redeem, claim, feedback, survey, track, events-suggest, hunt-submit, going. An attacker rotating a random fake IP per request gets a fresh bucket each time, fully bypassing the IP limits — enabling scrypt CPU grinding on /api/auth/login, unlimited worklist spam via /api/claim and /api/report, unbounded photo-upload attempts, and 'going' count inflation. (Defense-in-depth per-email/per-code/per-record buckets still hold, which is why this is medium, not high.) The same first-hop read in /api/track's deriveGeo lets anyone forge the geography analytics the Chamber reports to LTAC.

**Fix:** Derive the client IP from the trusted side of the chain: on Render, take the LAST entry of X-Forwarded-For (the hop Render's proxy appended), or use a platform-guaranteed header, behind a TRUSTED_PROXY_DEPTH-style config so local dev still works. Apply the same change to deriveGeo in src/app/api/track/route.ts (line ~176).

### Public upload endpoints buffer unbounded multipart bodies before any size check

**`src/app/api/hunts/submit/route.ts:52`** · API routes

Both anonymous multipart intakes — /api/hunts/submit (line 52) and /api/events/suggest (line 89) — call `await request.formData()` with no Content-Length pre-check. formData() buffers the entire request body into memory before MAX_PHOTO_BYTES / MAX_ATTACHMENT_BYTES are ever consulted, so a single unauthenticated POST with a multi-hundred-MB body gets fully buffered first; the app's own backup route comments note the instance is 512 MB, so one or two such requests can OOM the service (user-visible outage). The rate limit runs first but caps request COUNT, not size. The codebase already knows this hazard: the admin-only qwick import (src/app/api/admin/import/qwick/route.ts:52-72) rejects on the Content-Length header before buffering precisely because 'request.text() buffers the whole thing into memory' — the pattern just never made it to the two PUBLIC multipart routes, where it matters most.

**Fix:** Port the qwick-import guard: before formData(), read Content-Length and 413 anything above a ceiling (e.g. MAX_ATTACHMENTS * MAX_ATTACHMENT_BYTES + slack ≈ 40 MB for suggest, MAX_PHOTO_BYTES + slack ≈ 10 MB for hunt-submit). A hostile client can omit/lie about Content-Length only by chunked encoding, which the platform proxy normalizes; the header check closes the honest-header case cheaply and matches the established house pattern.

### Empirical busyness table is biased low: every pre-departure snapshot counts as a fullness sample

**`src/lib/stores/ferry-observations.ts:193`** · Core domain logic

recordSailingSpaceSnapshot logs the next 2 sailings per direction every ~10 min, so a given sailing is snapshotted repeatedly across its fill trajectory — from nearly empty (~100 min out at ~50-min headways) to its final state just before departure. getEmpiricalBusyness (lines 188-204) then treats each snapshot as an independent observation of that sailing's busyness (entry.sumFull += clamp01(1 - driveUp/max)*100; nFull += 1), so the bucket mean approximates the average of the fill curve — roughly half the true final fullness. scoreAt blends this table in at up to EMP_MAX_WEIGHT=0.75, so as data accumulates the forecast is systematically dragged toward 'lighter than reality' — the worst failure direction for a tool telling visitors when to show up for a boat that fills. Compounding it, EmpiricalBucket.n counts snapshots, not sailings: EMP_MIN_SAMPLES=3 is satisfied by ONE sailing observed 3 times, and n/EMP_FULL_CONFIDENCE_N inflates confidence ~5-10x.

**Fix:** Aggregate per sailing, not per snapshot: group observations by (dir, departs), keep only the last snapshot before departure (max ts, or ts closest to departs) as that sailing's observed fullness, then bucket those one-per-sailing values. n then counts distinct sailings, making the MIN_SAMPLES/FULL_CONFIDENCE knobs mean what they say.

### Accuracy backtest grades the model against mid-fill snapshots, misreporting bias/MAE

**`src/lib/stores/ferry-observations.ts:288`** · Core domain logic

computeAccuracy (line 288) and computeDailyAccuracy (line 405) use the same per-snapshot 'observed = 1 - driveUp/max' as ground truth: a sailing snapshotted 5 times contributes 5 graded rows, most taken well before departure while the boat is still filling. The model's prediction of final busyness is compared against partial fullness, so the reported bias skews positive ('model runs high') and MAE/level-match are inflated even when the heuristic is well calibrated. This is the exact metric the module says the Chamber will 'watch before trusting the feature' (and recordAccuracySnapshot persists it via the daily cron) — a systematically pessimistic go/no-go number can sink a feature that is actually working, or prompt miscalibration of the CURVES constants to 'fix' a phantom high bias.

**Fix:** Same per-sailing collapse as the aggregation fix: grade one row per (dir, departs) using the final pre-departure snapshot as the observed value. Keep the heuristic-only scoring (that part is right). Note the admin copy at ferry-planner.tsx line 421 / ferry-busy-today.tsx line 115 calls sampleCount 'sailing observations'/'logged sailings' — after the fix the number will actually match those words.

### Trip planner can never snap to after-midnight sailings; late-evening queries get 'no sailing'

**`src/app/(site)/ferry/plan/ferry-planner.tsx:195`** · Core domain logic

The route runs until ~12:30 AM (ferry-forecast.ts's own header: 'runs ~4:45 AM to ~12:30 AM'), and WSF's /schedule/{TripDate} and /scheduletoday feeds include those after-midnight departures in the service day's list — their ISO instants fall on the NEXT calendar day. pacificMinutesOf (line 195) folds such a departure to minutes-since-midnight ≈ 30, and the ascending sort (line 196) puts it FIRST. The snap `departures.find(d => d.minutes >= targetMinutes - 1)` (line 200) therefore can't reach it for any evening target: a visitor asking about an 11:45 PM crossing is told 'No sailing at or after 11:45 PM — the last boat leaves at 11:10 PM' while a ~12:40 AM boat exists in the very payload rendered. Conversely a target of 12:15 AM snaps to the 12:40 AM boat but computes forecastAt/dayCurve for the SELECTED date at minutes≈40 — the wrong service context. Same folding affects spaceFor's live-space match only via targetMinutes, and the fallback schedule (ends 23:25) masks the bug whenever the API key is absent — which is why tests pass.

**Fix:** Carry a service-day offset: compute minutes as pacificMinutesOf(departs) + (pacificDate(departs) > schedule.date ? 1440 : 0) so after-midnight boats sort last and are snappable (targetMinutes stays 0-1439; optionally extend the time input's semantics or clamp). Keep forecastAt input as minutes % 1440 with the sailing's own Pacific date.

### Hard-coded fast-ferry timetable has no guard for its known GTFS expiry (2026-09-12)

**`src/lib/kitsap.ts:58`** · Core domain logic

The weekday/Saturday departure arrays were extracted from Kitsap Transit GTFS feed S1000066, valid only through 2026-09-12 (line 5), and sibling file kitsap-bus.ts (lines 4-8) spells out the failure: 'after it turns over, hard-coded times are silently wrong… a visitor misses a bus because of it. A wrong time is worse than no time.' Yet getFastFerrySailings has no runtime check — from 2026-09-13 (five weeks from today) it will keep emitting summer departure times as the day's schedule, on /ferry, the kiosk, and the status API, with nothing distinguishing them from valid data (live:false only means 'not real-time', and unlike fallbackSailings these rows carry no 'approximate' note). The Saturday gate `month >= 5 && month <= 9` (line 67) even shows summer-Saturday service through Sept 30, past the feed's own end. ops-health.ts tracks nothing about this.

**Fix:** Add `const FEED_VALID_THRU = "2026-09-12"` next to the times; in getFastFerrySailings compare todayPacific() against it and, when past, return { sailings: [], live: false } (the UI already handles empty via the no-service path) or attach a stale flag the UI must render as 'schedule expired — check kitsaptransit.com'. Also surface feed age in ops-health so the expiry becomes a dashboard warning weeks ahead, not a silent flip.

### Kiosk admin-preview gate forecloses the ISR the kiosk design depends on — every (kiosk) route ships permanently dynamic

**`src/app/(kiosk)/layout.tsx:51`** · Next.js 16 usage

The kiosk layout calls getKioskAccess(), whose 'load-bearing' branch order (src/lib/stores/kiosk-store.ts:108-125: flag first, session only on the disabled branch) is meant to keep /kiosk ISR. But `next build` always runs without DATABASE_URL (Dockerfile build stage; buildingWithoutDb() in src/lib/db/records.ts:97 returns [] for every store), and the kiosk ships dark by default (no seed record → enabled:false). So at build time the disabled branch ALWAYS executes: getSessionUser() → cookies() (src/lib/auth/session.ts:68) fires during the prerender of all 9 (kiosk) pages. Per the bundled previous-model caching guide and the repo's own analysis of the identical /es case (page-visibility.tsx:135-147: 'the cookies() read fires during the prerender and marks the whole route dynamic, which makes `export const revalidate` inert forever'), every kiosk route ships dynamic and the `export const revalidate = 60` on all kiosk pages is dead. This contradicts the documented mechanism in three places: docs/KIOSK.md §6 ('ISR revalidates within ~60s'), kiosk-store.ts ('the wall-mounted panel … depends on ISR plus its idle freshness reload'), and public/sw.js ('the content changes on a 60s ISR cycle'). Consequences: the wall panel triggers a full per-request render (kiosk settings + copy + photo-context Postgres reads, plus WSF fetches) on every tap and every 15-minute idle reload; and because dynamic routes prefetch nothing without a loading.tsx (the (kiosk) group has none), cache-cold Link taps on the panel are the same 'dead click' the team already diagnosed and fixed for /ferry (src/app/(site)/ferry/loading.tsx: cold dynamic renders measured 6.6-8.5s).

**Fix:** Apply the pattern the repo already invented for /line (assertPageVisibleStatic, page-visibility.tsx:132-155): make the kiosk layout gate cookie-free — `if (!(await getKioskEnabled())) notFound()` for everyone, no session read — so the build bakes a 404 while dark and revalidation flips it live within 60s of the Chamber enabling it. Move the admin preview to a sibling dynamic route (e.g. /admin/kiosk preview or /kiosk-preview, mirroring /line/preview). Verify with the build output summary: all /kiosk routes should switch from ƒ (dynamic) to ISR.

### No React cache() anywhere in the data layer — identical Postgres reads repeat 2-3x per request, against the bundled docs' explicit guidance

**`src/lib/auth/session.ts:67`** · Next.js 16 usage

The bundled v16 docs are explicit that non-fetch data access gets no automatic per-render dedup and should be wrapped in React's cache(): caching-without-cache-components.md §'Deduplicating requests', authentication.md (verifySession/getUser wrapped in cache()), and data-security.md (cache()d getCurrentUser). Nothing in src/lib is wrapped, and the duplicates are real on every dynamic render: (a) /ferry — a latency-sensitive page the team has already spent perf budget on — runs getEffectiveHiddenPaths() three times per request (assertPageVisible at ferry/page.tsx:84, the page's own Promise.all at :101, and SiteChrome at site-chrome.tsx:41) and getCopyOverrides() twice (:95 and site-chrome.tsx:42); each is a separate query to Neon. (b) The home page runs getPhotoContext() twice ((home)/page.tsx:33 in generateMetadata and :74 in the page) plus the same hidden-paths/copy pairs twice via SiteChrome. (c) Admin/portal pages re-run getSessionUser() after the admin layout already did (admin/layout.tsx:33 plus page-level gates in admin/accounts, admin/claims, admin/maps, portal/business, …) — each call re-parses the cookie and re-queries findUserById + findOrgById. On dynamic routes (/, /ferry, /es, all admin/portal, and currently all kiosk routes) this is 2-5 avoidable Neon round trips per page view, each tens of ms from Render.

**Fix:** Wrap the hot read-side helpers in React cache(): getSessionUser (session.ts), getPageSettings/getCopyOverrides (site-store.ts:46,90), and getPhotoContext (photo-store.ts) — or dedupe one level down by wrapping readMergedRecords/readRecords keyed by store name in db/records.ts. cache() scopes to a single render pass, so no cross-request staleness is introduced; behavior is unchanged except the duplicate queries disappear.

### No request-level deduplication anywhere: the same store reads run 2x per request (React cache() is never used)

**`src/components/site-chrome.tsx:40`** · Performance

grep confirms zero uses of React's cache(), unstable_cache, or 'use cache' in src/. Consequences on the dynamic pages where every render pays full price: (a) SiteChrome reads getEffectiveHiddenPaths + getCopyOverrides (site-chrome.tsx:40-43) and the page body reads both again (home page.tsx:71-72, ferry page.tsx:94-99) — two duplicate Neon queries per request; (b) generateMetadata() on `/` calls getPhotoContext() (home page.tsx:33) and the page calls it again (line 75) — getPhotoContext is itself two store reads (photo-store.ts:61), so 4 queries where 2 would do, on every home request since the route is dynamic; (c) /api/map/[viewId]/route.ts calls getMapView(viewId) at line 10 and resolveMapView() re-runs the identical full-store read at src/lib/map/resolve.ts:18. Because these getters use Drizzle (not fetch), Next gives them no automatic per-request memoization — that is exactly what React cache() exists for.

**Fix:** Wrap the hot read-only getters in React cache(): `export const getCopyOverrides = cache(async () => ...)` in site-store.ts, same for getPageSettings/getEffectiveHiddenPaths, getPhotoContext, getMediaItems, and getMapView. This is a one-line change per getter, dedupes within a single request/render pass (including generateMetadata vs page), and is invisible to all existing call sites and tests. In /api/map/[viewId], additionally pass the already-fetched view into resolveMapView instead of re-reading it.

### Analytics summarize() loads the entire 25-month event log into Node and builds an Intl.DateTimeFormat per row

**`src/lib/analytics-store.ts:393`** · Performance

summarize() calls readAnalyticsEvents() which SELECTs every analytics_event row (bounded only by the optional baseline; src/lib/db/append.ts readAnalyticsEvents has no LIMIT and no aggregation) and reduces in JS. Retention keeps 25 months (src/lib/privacy/policy.ts:116), so at modest tourism-season volume (2-3k events/day summer) this reaches 1M+ JSONB rows — hundreds of MB transferred from Neon and parsed per admin-dashboard load (src/app/(site)/admin/page.tsx:130), plus the /api/feedback and /api/survey admin GETs. Worse, pacificDay() (lines 372-380) constructs a new Intl.DateTimeFormat for EVERY event — the exact per-row-formatter bug this repo already measured and fixed in ferry-observations.ts (its comment at lines 78-82: four formatters per row cost ~1.4s at just 12k rows). At 100k+ rows the dashboard becomes tens of seconds of CPU and will eventually OOM the Render instance. Admin-only surface, so no visitor impact — but it degrades along exactly the axis (event volume) that success on launch guarantees.

**Fix:** Two-step: (1) immediate one-liner — hoist the Intl.DateTimeFormat in pacificDay to module scope like PACIFIC_DATE_FMT in ferry-observations.ts. (2) Move the rollup into SQL: `SELECT COUNT(*) FILTER (WHERE event->>'type'='pageview') AS pageviews, COUNT(DISTINCT event->>'sessionId') AS sessions, ... FROM analytics_event WHERE ts >= $since` plus grouped queries for byPath/byDay (`GROUP BY event->>'path'`, `GROUP BY date_trunc('day', ts AT TIME ZONE 'America/Los_Angeles')`) and `percentile_cont(0.75) WITHIN GROUP (ORDER BY (event->>'value')::float)` for the web-vital p75s. The k-floor logic can keep running in JS on the small grouped results, so the pure applyKFloor seam and its tests survive unchanged.

### Map feature/parking photos ship as full-size originals (up to 8MB) into 210px-wide popups — no width variants, weaker cache header

**`src/components/feature-map.tsx:543`** · Performance

Map popups are built as raw HTML strings, so photos render via plain `<img src="/api/map/image?p=...">` constrained to max-width:210px (feature-map.tsx:543-546), bypassing next/image entirely. Uploads accept up to 8MB (src/app/api/admin/map-features/image/route.ts:13) and image-sanitize.ts deliberately never resizes (its header at lines 9-12 calls the variant pipeline a separate backlog item). Net effect: a Chamber admin uploading a 6MB phone photo of a parking lot means every visitor who taps that pin on /parking or /eat — typically on ferry-line cellular — downloads 6MB to paint 210 CSS pixels. The listing-card path already does this right (listing-photo.tsx uses next/image with sizes). Also, /api/map/image serves content-hashed immutable names with only `Cache-Control: public, max-age=86400` (src/app/api/map/image/route.ts:21) while the equivalent /api/media route correctly uses `max-age=31536000, immutable` — the shorter TTL forces repeat visitors to revalidate bytes that can never change.

**Fix:** Cheapest meaningful fix: downscale at upload time in saveFeatureImage/saveMediaImage — sharp is already available (it ships as next's optional dependency and is installed), so `sharp(clean).resize({ width: 1600, withoutEnlargement: true })` before hashing caps the worst case at a few hundred KB without building the full variant pipeline; keep metadata-stripping first so the fail-closed guarantee is untouched. Independently, bump /api/map/image to `public, max-age=31536000, immutable` — the names are content-addressed, same argument as the media route's own comment.

### Analytics geo is trusted from client-spoofable x-vercel-ip-* headers on the Render deploy

**`src/app/api/track/route.ts:162`** · Security

deriveGeo() treats the presence of x-vercel-ip-country (and x-vercel-ip-city / x-vercel-ip-country-region) as authoritative geography and returns it before ever reaching the IP->DB-IP lookup fallback. Those headers are only injected by Vercel's edge; this app is deployed on Render (render.yaml), which neither sets nor strips them, and there is no VERCEL env gate around the branch. Any anonymous client can therefore POST /api/track with `x-vercel-ip-country: FR` and an arbitrary `x-vercel-ip-city` (each truncated to 80 chars) and have that stored verbatim as the visit's geography. The /api/track endpoint is the LTAC tourism-reporting pipeline, so this lets anyone poison the country/region/city distribution the Chamber reports to its funder, and it silently overrides the genuine DB-IP geolocation on the actual deploy platform.

**Fix:** Gate the Vercel-header branch behind a trusted-platform signal (e.g. only consult x-vercel-ip-* when process.env.VERCEL is set), so on Render the code always uses the connection-IP DB-IP path. Alternatively, verify the fronting proxy strips inbound x-vercel-ip-* from clients. Do not trust request-supplied geo headers unless a trusted proxy is known to set them.

### IP rate-limit key trusts the leftmost X-Forwarded-For hop, which is client-spoofable

**`src/lib/rate-limit.ts:168`** · Security

clientKey() derives the rate-limit identity from the FIRST comma-separated hop of X-Forwarded-For (`xff?.split(',')[0]`). On append-style proxies (Render's included) the platform appends the real connecting IP to any client-supplied X-Forwarded-For rather than replacing it, so the leftmost value is attacker-controlled. The file's own comment concedes this ("behind a proxy that does NOT strip client-supplied XFF, the first hop can be spoofed") and bets on the platform stripping it. For login/redeem/setup this is partly backstopped by per-account and per-code buckets, but the purely-public intakes (POST /api/track, /api/events/going, /api/feedback, /api/claim, /api/survey) have ONLY the IP bucket. An attacker rotating a forged first XFF hop per request defeats those limits entirely, enabling event-going count inflation, feedback/claim spam into the moderation queue, and analytics/forecast data poisoning at scale.

**Fix:** Do not trust the leftmost hop. On a known single-proxy deploy, take the RIGHTMOST value of X-Forwarded-For (the hop the trusted proxy actually appended) or read the platform's own trusted client-IP header. Make the trusted-hop count explicit/configurable rather than assuming the platform overwrites XFF.

### Nonprofit event CRUD is a hand-synced fork of the business events API, and has already diverged (no recurrence support)

**`src/app/api/portal/org/route.ts:118`** · Simplification & duplication

POST {action:'saveEvent'|'deleteEvent'} in org/route.ts (lines 118-245) reimplements what /api/portal/events (src/app/api/portal/events/route.ts POST/DELETE) already does: ownership check, slugId(), category allowlist, the E08 moderation branch (holdNewRecord/updatePendingRecord/holdEditProposal/requestTakedown), and the trustedAutoPublish bypass. The comment at org/route.ts ~line 190 admits the bypass must be 'applied to BOTH event write paths identically' — a manual invariant. It has already broken once: events/route.ts accepts rrule/exdates (recurring events, validated via isPresetRRule) and the business editor renders RepeatField, but the org path and the nonprofit EventForm (src/app/(site)/portal/nonprofit/[id]/editor.tsx:617-805) have no rrule support at all — a nonprofit cannot post its weekly recurring event even though the EventItem model and every other surface support it. The stated reason for the split ('so the two portals never collide on a file') is stale — writes now go through the Postgres-backed json-store, not files.

**Fix:** Extract the shared write core (ownership check → build EventItem → moderation/trusted branch → response shape) into a helper, e.g. src/lib/portal-events.ts, called from both routes; or point the nonprofit EventForm at POST /api/portal/events (its auth path can(user,'edit-record',ownerId) already covers charity ids) and shrink org/route.ts to profile PUT only. Either way nonprofits get rrule support for free and the trustedAutoPublish invariant stops being maintained by hand.

### Same-day deconfliction endpoint duplicated in two routes and diverged: nonprofits never see unified-calendar events in the clash check

**`src/app/api/portal/needs/route.ts:48`** · Simplification & duplication

The public 'what else happens that day' lookup exists twice. /api/portal/events?onDate= (events/route.ts:57-71) checks getUnifiedCalendarEnabled() and, when the E12 flag is ON, returns the MERGED calendar (AMS/Tribe events included) — the route comment says members 'learn about AMS/Tribe events too'. /api/portal/needs?onDate= (needs/route.ts:48-56) is a copy that only calls eventsSharingDate() and ignores the flag. The nonprofit EventForm calls the needs variant (src/app/(site)/portal/nonprofit/[id]/editor.tsx:644), so with the unified flag ON a nonprofit picking a date can be told 'Nothing else on the town calendar that day — it's all yours' while an ingested AMS/Tribe event exists that day — exactly the double-booking the check exists to prevent, and inconsistent with what a business member sees for the same date. The two copies even disagree on the param name (excludeId vs exclude).

**Fix:** Mechanical: change the nonprofit EventForm fetch to /api/portal/events?onDate=${date}&exclude=${id} (response shape {events} matches; adjust for the needs route's extra ok field) and delete the onDate branch from needs/route.ts (lines 48-56 plus the eventsSharingDate import and the 'onDate' half of the 400 message). If keeping both routes, at minimum have the needs branch call the same unified-flag-aware helper.

### Portal form kit copy-pasted across six client files, with three competing fetch-wrapper idioms; LodgingEditor and DirectoryEditor are near-clones

**`src/app/(site)/portal/business/[id]/lodging-editor.tsx:18`** · Simplification & duplication

Verbatim duplicates across the portal: inputClass/buttonClass constants in 6 files (portal/forms.tsx:33-36, business/[id]/editor.tsx:20-25, lodging-editor.tsx:18-21, directory-editor.tsx:21-24, nonprofit/[id]/editor.tsx:23-30, account/settings.tsx:11-13); the Field label component in 5 of them; PENDING_TEXT in 4. Worse, the same save-with-pending-review flow is implemented four different ways: useSave() hook (business editor:127-153), inline async IIFE copies of it (lodging-editor:52-91, directory-editor:61-103), api<T>() + formValues (nonprofit editor:53-78), and useSubmit() (forms.tsx:38-65) — so a UX fix (e.g. new pending copy, error announcement) must be found and applied in four plumbing styles. Within that, LodgingEditor (157 lines) and DirectoryEditor (178 lines) are structural clones differing only in the field list (bookingUrl vs phone), one DRAFT_TEXT branch, and placeholders — both PUT the same /api/portal/listing payload shape.

**Fix:** Create src/components/portal/form-kit.tsx exporting Field, inputClass, buttonClass, PENDING_TEXT, useSave, SaveMessage, and putListing (all already written in business/[id]/editor.tsx — move, don't rewrite), and import it from the six files, deleting the local copies. Then collapse LodgingEditor + DirectoryEditor into one config-driven <ListingDetailsEditor fields={[...]} draftText?> — a pure deletion of ~150 lines with no behavior change.

### ICS builder has zero direct tests despite an explicit byte-stability contract

**`src/lib/events/ics.ts:88`** · Test coverage

The module header states the emitted bytes 'must not change — external subscribers depend on them', yet nothing pins them. The only ICS assertions anywhere are one DTSTART-timezone substring check (src/app/api/__tests__/feeds-events-route.test.ts) and one 'pending event absent' check (tests/unit/moderation-gate.test.ts). Completely untested: fold() at the exact 75-octet boundary, the continuation-space counting toward its own 75, multi-byte UTF-8 never being split (line 55-72); escapeText() ordering (backslash must be escaped first, line 30-36); all-day VALUE=DATE emission with the exclusive next-Pacific-day DTEND (lines 104-107 — nextPacificDateBasic mixes a Pacific date with toISOString(), exactly the class of off-by-one that needs a golden near a UTC-rollover evening); CRLF joining and the trailing CRLF. A refactor that drops folding for a long member-written SUMMARY, or reorders escapeText replacements, passes every existing test but produces feeds that strict parsers (Outlook, older CalDAV clients) reject — silently breaking every external calendar subscription.

**Fix:** Add tests/unit/events/ics.test.ts (pure module, plain unit suite): (a) a golden full-calendar byte fixture — one timed event, one all-day, one with contact+url, titles containing ',', ';', '\\', and newlines — compared with strict equality after substituting the DTSTAMP; (b) fold() property tests at 75/76 octets, a continuation whose space counts, and a multi-byte char straddling the boundary (assert unfolding round-trips); (c) escapeText round-trip including a pre-escaped backslash; (d) all-day DTEND goldens for a single-day event and a multi-day event whose end instant is 11 pm PDT (Pacific date != UTC date).

### Login/redeem HTTP boundary untested: rate-limit wiring, uniform 401, cookie mint

**`src/app/api/auth/login/route.ts:12`** · Test coverage

The identity layer is thoroughly tested (tests/unit/auth-v2-identity.test.ts), but no unit test calls POST /api/auth/login or POST /api/auth/redeem as routes (src/app/api/__tests__ has only auth-setup-route.test.ts; the Docker suite logs in via a happy-path helper). Unpinned security-critical wiring: the per-IP 429 with Retry-After; the per-EMAIL bucket including its normalization ('  User@X.com ' must hit the same bucket as 'user@x.com' — line 30's trim().toLowerCase() is load-bearing against many-IP targeted brute force, and drift there reopens scrypt grinding silently); the uniform 401 wording for unknown/wrong/disabled at the route level; and the session cookie being set from sessionCookie.options with a token minted at the user's current session_version (line 47). Any of these can regress with 2220 tests still green — the claim-intake limiter has exactly these tests (tests/unit/claim-intake.test.ts lines 262-319), so the house style already exists.

**Fix:** Add src/app/api/__tests__/auth-login-route.test.ts (PGlite, patterned on auth-setup-route.test.ts): seed a user; assert (1) 9th same-IP attempt in the window → 429 + Retry-After header; (2) same email from distinct x-forwarded-for IPs with case/whitespace variants trips the email bucket; (3) unknown email, wrong password, and disabled account all return byte-identical 401 bodies; (4) success sets the cookie with httpOnly/secure/sameSite/path/maxAge from sessionCookie.options and a token that verifies at the current sv. Mirror a slim version for /api/auth/redeem (429 + burned-code 4xx + cookie on success).

### Ferry cron endpoints' optional-token gate has no tests — the silent-data-loss failure mode the repo itself documents

**`src/app/api/ferry/observe/route.ts:24`** · Test coverage

GET/POST /api/ferry/observe and /api/ferry/accuracy implement a hand-rolled gate: open (throttled) when FERRY_OBSERVE_TOKEN is unset; when set, require a matching ?token= OR Authorization: Bearer (case-insensitive prefix strip). No test exercises any branch — cron-inventory.test.ts only parses render.yaml, and tests/unit/ferry-latest-observation.test.ts tests the store beneath. render.yaml's own comments (lines 211-230) recount how a route/auth mismatch 'silently broke nightly backups once' and that the whole reason these crons moved to Render was that silent scheduler death kills the busyness model's data collection with nothing announcing it. A regression in the Bearer-strip regex or a switch to header-only auth would 401 the deployed curl crons; observations stop, the forecast quietly degrades over weeks, and no test or alert notices.

**Fix:** Add tests/unit/ferry-observe-auth.test.ts (unit suite; stub @/lib/wsf and the observations store): with FERRY_OBSERVE_TOKEN set via vi.stubEnv — wrong token 401, missing token 401, correct ?token= 200, correct 'Bearer <t>' 200 (assert case-insensitive 'bearer' too, since the Render blueprint's curl command is the real client); with it unset — request succeeds and hits the store. Cover both GET and POST, and both routes.


## Low severity

### /api/report is a public existence oracle for unpublished (draft/pending/hidden) records

**`src/app/api/report/route.ts:80`** · API routes

The report intake resolves its subject with getSubjectRecord(), which uses ADMIN_GETTERS — any-status reads (src/lib/moderation.ts:61-68). An anonymous caller therefore distinguishes 'record exists in any state' (200) from 'never existed' (404), for every moderated store. The sibling /api/claim route deliberately does the opposite ('Existence is checked through the PUBLIC (live-only) store reads on purpose … no draft oracle') because imported directory drafts have guessable slug-like ids — and that exact class of record is probeable here instead. The stated reason for any-status lookup (reports about just-taken-down records still cached publicly) only justifies including tombstoned/live records, not never-published drafts and pending member submissions. Secondary drift in the same route: it parses with request.json() at line 41 with no raw-body byte cap, unlike every sibling public intake (claim, survey, feedback, privacy/request all cap at 8-16 KiB before JSON.parse).

**Fix:** Resolve the subject against public reads first; fall back to the admin read only for statuses that were previously public (tombstoned), or collapse 'draft/pending not-yet-public' into the same 404 as nonexistent. Add the standard MAX_BODY_BYTES raw-text cap before JSON.parse to match the house intake pattern.

### Machine-token routes compare bearer tokens with === instead of timingSafeEqual

**`src/app/api/events/ingest/route.ts:32`** · API routes

Five cron/machine endpoints gate on `provided === expected`: events/ingest (line 32), ferry/observe (line 29), ferry/accuracy (line 24), admin/privacy/retention (line 28), admin/worklist/sweep (line 40). Non-constant-time comparison leaks a (noisy, but free to probe on unauthenticated routes) timing signal about prefix matches. The codebase already has the correct pattern in two places — /api/admin/backup's hasValidBackupToken and /api/auth/setup's timingSafeEqualStr both use crypto.timingSafeEqual — so this is drift, not ignorance. Practical exploitability over a network is low, but three of these tokens gate real state changes (retention purges via ?apply, worklist sweep, external-calendar ingest). Relatedly, all five also accept the token via ?token= query string, which lands in access logs; that is a documented scheduler-compat tradeoff, but worth an eventual header-only migration for the retention token specifically.

**Fix:** Extract the backup route's timing-safe helper into src/lib/auth/tokens.ts (it already imports timingSafeEqual) and use it in all five routes; prefer the Authorization header over ?token= where the calling scheduler supports it.

### /api/events/going records tallies for event ids that don't exist

**`src/app/api/events/going/route.ts:69`** · API routes

POST validates eventId only as 'non-empty string ≤200 chars' and then upserts directly into the event_going table (recordGoing in src/lib/db/event-going.ts inserts any (eventId, zip) pair). Nothing checks the event exists. Combined with the spoofable IP rate limit (finding 1), an anonymous script can insert unbounded junk (eventId, zip) rows — up to ~100 distinct zip rows per fake id — inflating the table the LTAC retention job and getGoingByZip reports read. The junk is invisible on the events page (which queries only real ids) so nobody notices the growth until the table or the retention dry-run numbers look wrong. GET similarly echoes counts for arbitrary ids, which is harmless but confirms writes landed.

**Fix:** After parsing eventId, verify it resolves to a live event (getEvent / the unified calendar lookup used elsewhere) and 404 otherwise. That also tightens the count-inflation surface to real events only, where the device-side dedupe caveat is already documented.

### Volunteer-need signup stepper is a lost-update read-modify-write

**`src/app/api/portal/needs/route.ts:105`** · API routes

The `action: "slots"` branch reads the need, computes slotsFilled ± 1 in JS (line 105), and saves the WHOLE record back via saveVolunteerNeed. Two concurrent ticks — an org's two coordinators logging phone signups during a drive, or one user double-clicking with retry — both read slotsFilled=N and both write N+1: one signup is silently lost, and this counter is exactly the field the exception-to-moderation was carved out for ('track signups as they come in'). The codebase already uses the correct pattern for its other public counter: event-going increments with `count = count + 1` SQL upsert (src/lib/db/event-going.ts:48-58) precisely to avoid this. The stepper also rides the full-record save, so a concurrent field edit can be clobbered by a tick and vice versa.

**Fix:** For the live-status stepper path, perform the increment atomically in the store (SQL `slots_filled = LEAST(slots_total, GREATEST(0, slots_filled + $delta))` on the record row, or a compare-and-swap on the doc) instead of rewriting the whole document from a stale read.

### /api/auth/redeem echoes raw internal error messages to anonymous callers

**`src/app/api/auth/redeem/route.ts:58`** · API routes

The final catch returns `e.message` for ANY Error, not just AuthError. redeemInvite's expected failures are human-worded AuthErrors, but an unexpected failure — a Postgres error surfacing mid-transaction ('duplicate key value violates unique constraint "users_email_key"', connection strings in driver errors, etc.) — is echoed verbatim to an unauthenticated client on a public endpoint. Sibling routes explicitly avoid this: portal/users logs the raw error and returns a generic message ('its internals must not be echoed to the client'), and auth/account maps unexpected errors to a generic 409. This route predates that convention.

**Fix:** Narrow the catch: return err.message only for `err instanceof AuthError` (and the existing OwnershipConflictError branch); for anything else, console.error the details and return a generic 'could not redeem invite' 500/400, matching the portal/users pattern.

### Holiday observations pollute ordinary empirical buckets (blend gate is one-sided)

**`src/lib/stores/ferry-observations.ts:189`** · Core domain logic

scoreAt deliberately skips the empirical blend on holidays so bucket averages 'mostly ordinary days' can't wash out holiday spikes (ferry-forecast.ts:361). But the aggregation side has no matching gate: getEmpiricalBusyness keys July 4th / Memorial-weekend sailings into the same direction|season|dow|hour buckets as ordinary days (line 190-191), so a 100%-full Independence Day 2 PM sailing inflates the plain 'peak Saturday 2 PM' bucket that ordinary summer Saturdays then blend against at up to 75% weight. The stated season-scoping rationale ('summer data can't wrongly inflate a winter estimate') is undermined for the days around each holiday's own season.

**Fix:** In getEmpiricalBusyness (and the accuracy scans, for symmetry), skip observations whose Pacific departure date has holiday(parseParts(date)) !== null — the exact inverse of scoreAt's gate, using the already-exported helpers so the two sides can't drift.

### FerryBusyToday freezes the server-rendered date across Pacific midnight

**`src/components/ferry-busy-today.tsx:64`** · Core domain logic

The component ticks nowMs every 60s and recomputes pacificMinutes(nowMs) (line 64), but forecastAt/dayCurve are called with the `today` prop (lines 65-66) — a 'YYYY-MM-DD' string frozen at server render (page revalidate=60 bounds server staleness, but not client staleness). A tab left open past Pacific midnight — plausible for this exact panel: it's embedded in line-lander.tsx, the 'waiting in the ferry line' surface, and the route has a ~12:30 AM boat — computes the NEW day's minutes against the OLD day's date: Sunday-evening curve rendered for what is now Monday 12:10 AM, wrong day category, wrong holiday/season factors, and a 'Right now' marker pinned at minutes≈10 on yesterday's curve.

**Fix:** Derive the date from nowMs in the component (an en-CA Intl.DateTimeFormat with timeZone America/Los_Angeles, same pattern as pacificMinutes) instead of trusting the prop after mount; keep the prop only for the SSR first paint so hydration still agrees.

### pacificWallTimeToISO attaches the wrong UTC offset for 00:00-02:59 on DST transition days

**`src/lib/time.ts:14`** · Core domain logic

The offset probe is taken at `${dateStr}T12:00:00Z` (line 14) — 4-5 AM Pacific, which on both DST transition days is AFTER the 2 AM local switch (09:00/10:00 UTC). So every wall time on that date gets the post-transition offset: on spring-forward day (e.g. 2027-03-14) an event normalized from a datetime-local '00:30' becomes 00:30-07:00, an instant that is actually 23:30 PST the previous day — pacificDateKey-style date-prefix slicing stays right but the real moment is an hour early; and 02:00-02:59 (times that don't exist) silently map instead of being flagged. On fall-back day, 00:00-00:59 wall times get -08:00 though PDT (-07:00) was still in effect. Affects normalizeEventTimestamp (portal event editor) and fallbackSailings for early-morning times two days a year.

**Fix:** Probe with the target hour rather than noon: build `${dateStr}T${hhmm}:00Z`, read the offset, re-derive once (apply the offset, re-format in Pacific, and if the round-trip wall time differs, take the second offset) — the standard two-pass wall-time resolution; or document the 2-days-a-year early-morning caveat next to the function if the product genuinely never schedules 0-3 AM events.

### Holiday windows clip at month boundaries: Labor Day Fri-Sun and Thanksgiving Sunday can go unflagged

**`src/lib/ferry-forecast.ts:286`** · Core domain logic

holiday() guards each window with a single-month check. Labor Day: `mo === 9 && d >= labor - 3 && d <= labor` (line 286) — when Labor Day falls on Sept 1-3 (2031: Mon Sept 1), the getaway Friday-Sunday are Aug 29-31 and match neither the mo===9 clause nor anything else, so the route's classic crush weekend forecasts as an ordinary shoulder weekend (seasonTag also drops those days from 'shoulder' only after Oct, so just the 1.3x surge is lost). Thanksgiving: `d <= thanksgiving + 3` (line 290) — when Thanksgiving is Nov 28 (2030), the Sunday-after travel crush is Dec 1, and d<=31 never matches in November, so the single worst return day of that holiday is unflagged. The mirrored boardingPassExpected/holidayWeek checks (Nov 22-30) share the Dec-1 gap.

**Fix:** Compute the holiday anchor as a day-of-year (or epoch day) and compare distances on that scale instead of (month, day) pairs — e.g. `const delta = epochDay(p) - epochDay(y, 9, labor); if (delta >= -3 && delta <= 0)` — which crosses month boundaries for free; apply the same to the Thanksgiving +3 window and the wsf.ts holidayWeek mirror.

### Trendline's 24:00 sample blends against the hour-0 empirical bucket

**`src/lib/ferry-forecast.ts:263`** · Core domain logic

dayCurve samples through DAY_END_MIN = 1440. For that last point, sampleCurve clamps to 1439 (line 325) so the heuristic reflects 11:59 PM — but empiricalBucketKey normalizes minutes mod 1440 (line 263), so 1440 maps to hour 0 and the blend pulls the midnight point toward the hour-0 bucket (post-midnight/early-AM observations of a different service context). Once buckets accumulate enough samples, the curve's right edge can kink upward/downward inconsistently with its 23:30 neighbor, and quietest/busiest window detection (which compares exact scores) can land on the artifact.

**Fix:** Clamp before bucketing to match the curve: in empiricalBucketKey use Math.min(Math.floor(clamp(minutes, 0, 1439) / 60), 23) — or have scoreAt pass min(minutes, 1439) to both the curve sample and the bucket key so the two lookups can never disagree.

### Home page exports an inert revalidate = 60 — '/' is per-request dynamic via getSide(), with no exemption or comment marking it accepted

**`src/app/(site)/(home)/page.tsx:22`** · Next.js 16 usage

getSide() ((home)/page.tsx:73) unconditionally awaits cookies() (src/lib/side-server.ts:10), which per the bundled previous-model guide makes the whole route dynamically rendered — so `export const revalidate = 60` at line 22 is dead code and the highest-traffic page re-runs its 9-way Promise.all (5 Postgres reads + weather/tides/WSF fetch-cache reads) on every visit. The repo treats exactly this pattern as a named trap: /simple and /map/restrooms carry comments explicitly avoiding getSide() to stay ISR, and /ferry's identical inert revalidate is documented and exempted in tests/unit/visibility-gate-guard.test.ts ('accepted by design'). Home has neither an exemption nor a comment at the export; the only acknowledgment is a passing aside in route-loading-skeleton.tsx. A future reader (or the Chamber asking why '/' is slow) will reasonably believe the page is cached for a minute when it is not — and given the LCP work recorded in next.config.ts (rejected inlineCss, hero fetchPriority tuning), real ISR on '/' is the larger unclaimed win.

**Fix:** Either (a) restore real ISR: drop getSide() from the server render, default the hero to the Kingston side, and let a small client boundary read the vk-side cookie in the browser and swap the side-dependent strings/widgets (SideSwitcher and NextFerries are already client components); or (b) if per-request personalization is the accepted trade, delete the misleading `export const revalidate = 60` and add the same 'known-inert, accepted' comment + guard-test note that /ferry carries.

### Guard-rail comments have drifted from the code they protect (removed (home) loading boundary; wrong dynamic-trigger for /ferry/plan)

**`src/components/route-loading-skeleton.tsx:2`** · Next.js 16 usage

Two load-bearing comments now state things that are no longer true. (1) route-loading-skeleton.tsx:1-8 says the skeleton is 'rendered by the scoped loading.tsx files ((site)/(home) and (site)/ferry)' — but the (home) boundary was deliberately removed on 2026-08-01 (commit 124be53; tests/unit/hidden-page-404-guard.test.ts records the removal and why), and only src/app/(site)/ferry/loading.tsx exists. (2) tests/unit/visibility-gate-guard.test.ts:21-23 justifies the (site)/ferry/plan exemption with 'getSide() reads the side cookie on every request' — ferry/plan never calls getSide(); its actual dynamic trigger is getFerryPredictionAccess() → getSessionUser() on the flag-off branch (which the empty build store guarantees at prerender), as the page's own comment at ferry/plan/page.tsx:63-66 correctly states. These files are the safety rails future changes are audited against; a wrong stated reason invites someone to 'fix' the exemption or re-add a (home) boundary that was measured out.

**Fix:** Update route-loading-skeleton.tsx's header to name only (site)/ferry (pointing at the guard test for the (home) history), and correct the visibility-gate-guard exemption rationale for ferry/plan to name getFerryPredictionAccess()'s session read. Also worth syncing: the comment above `export const revalidate = 60` in ferry/page.tsx:48-50 still claims the page regenerates 'at most once a minute', contradicting the accepted-inert status the guard test documents.

### create-next-app template assets still served from public/

**`public/next.svg`** · Next.js 16 usage

public/ still contains the untouched create-next-app starter SVGs — next.svg, vercel.svg, globe.svg, file.svg, window.svg. Nothing in src/, docs/, or README references them (grep-verified), yet they are publicly served on a branded client site (e.g. https://explore-kingston.onrender.com/vercel.svg resolves), get copied into every Docker image via `COPY --from=build /app/public ./public`, and mildly contradict the app's otherwise deliberate public surface (poweredByHeader is disabled specifically to avoid advertising the framework, while /next.svg still does).

**Fix:** Delete the five starter SVGs from public/. No code change needed; the sw.js STATIC_PREFIXES caches by request so nothing precaches them.

### resolveMapView awaits its data sources sequentially, and the route's s-maxage caching directive is honored by nothing in production

**`src/lib/map/resolve.ts:18`** · Performance

resolveMapView() awaits getMapView, then getFeaturesForView, then per-source getRestaurants / getParkingZones + getMediaItems one after another (resolve.ts:18-44) — 4-6 serial Neon round trips where none depends on another's result. The /api/map/[viewId] route (line 34) then relies on `Cache-Control: s-maxage=60, stale-while-revalidate=300`, but s-maxage only instructs shared caches: browsers ignore it, and Render web services have no CDN cache in front (the CLAUDE.md deploy notes confirm plain Render hosting). So every FeatureMap mount on /eat, /parking, /map, /give pays the full serial chain per visitor. Same inert s-maxage pattern on /api/feeds/events and /api/feeds/business.

**Fix:** Parallelize with Promise.all (view+features first, then the per-source reads together), pass the route's already-fetched view in (see finding 3), and give the response server-side caching that actually exists here: either a route segment `export const revalidate = 60` on the GET handler for published views, or wrap the resolved payload in a 60s in-process memo keyed by viewId — the same pattern dbHealthy() already uses in records.ts.

### deleteRecord() reads every row in a store to tombstone one record

**`src/lib/db/records.ts:442`** · Performance

deleteRecord() calls `readRecords<WithId>(store)` — a full-store SELECT of every doc — then `.find(r => r.id === id)` in JS (records.ts:442-443), even though the table's primary key is (store, id) and writeRecord's own transaction already does a targeted single-row select (line 162-165). Same shape recurs at the store layer: getMediaItem(), getEvent(), getEventAdmin() all fetch the whole merged store to find one id. Today's stores are hundreds of rows so this is latency, not breakage — but it sits on interactive API delete paths, and the media store is the one most likely to grow into thousands of rows.

**Fix:** In deleteRecord, replace the full read with a single-row query: `const [row] = await db.select({doc: record.doc}).from(record).where(and(eq(record.store, store), eq(record.id, id)))` and tombstone `row?.doc ?? { id }`. Optionally add a readRecord(store, id) helper to the data layer so getMediaItem/getEvent-style lookups on hot paths can stop paying full-store scans as stores grow.

### Secret machine/cron tokens compared with non-constant-time equality

**`src/proxy.ts:82`** · Security

machineTokenOk() compares the provided bearer/query token to the expected env secret with plain `provided === expected` (proxy.ts:82). The same non-constant-time pattern appears in the open cron routes: `provided !== expected` in src/app/api/ferry/observe/route.ts:29 and src/app/api/ferry/accuracy/route.ts:24. This is inconsistent with the setup route (src/app/api/auth/setup/route.ts), which deliberately uses crypto.timingSafeEqual via timingSafeEqualStr for exactly this purpose. String === short-circuits on the first differing byte, leaking a timing signal about a shared secret (BACKUP_TOKEN, WORKLIST_SWEEP_TOKEN, RETENTION_TOKEN, FERRY_OBSERVE_TOKEN). Remote timing extraction is impractical but the fix is trivial and the codebase already has the helper.

**Fix:** Compare these secrets with a constant-time helper (length-checked crypto.timingSafeEqual, as timingSafeEqualStr already does) in proxy.ts machineTokenOk and both ferry routes, rather than === / !==.

### Privileged cron tokens accepted via ?token= query string, leaking secrets into logs

**`src/proxy.ts:80`** · Security

The machine-token routes (BACKUP_TOKEN, WORKLIST_SWEEP_TOKEN, RETENTION_TOKEN in proxy.ts MACHINE_TOKEN_ROUTES) and the ferry cron routes accept the secret either as an Authorization: Bearer header OR as a `?token=` query-string parameter (proxy.ts:79-81; src/app/api/ferry/observe/route.ts:26; src/app/api/ferry/accuracy/route.ts:21). Secrets placed in URLs are routinely captured in web-server/access logs, upstream proxy logs, and Referer headers, and are far more likely to be copy-pasted into an issue or shell history than a header. These tokens gate backup export, the worklist sweep, and privacy-retention deletion, so leaking one is high-impact.

**Fix:** Prefer the Authorization header only for these routes. If a query-string form must stay for a scheduler that can't set headers, document that it must not be used on the public deploy, and ensure the access logs scrub the `token` param. Rotate any token that has been used via ?token= against a logged deploy.

### Parking colors triplicated by hand across the public map and both admin editors — a self-documented copy-paste dependency

**`src/components/feature-map.tsx:58`** · Simplification & duplication

PARKING_RULE_COLORS (8 hex values) exists identically in three files: src/components/feature-map.tsx:58-73, src/app/(site)/admin/maps/editor.tsx:265-275, and src/app/(site)/admin/map/editor.tsx:86-95 (as RULE_COLORS); STREET_COLORS + streetStyle are additionally duplicated between feature-map.tsx (~line 105) and admin/maps/editor.tsx:288-318. feature-map.tsx's own comment says colors are 'kept in sync BY HAND with the two admin editors', and docs/MAPS.md:736-740 lists this as a known wart: 'a copy-paste dependency, not a shared constant.' The color choices carry accessibility reasoning (ΔE76 separation, WCAG 1.4.11 contrast per ADR-0007) — if one file is retuned and the others aren't, the admin preview silently stops matching what visitors see, defeating the editors' purpose as previews. All three copies are currently identical, so extraction is a zero-behavior-change move.

**Fix:** Add src/lib/map/parking-colors.ts exporting PARKING_RULE_COLORS, FALLBACK_PARKING_COLOR, parkingColor(), PARKING_RULE_LABELS, STREET_COLORS, normalizeStreetRule(), and streetStyle(); import it in the three files and delete the local copies (src/lib/map already sits below both components and app per the dep-cruise boundaries — feature-map.tsx imports @/lib/map/types today). Move the ADR-0007/ΔE justification comments to the new module. Update docs/MAPS.md:736 to drop the wart entry.

### Orphaned legacy Atm interface, and docs that misreport what remains (ParkingArea is already gone)

**`src/lib/types.ts:88`** · Simplification & duplication

interface Atm (types.ts:88-98) has zero references anywhere in src/, scripts/, or tests — the ATM feature was removed (docs/ROADMAP-V2.md:39) and the roadmap itself lists deleting it as 'P1 — remove the orphaned legacy types' (ROADMAP-V2.md:301). ParkingArea, which the same docs claim is also still present, is in fact already gone: it appears nowhere in src/ (docs/SDD.md:72 still asserts 'ParkingArea (types.ts:82) … still imported by src/lib/data/parking.ts, which exports a parkingAreas array' — none of that exists in the current tree, while docs/MAPS.md:653 correctly says it was removed). So the docs disagree with each other and with the code.

**Fix:** Delete lines 88-98 of src/lib/types.ts (the Atm interface). Then fix the doc drift in one pass: SDD.md:72/676/695 (drop the ParkingArea/parkingAreas claims), ROADMAP-V2.md:39/301 and ARCHITECTURE.md:167/476 and DATA_SOURCES.md:323 (state that only Atm remained and is now removed). Typecheck confirms nothing breaks — grep shows no importer.

### EVENT_CATEGORIES is documented as the single source of truth but four hand-copies of the list exist and none import it

**`src/lib/schemas/event.ts:32`** · Simplification & duplication

src/lib/schemas/event.ts:32 exports EVENT_CATEGORIES with the comment 'Single source for the portal routes' category validation and the editor select' — yet grep shows no portal route or editor imports it. Instead the identical 7-item array is retyped in src/app/api/portal/events/route.ts:40-48, src/app/api/portal/org/route.ts:27-35, src/app/(site)/portal/business/[id]/editor.tsx:27-35, and src/app/(site)/portal/nonprofit/[id]/editor.tsx:32-40 (the last with a different ordering). Adding an 8th EventCategory to the union in types.ts would require finding five lists; missing one makes a route silently coerce the new category to its fallback ('community'/'charity') while other surfaces accept it.

**Fix:** In the four files, delete the local CATEGORIES/CATEGORY_OPTIONS array and import EVENT_CATEGORIES from @/lib/schemas/event (it is a plain as-const array; the schemas module is already imported client-side elsewhere, and zod is client-safe). For the nonprofit editor's charity-first ordering, keep a one-liner reorder (["charity", ...EVENT_CATEGORIES.filter(c => c !== "charity")]) rather than a second list.

### Ad-hoc date/time formatters duplicate each other and src/lib helpers; formatWeeklyHours is pure lib code stranded in a page component

**`src/app/(site)/portal/business/[id]/editor.tsx:46`** · Simplification & duplication

Three near-identical private fmtDate(iso) functions exist in the admin managers (accounts/manager.tsx:104, claims/manager.tsx:97, worklist/manager.tsx:157). The business editor's fmtTime (editor.tsx:60-67) duplicates src/lib/hours.ts fmt (hours.ts:33-38) verbatim except for midnight/noon labels, and its DAY_ORDER/DAY_LABEL tables (editor.tsx:48-57) duplicate hours.ts DAY_KEYS/DAY_LABELS. formatWeeklyHours plus its helpers (~60 lines, editor.tsx:46-110) are pure, exported functions parked inside a 'use client' page component — the natural home is src/lib/hours.ts next to getOpenStatus, which already owns the WeeklyHours vocabulary. Each copy is tiny, but together they mean 'how this app prints a time' has ~6 owners.

**Fix:** Mechanical moves, no behavior change: (1) move formatWeeklyHours/fmtSpans/fmtTime/DAY_ORDER/DAY_LABEL from the business editor into src/lib/hours.ts, merging fmtTime with the existing fmt (add the midnight/noon cases — hours.ts labels only ever render for times a business set, so 'midnight'/'noon' reads better there too, or keep a flag if the badge wording must not change); (2) add a formatShortDate(iso) to src/lib/time.ts and delete the three admin fmtDate copies.

### Hours engine: DST-transition-day goldens missing (roadmap suspicion confirmed)

**`src/lib/hours.ts:63`** · Test coverage

tests/unit/hours.test.ts pins a January-PST instant and a July-PDT instant (lines 122-136) but never a transition day, so the roadmap's suspicion is a real gap. getOpenStatus trusts Intl wall-clock math end-to-end; behavior on 2026-03-08 (spring forward) and 2026-11-01 (fall back) is currently assumed, not pinned: a bar's past-midnight span (Sat 17:00-02:00) evaluated inside Sunday's repeated 1am hour, a span opening at the nonexistent 02:00-02:59 on spring-forward morning, and next-open labels computed across the transition. Relatedly, normalizeEventTimestamp/pacificWallTimeToISO (src/lib/time.ts:12-22) probe noon to pick the offset, so a naive '2026-03-08T02:30' — a wall time that does not exist — gets an offset silently; src/lib/__tests__/time.test.ts only tests plain summer/winter. Cheap goldens make today's behavior explicit and catch ICU/platform drift; the open/closed badge is user-visible on every listing twice a year.

**Fix:** Extend tests/unit/hours.test.ts with fixed-instant goldens on 2026-03-08 and 2026-11-01: (a) the yesterday-tail of a 17:00-02:00 span at 01:30 during both the skipped and repeated hour (construct instants via explicit UTC offsets, e.g. 08:30Z and 09:30Z on Nov 1 which are both 1:30 wall time); (b) a 02:00-04:00 span on spring-forward morning; (c) a 'Closed · opens ...' label computed across the transition. Add two normalizeEventTimestamp cases for naive times inside the skipped/repeated hour to src/lib/__tests__/time.test.ts pinning whatever offset the probe yields.

### Attachment lifecycle tails untested: storage-quota 507 and delete-time byte cleanup

**`src/app/api/events/suggest/route.ts:171`** · Test coverage

trusted-and-suggest.test.ts covers the intake happy path plus 415/413/429, but three tails have zero coverage: (1) the shared-disk quota gate — attachmentStorageBytes() > MAX_ATTACHMENT_STORAGE_BYTES → 507 (line 171-176); the module even ships a test-only invalidateAttachmentStorageCache() hook (src/lib/events/attachment-store.ts:73) that nothing calls, and the 60s cache + hasBlob()-only condition make this easy to regress unnoticed; (2) UnstrippableImageError → 400 instead of 500 (the fail-closed EXIF-strip posture, lines 192-198) — a regression turns member uploads of odd-but-valid images into retry-forever 500s; (3) the event-store delete path purging attachment bytes (src/lib/stores/event-store.ts:60-61) — if that dynamic-import cleanup breaks, rejected/deleted member submissions leave orphaned image bytes on the shared disk (a privacy promise the attachment-store header makes explicitly) and the 400MB quota eventually bricks all future uploads.

**Fix:** Extend tests/unit/events/trusted-and-suggest.test.ts (same PGlite harness): (a) write a filler file under the test .data/events dir, call invalidateAttachmentStorageCache(), mock or shrink the cap (export it or vi.spyOn attachmentStorageBytes) and assert a suggest POST with a file returns 507 while one with no files still succeeds; (b) stub stripImageMetadata to throw UnstrippableImageError and assert 400 with the re-save message and no stored refs; (c) create-approve-delete an event with an attachment and assert the bytes are gone from disk (fs mode) after deletion.


## What held up well

The review explicitly checked (and the verifier re-checked) these areas and found them sound — listed so future reviews don't re-litigate them:

- **Core domain logic:** Hours engine (src/lib/hours.ts) is solid: Pacific-time derivation via Intl is DST-safe, split shifts and past-midnight tails (including the yesterday-tail check) are handled correctly, and parseWeeklyHours (schemas/shared.ts) rules out the 24:00/open==close edge cases. Side classifier (side.ts/side-server.ts) is a correct coarse box+divide with a safe cookie default. Boarding-pass estimate (wsf.ts) and its forecast mirror (ferry-forecast.ts boardingPassExpected) are genuinely in sync (same season window, hours, holiday weeks), and the Pacific-day override expiry in boarding-pass-store.ts is correct with no DST hazard. json-store/records.ts seed+overlay merge itself (overlay-wins-by-id, tombstone hiding, _deleted stripping) is correct, writes are transactional with audit rows, and the volunteer slot counter's row-lock+guarded-UPDATE is sound. WSF adapter's WCF date parsing, timeout/fallback paths, and delay computation check out.
- **API routes:** Authorization: all 26 admin routes gate with requireAdmin/requireRole("admin"); all portal writes (listing PUT, org PUT/POST, needs, events, events/verify) re-derive ownership from the STORED record via can(user, "edit-record", …) and pin ids server-side — no cross-tenant edit path found. Field whitelisting keeps lat/lng/name/category Chamber-controlled for non-admins. Moderation floor (holdEditProposal/holdNewRecord) is consistently applied, including the trustedAutoPublish bypass being identical across both event write paths. Upstream WSDOT/WSF calls degrade honestly (wsfFetch returns null on timeout/!ok → fallback schedule with live:false; vessel/space/alerts return empty + live:false, never fabricated data). Auth routes: dual-bucket rate limits on login/redeem, uniform 401s that don't leak account existence, session_version bump semantics handled correctly on password change, timing-safe compares on SETUP_TOKEN and BACKUP_TOKEN, invite codes are 72-bit random. Public intakes (survey, feedback, claim, privacy/request) mostly follow a consistent pattern: IP bucket before body read, raw-body byte cap before JSON.parse, idempotency-key claim placed after validation with release-on-store-failure. Caching headers on feeds/media/map routes are appropriate (immutable for content-addressed, s-maxage for feeds, no-store for vessels); Next 16 GET route handlers are dynamic by default (verified against node_modules/next/dist/docs), so unmarked GET routes are not a stale-cache bug.
- **Performance:** Checked and found solid: all public listing/kiosk pages are genuinely ISR (revalidate=60) with build-verified prerender guards; /line was purpose-built cookie-free with the empirical-busyness read deliberately excluded; page-level data fetching uses Promise.all consistently (home, /ferry, LineLander — /ferry even documents the 70-90ms win); WSF/weather/tides sit behind Next's fetch data cache with sensible windows; MapLibre is type-only imported and the ~200KB engine loads lazily behind IntersectionObserver on every public map (feature-map, ferry-vessel-map, sr104-traffic-map); the /api/media proxy uses content-addressed names with immutable caching and next/image with honest `sizes`; sharp is present (next's optional dep) so the image optimizer works in the standalone build; analytics/ferry logs are retention-pruned in SQL; auth lookups are indexed single-row queries; the geoip reader loads once in the background; ferry-observation aggregation already hoists/memoizes its Intl formatters; dbHealthy memoizes its probe.
- **Simplification & duplication:** Verified non-findings: the documented ParkingArea orphan no longer exists in code (only in stale docs — folded into the Atm finding). The unreferenced volunteer/email cluster (src/lib/email.ts, src/lib/volunteer-links.ts, src/lib/stores/volunteer-signup-store.ts, src/lib/db/volunteer-signups.ts) looks like dead code by grep but is the deliberately ship-dark E20 slice-1 substrate (commit 2298c66, 4 days old) — not reported for deletion. A full never-imported scan over src/components and src/lib found no other dead modules (map-features, map-views, import-store, privacy-backfill, growthzone, type-parity all have real consumers via routes or scripts). The two giant admin map editors (/admin/map 1832 lines, /admin/maps 2495 lines) are distinct live tools (parking-zone editor vs map CMS), both in ADMIN_NAV — their shared terra-draw scaffolding is real but extraction is not mechanical, so it didn't make the cut beyond the parking-colors constant. Kiosk components deliberately do not share the site's ferry widget (documented tradeoff in kiosk-ferry-strip.tsx). The store layer (src/lib/stores/*) is already thin, consistent wrappers over the json-store seam — no boilerplate finding there. Env/config flags all vary by environment; no permanently-one-value flags found.
- **Next.js 16 usage:** Audited against the bundled v16 docs (caching + revalidating, caching-without-cache-components, route-handlers, route segment config, metadata routes, proxy convention, PWA guide, loading.md, authentication/data-security). Correct and deliberate: proxy.ts uses the renamed v16 proxy convention properly (Node runtime, no shared-module reliance, defense-in-depth only); route handlers correctly assume v16's uncached-by-default GET semantics (tiles route even cites it) and the many force-dynamic exports are harmless intent markers; WSF/NWS/NOAA fetch revalidate windows (30s vessels → 900s schedules) match the ferry-freshness requirement, with documented signal-vs-memoization trade-off; manifest.ts is correctly static with sound id/start_url/maskable-icon reasoning; robots/sitemap force-dynamic is justified (runtime NOINDEX env, live visibility store); root layout is kept cookie/headers-free on purpose (inline localStorage bootstrap instead); the (site)/(kiosk) route-group split, viewport merging, and metadata (template titles, metadataBase, generateMetadata on all [slug] pages) follow the docs; every 'use client' component checked genuinely needs interactivity; ISR pages consistently use the cookie-free assertPageVisibleStatic gate with a unit test enforcing it; the hand-rolled service worker matches the v16 PWA guide's shape, only intercepts mode:navigate (RSC fetches pass through), and sw.js caching headers are correctly forced in next.config.ts. Typecheck/lint/tests were stated passing and were not re-run; no real member/visitor data was read; no files were modified.
- **Security:** Session cookie/token scheme is solid: HMAC-SHA256 over a base64url payload, signature compared with timingSafeEqual and a length guard (tokens.ts:97-116), exp embedded in the signed payload and checked, and pre-E06 tokens (no sv claim) rejected. Revocation works: getSessionUser() re-reads the DB and rejects on disabled or session_version mismatch (session.ts:67-82), and password change / profile / admin actions bump session_version. Password hashing is scrypt with per-hash salt and constant-time verify (tokens.ts:40-46). CSRF: I traced every state-changing portal/admin handler — all are POST/PUT/PATCH/DELETE, the cookie is HttpOnly + SameSite=Lax, and I found no state-changing GET on an authed route, so the SameSite=Lax mitigation holds (its only defense-in-depth gap is that there is no separate CSRF token, and secure is production-only, which is fine). Invite lifecycle is hardened: 14-day expiry, email/code binding, revocation, DB constraints, per-code rate limiting, and E17 mint-time ownership-conflict refusal (invite-mint.ts). Authz is centralized in one pure can() with an entitlements-narrow-never-widen contract, and portal/listing checks can(edit-record, stored.id) against the STORED record id, never client input (authz.ts, portal/listing/route.ts). File/image proxies strictly validate names: bare content-hash + allowlisted extension, explicit ../ and separator rejection, path.resolve containment check (media-store.ts:106-116, map-store.ts:106-108, attachment-store.ts:128-137), uploads strip EXIF and serve with nosniff + Content-Disposition: inline. SQL is fully parameterized via drizzle sql`` tagged templates; the only sql.raw uses interpolate in-code role/kind constants, not user input. Rich text is React-escaped and the JSON-LD dangerouslySetInnerHTML escapes < (json-ld.tsx). GitHub-issue route is admin-gated with a base64-in-HTML-comment payload that can't break out. First-run setup is fail-closed (hasAnyUsers + SETUP_TOKEN via timingSafeEqual). No secrets are logged. The setup route already demonstrates the correct constant-time compare that findings 3/4 recommend applying to the machine-token paths.
- **Test coverage:** Roadmap suspects verified as ALREADY covered (do not re-recommend): (1) Store-seam semantics — tests/unit/records-parity.test.ts pins overlay-wins-by-id, tombstone hiding, _deleted stripping/re-attachment, and doc-column shape; tests/unit/status-gate.test.ts pins pending-invisible-to-readMerged; tests/unit/write-choke.test.ts and no-fs-store-writes.test.ts guard the write path; quarantine is pinned in tests/unit/importer.test.ts (invalid rows parked, exit 2) and tests/unit/auth-migration.test.ts (quarantine traps). (2) Auth lifecycle — tests/unit/auth-v2-identity.test.ts covers mint→redeem→reuse-rejected (line ~306), expired/revoked/unknown codes, case-insensitive email binding, and session_version revocation on password change, admin reset, disable, and role change, plus the last-admin guard; tests/unit/invite-mint.test.ts covers mint validation; tests/server/onboarding-e2e.test.ts covers the full claim→invite→redeem journey. (3) Ferry-forecast properties — tests/unit/ferry-model.test.ts has band-edge tests, an integer-in-[0,100] grid property, empirical blend gating with sample floors, holiday exclusion, and a boarding-pass-parity golden across every day of 2026. (4) Events ingest/adapters/dedupe — tests/unit/events/{adapters,dedupe,ingest-and-flag,ical-parse,rrule-expand,recurrence,normalize}.test.ts, including a synthetic DST-crossing ICS fixture, tombstoning of events that leave the feed, and admin not-a-duplicate override semantics. (5) Moderation worklist — worklist-store.test.ts, worklist-sweep.test.ts (fail-closed sweep auth, idempotent re-runs, deadline handback to the Chamber), admin-worklist-route.test.ts, moderation-gate.test.ts (pending events excluded from JSON+ICS feeds). (6) R2 image proxy — r2-image-store.test.ts (client seam, metadata stripping) plus image-route-privacy.test.ts (hunts/photo admin gate, traversal rejection, cache headers). (7) Volunteer slot concurrency/idempotency/retention — volunteer-signup-store.test.ts is exemplary (20-concurrent-signups race, idempotent replay, PII anonymization). (8) Attachment intake rejections — trusted-and-suggest.test.ts covers 415/413/429 and the honeypot. (9) Cron declarations — cron-inventory.test.ts pins render.yaml schedules and the admin-route proxy table.