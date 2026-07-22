# Data Sources

**Single source of truth for where every piece of data in Explore Kingston comes from —
external APIs, seeded content, and the data the app now collects about itself.** Verified
against the code and by live web checks; facts dated below. Where research and verification
disagreed, the verified correction is what appears here.

**July 2026.** Sibling docs: [SDD.md](SDD.md) (how the adapters/stores fit together),
[ARCHITECTURE.md](ARCHITECTURE.md) (persistence seam), [OPERATIONS.md](OPERATIONS.md)
(schedulers, backups), [DEPLOY.md](DEPLOY.md) (env vars in situ), [MAPS.md](MAPS.md)
(map CMS + street-parking overlay), [SYNDICATION.md](SYNDICATION.md) (outbound feeds).

---

## How sources map to code

| Domain | Adapter / code | Seed / bundled data | Mode |
|---|---|---|---|
| WSF car ferry (Edmonds–Kingston) | `src/lib/wsf.ts`, `src/lib/ferry-status.ts`, `/api/ferry/{status,vessels}` | `src/lib/data/ferry-fallback.ts` | **wired** (live API w/ `WSDOT_API_KEY`; seeded fallback without) |
| Kitsap fast ferry (Kingston–Seattle) | `src/lib/kitsap.ts` | times hardcoded from GTFS feed S1000066 | **seeded** |
| Weather | `src/lib/weather.ts` | — | **wired** (NWS, keyless) |
| Tides | `src/lib/tides.ts` | — | **wired** (NOAA CO-OPS, keyless) |
| Ferry busyness forecast | `src/lib/ferry-forecast.ts` (pure model) | calibration = WSF "Best Times to Travel" grid; blends `ferry_observation` log | **wired** (derived; ships behind an admin flag, default OFF) |
| Ferry observation log (self-collected) | `src/lib/stores/ferry-observations.ts`, `/api/ferry/{observe,accuracy}` | append-only; grows from live WSF space+delay | **wired** (derived data source) |
| Payment / cash / boarding-pass facts | `src/lib/data/ferry-info.ts` + `ferry-info-store.ts` (admin overlay) | structured `FerryInfo` records | **seeded** (admin-editable) |
| Webcams | `src/lib/data/webcams.ts`; feature pages hotlink WSDOT images | camera list hardcoded, images live | **seeded** (list static, images live) |
| Maps / directions (deep links) | `mapSearchUrl()` / `mapDirectionsUrl()` in `src/components/ui.tsx` | — | **wired** (free Google Maps deep links, no key) |
| Leaflet basemap tiles | `src/components/{ferry-vessel-map,sr104-traffic-map,feature-map}.tsx`, Leaflet + OSM | — | **wired** (OSM raster tiles) |
| Parking (lots + street overlay) | `src/lib/data/parking.ts` (`MapZone`), `public/geo/street-parking.json` | Port/WSDOT/Diamond facts + OSM/Census-generated overlay | **seeded** (generator = OSM + Census CDP) |
| Events, restaurants, lodging, charity, hunts, itineraries | feature stores in `src/lib/stores/*` over `src/lib/data/*` | hand-curated content per feature | **seeded** (admin-editable via CMS) |
| LTAC visitor survey | `src/lib/stores/survey-store.ts`, `/api/survey` | — | **wired** (file- **or** DB-backed; see persistence seam) |

Status legend: **wired** = fetched/computed live at runtime · **seeded** = verified data
committed in the repo (needs periodic re-verification) · **planned** = documented here, not
yet built. "Derived" = the app manufactures the data itself (forecast model + observation log).

> **Persistence note.** Every mutable store branches on env presence: filesystem under
> `DATA_DIR` on the persistent-disk host (Render, live), or Neon Postgres / Vercel Blob /
> Upstash on serverless. This is invisible to the data sources below but see
> [ARCHITECTURE.md](ARCHITECTURE.md) and the env table at the end.

---

## 1. Ferries — WSDOT (Edmonds–Kingston car ferry)

`src/lib/wsf.ts` is the whole adapter. The free WSDOT access code lives in `WSDOT_API_KEY`
and **rides in every request URL** (`?apiaccesscode=…`), so these calls MUST stay
server-side. No key → every function returns the bundled fallback (`live:false`).

**What the adapter exposes today** (grew well past the old "schedule + space" pair):

| Function | Endpoint(s) | Revalidate | Returns |
|---|---|---|---|
| `getTodaysSailings()` | Schedule `/scheduletoday/{dep}/{arr}/false` (both dirs) | 900 s | today's sailings + `live` |
| `getSailingsForDate(date)` | Schedule `/schedule/{date}/{dep}/{arr}` (both dirs) | 3600 s | sailings for a Pacific date (trip planner) |
| `getValidDateRange()` | Schedule `/validdaterange` | 3600 s | published-schedule window (planner honesty) |
| `getTerminalStatus(t)` | Terminals `/terminalsailingspace/{id}` + `/terminalwaittimes/{id}` | 60 / 300 s | next-boat drive-up space + staff wait note |
| `getSailingSpace(from)` | Terminals `/terminalsailingspace/{id}` | 60 s | **per-departure** open car space (the "N spots open" line) |
| `getRouteDelays()` | Vessels `/vessellocations` | 30 s | **live minutes-late per direction** (LeftDock − ScheduledDeparture) |
| `getVesselLocations()` | Vessels `/vessellocations` | 10 s | live boat lat/lng/speed/heading/ETA for the map |
| `getRouteAlerts()` | Schedule `/alerts` | 300 s | route + all-routes alert titles |
| `getBoardingPassStatus(now)` | *(pure — no fetch)* | — | SR-104 vehicle boarding-pass **estimate** (season/hours) |

`getRouteDelays()` and `getVesselLocations()` share the same `/vessellocations` feed; delays
are computed, not fetched. `getBoardingPassStatus()` is a pure season/hours heuristic (see §7).

### Endpoints & access

| Source | URL | Access | Cost | Status in app |
|---|---|---|---|---|
| WSDOT access-code signup | https://wsdot.wa.gov/traffic/api/ | Enter an email, code issued instantly; pass as `?apiaccesscode=` | Free | **wired** (`WSDOT_API_KEY`) |
| Schedule API | https://www.wsdot.wa.gov/ferries/api/schedule/rest ([help](https://www.wsdot.wa.gov/ferries/api/schedule/rest/help)) | `/scheduletoday/{dep}/{arr}/{bool}`, `/schedule/{date}/{dep}/{arr}`, `/validdaterange`, `/alerts`, `/cacheflushdate` | Free | **wired** |
| Terminals API | https://www.wsdot.wa.gov/ferries/api/terminals/rest ([help](https://www.wsdot.wa.gov/ferries/api/terminals/rest/help)) | `/terminalsailingspace/{8,12}`, `/terminalwaittimes/{8,12}`, `/terminalbulletins/{id}` | Free | **wired** (space + waits; bulletins planned) |
| Vessels API | https://www.wsdot.wa.gov/ferries/api/vessels/rest ([help](https://www.wsdot.wa.gov/ferries/api/vessels/rest/help)) | `/vessellocations`, filter Departing/ArrivingTerminalID ∈ {8, 12} | Free | **wired** (positions + delays) |
| Fares API | https://www.wsdot.wa.gov/ferries/api/fares/rest ([help](https://www.wsdot.wa.gov/ferries/api/fares/rest/help)) | Fare line items by terminal pair (8↔12) + trip date | Free | planned (fares are seeded prose today, §7) |
| Official static GTFS | https://business.wsdot.wa.gov/Transit/csv_files/wsf/google_transit.zip | Direct download, no key (~463 KB) | Free | planned |
| GTFS-RT via OneBusAway Puget Sound | https://api.pugetsound.onebusaway.org/api/gtfs_realtime/{trip-updates\|vehicle-positions\|alerts}-for-agency/95.pb | Email oba_api_key@soundtransit.org for a key (~2 business days). Use **https** — http 301-redirects and break protobuf clients that don't follow them | Free | planned |
| VesselWatch feeds (undocumented fallback) | https://www.wsdot.com/ferries/vesselwatch/Vessels.ashx and Terminals.ashx | Public, no key | Free | not used (native REST is richer) |

### Verified facts (load-bearing)

- **Terminal IDs / RouteID.** Edmonds = **8**, Kingston = **12** (verified four ways);
  Ed-King `RouteID = 6` (`RouteAbbrev` `ed-king`, stable). `TERMINAL_IDS`/`ED_KING_ROUTE_ID`
  are the constants in `wsf.ts`. Terminal coords are hardcoded in `TERMINAL_COORDS` (verified
  against WSF GTFS) so the vessel map draws even before the API answers.
- **WCF date format.** Timestamps are `"/Date(1782997062933-0700)/"` (epoch ms + offset),
  not ISO 8601. `parseWsdotDate()` normalizes every one before it reaches the client. Nuance:
  the WCF service content-negotiates — a browser-like `Accept` returns XML with ISO dates, so
  don't test in a browser and conclude the format changed. Server fetches (no `Accept`) get
  JSON as documented.
- **`SchedRouteID` ≠ `RouteID`.** `/schedule*` take RouteID/terminal pairs; `/sailings` and
  `/allsailings` take `SchedRouteID` (changes every season). We only use the terminal-pair
  endpoints, so this never bites — but don't add a `/sailings` call without resolving it.

### Gotchas (load-bearing)

- **Key rides in the URL.** `?apiaccesscode=` is appended by `wsfFetch()`; never hand a raw
  WSF URL to the browser. Live testing 2026-07-02 showed the code was **not currently
  enforced** (endpoints answered with no/invalid codes), but the docs mandate it and
  enforcement could return — register and send it, and treat a bad key like an outage
  (`wsfFetch` returns `null` → fallback), don't assume an error response.
- **Real-time endpoints are volatile.** `/vessellocations` and `/terminalsailingspace` change
  "potentially every 5 seconds"; the adapter's revalidate windows (10–60 s) self-throttle.
  No published rate limit — stay a good citizen. Each of the three APIs has its **own**
  `/cacheflushdate`.
- **No vehicle reservations on this route.** Save A Spot covers only Anacortes/San Juans and
  Port Townsend/Coupeville — ignore `ReservableSpaceCount`. Drive-up space is the number that
  matters, and it can be `-1`/null when unavailable (the adapter coerces `< 0` to
  `undefined`/`null`).
- **Wait times are prose.** `/terminalwaittimes` is staff-entered advisory text — rendered as
  text (`waitEstimate`), never parsed; can be empty/stale off-peak. The adapter filters to
  `RouteID === 6`.
- **Delay math needs `ScheduledDeparture`.** `getRouteDelays()` skips any vessel with no
  `ScheduledDeparture`; "late" = `LeftDock − ScheduledDeparture`, or, if still `AtDock` past
  its time, `now − ScheduledDeparture`. Clamped ≥ 0; on-time reads as `null`.
- **Alerts live in two places.** Route alerts: Schedule `/alerts` (filter `AffectedRouteIDs`
  containing 6 or `AllRoutesFlag`). Terminal notices: Terminals `/terminalbulletins`. A
  complete banner needs both — only `/alerts` is wired today.
- **No SLA.** Degrade gracefully: `ferry-fallback.ts` ships an approximate two-boat summer
  schedule (~50-min headways, 30-min crossing, marked `live:false`, each sailing noted
  "Approximate seasonal time — confirm with WSDOT") plus links to
  https://wsdot.wa.gov/travel/washington-state-ferries. Trust `/validdaterange`, don't assume
  future dates are published.
- **VesselWatch `.ashx` fallback (unused, for reference).** `Vessels.ashx` (2026-07-02) is now
  strict JSON (`"7/2/2026 4:51:39 PM"` string timestamps); `Terminals.ashx` still embeds
  `new Date(NNN)` literals and needs regex-stripping before `JSON.parse`. Both undocumented,
  fallback-only. The app does not use them — native REST covers everything.

---

## 2. Ferry busyness forecast (derived — WSF "Best Times to Travel" + observation log)

`src/lib/ferry-forecast.ts` is a **pure, client-safe** model (no fetch, no env, no
server-only imports) so the `/ferry/plan` planner recomputes instantly in the browser as the
visitor drags time/direction, and SSR + hydration agree. It is an **estimate, not a
measurement** — WSF publishes live space only for the next few sailings *today*; nothing says
how busy a future Saturday will be. Every surface labels it an estimate and defers to the live
board. It ships **behind an admin flag, default OFF** (`ferry-prediction-store`).

### Calibration source — WSF "Best Times to Travel" grid (Summer 2026)

The authoritative day-of-week × departure-time vehicle-traffic source. WSF's four tiers map
to this model's score bands:

| WSF tier | Model band | Score |
|---|---|---|
| Unlikely to Fill | Light | < 20 |
| Sometimes Full | Moderate | 20–41 |
| Often Full | Busy | 42–64 |
| Likely Full | Very busy | 65–82 |
| *(no WSF tier)* | Extreme | ≥ 83 — reserved for holiday × peak-hour |

- Published at WSF's schedule/"Best Times to Travel" pages (per-route PDF/table, refreshed
  each schedule season). Cross-checked by adversarial web research. **No API** — the grid is
  hand-transcribed into the hourly demand `CURVES` in `ferry-forecast.ts`. Re-transcribe when
  the fall schedule drops (same trigger as the Kitsap GTFS refresh).
- Encodes the route's directional asymmetry: eastbound (`from-kingston`) peaks on the weekday
  AM commute to Seattle and the Sunday-evening return; westbound (`to-kingston`) peaks on the
  weekday evening and hardest on the Friday-afternoon getaway. The **2:30 PM Kingston→Edmonds
  boat fills nearly every day** — hardcoded as its own factor.
- Season multiplier: peak = WSF summer window (Jun 14 – Sep 19, factor 1.0), shoulder
  (Mother's Day → mid-Oct, 0.82), off (0.58 — commute traffic keeps the floor above zero).
  Holiday multipliers (July 4th 1.5, Memorial/Labor/Thanksgiving 1.3, Christmas/New Year 1.2)
  push the worst days into Extreme.

### Derived data source — self-collected `ferry_observation` log

WSF exposes live drive-up space + delay but **never archives** either, so the app snapshots
them itself and learns from the record.

| Aspect | Detail |
|---|---|
| Producer | `recordSailingSpaceSnapshot()` in `src/lib/stores/ferry-observations.ts`, called fire-and-forget from `ferry-status.ts` on organic traffic (throttled ≥ 10 min) |
| Backfill | `/api/ferry/observe` (GET or POST) — point a free scheduler at it for overnight gaps; write is internally throttled so extra hits return `recorded:false` |
| Scheduler | `.github/workflows/ferry-observe.yml` cron `*/15 * * * *` UTC; base URL from repo var `FERRY_OBSERVE_URL` (defaults to the Render host) |
| Scope | Edmonds–Kingston only; the next `SAILINGS_PER_DIR = 2` upcoming sailings per direction; delay stamped only on the soonest |
| Storage | Append-only, same file/DB seam as analytics: JSONL at `DATA_DIR/ferry/observations.jsonl`, or the `ferry_observation(ts, obs jsonb)` Postgres table. Retention `RETENTION_DAYS = 90`, pruned ~every 48 writes |
| Consumer | `getEmpiricalBusyness()` aggregates snapshots into an `EmpiricalTable` keyed direction × season × weekday × hour; `scoreAt()` blends it into the heuristic, weighted by sample count (`EMP_MIN_SAMPLES = 3`, ramping to `EMP_MAX_WEIGHT = 0.75` at n = 40) so early estimates stay heuristic and grow data-driven. **Holidays skip the blend** (rare spikes would wash out against ordinary-day averages) |
| Accuracy backtest | `/api/ferry/accuracy` runs `recordAccuracySnapshot()` (heuristic vs. observed) into a rolling history so the Chamber can validate the model before trusting it publicly. Scheduler: `.github/workflows/ferry-accuracy.yml` cron `0 8 * * *` UTC (~1 AM Pacific) |
| Auth | Both endpoints gate on `FERRY_OBSERVE_TOKEN` if set (`?token=` or `Authorization: Bearer`); otherwise open — writes are throttled and store only public ferry data |

- **Capacity context** (in the model header, not user-facing): the route normally runs two
  ~188-vehicle Jumbo-class boats (~376 cars/sailing); the car deck is the binding constraint,
  which is why walk-ons effectively always board. The one thing the model **can't see** is a
  small substitute vessel (e.g. a 64-car boat) — the live board is the authority for that.

---

## 3. Ferries — Kitsap Transit (Kingston–Seattle fast ferry, routes 401/404)

| Source | URL | Access | Cost | Status in app |
|---|---|---|---|---|
| Official rider page | https://www.kitsaptransit.com/service/fast-ferry/kingston-fast-ferry | Public HTML | Free | seeded (copy facts) |
| Static GTFS | https://pride.kitsaptransit.com/gtfs/google_transit.zip | Direct download, no key. Feed S1000066, valid **2026-06-14 → 2026-09-12**, contact lindsayc@kitsaptransit.com | Free (non-commercial license) | seeded (times in `src/lib/kitsap.ts`) |
| GTFS-RT vehicles / trips | https://kttracker.com/gtfsrt/vehicles · https://kttracker.com/gtfsrt/trips | Open protobuf, no key | Free | planned |
| Service alerts (GTFS-RT) | https://cdn.simplifytransit.com/kitsap-transit/alerts/service-alerts.pb | Open protobuf, no key | Free | planned |
| Ferry Tracker (rider map) | https://kttracker.com/map?routes=401,404 | Public web app — deep-link target | Free | **seeded** (link out — `FAST_FERRY_FACTS.trackerUrl`) |
| Fares page | https://www.kitsaptransit.com/fares | Public HTML (fares effective Oct 1, 2025) | Free | seeded (copy facts) |
| Developer terms | https://www.kitsaptransit.com/terms-and-conditions#developer | Public; **commercial use requires written permission** | Free (non-commercial) | action item |

`src/lib/kitsap.ts` hardcodes the GTFS-derived times (`WEEKDAY_/SATURDAY_FROM_KINGSTON`,
`…FROM_SEATTLE`, 39-min crossing) and returns them `live:false`. `FAST_FERRY_FACTS` holds the
scannable copy (fares, terminals, boarding).

### Gotchas (load-bearing)

- **GTFS feed expires 2026-09-12.** After that a naive importer shows an empty schedule.
  The hardcoded summer times need a manual refresh when the fall schedule drops (or build the
  GTFS ingest job — see Roadmap — and watch `feed_info.feed_end_date`).
- **Direction-based fares.** $2.00 adult **to** Seattle, $13.00 **from** Seattle (~$15 round
  trip); reduced $1.00/$6.50; youth 18 and under free; monthly pass $210/$105. Explain it or
  visitors assume ~$4 round trip. GTFS `fare_attributes` confirms $2/$13.
- **Directions are separate routes.** GTFS models eastbound `route_id 401` and westbound
  `404` (both `route_type` 4) instead of `direction_id` — filter for both. The old
  routes.txt duplicate-row bug is **not** present in S1000066.
- **No Sunday service; Saturday is seasonal** (`month >= 5 && month <= 9` in the adapter;
  Oct–Apr Saturdays suspended in 2025). Route Sunday visitors to the WSF car ferry.
- **No seat reservations.** 349-seat MV Finest (Kitsap rounds to 350; MV Melissa Ann backup),
  first-come walk-on; arrive ~10 min early. "Reservation" mentions in the wild are the
  Bremerton route or the phone-booked (1-844-475-7433, by 4 PM the day before, weekdays only)
  Kingston Ride commuter shuttle — which can't serve Saturday sailings.
- **Terminals confuse people.** Seattle side is **Pier 50** (801 Alaskan Way, shared with the
  King County Water Taxi), *not* WSF Colman Dock at Pier 52.
- **PugetPass conflict.** Fares page says PugetPass is **not** honored on fast ferries; an
  older FAQ says it is. ORCA E-purse is safe to state; resolve PugetPass with the agency
  before publishing (Action items).
- **License.** Developer terms are revocable, as-is, no logos, commercial use prohibited
  without written permission — get the Chamber's permission email sent (Action items).

---

## 4. Weather & Tides

Both keyless, both free, both wired.

| Source | URL | Access | Cost | Status in app |
|---|---|---|---|---|
| NWS forecast (Kingston gridpoint) | https://api.weather.gov/gridpoints/SEW/121,78/forecast | Keyless REST; **requires an identifying `User-Agent`** | Free | **wired** (`src/lib/weather.ts`, revalidate 1800 s) |
| NWS point lookup (how the gridpoint was derived) | https://api.weather.gov/points/47.796,-122.498 | Resolves to office SEW, gridpoint 121,78 | Free | reference |
| NOAA CO-OPS tide predictions | https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&station=9445639&datum=MLLW&interval=hilo | Keyless REST | Free | **wired** (`src/lib/tides.ts`, revalidate 21600 s) |
| Station page | https://tidesandcurrents.noaa.gov/stationhome.html?id=9445639 | "Kingston, Appletree Cove" | Free | reference |

### Gotchas

- **NWS requires a User-Agent.** `weather.ts` sends `visit-kingston-wa (community tourism
  site)`; anonymous requests get rejected. Gridpoint **SEW/121,78** is hardcoded from
  47.796,-122.498 (ferry dock).
- **Tide station 9445639, not 9445478.** A naive "Kingston WA tides" lookup returns 9445478 —
  that's **Union, Hood Canal**. The correct station is **9445639 Kingston, Appletree Cove**
  (datum MLLW, hi/lo interval, `time_zone=lst_ldt`, English units).
- Roadmap: NWS marine/coastal-waters zone forecast (PZZ1xx via `/zones?type=marine`) for
  crossing conditions; AirNow for smoke season.

---

## 5. Webcams

`src/lib/data/webcams.ts` holds 11 WSDOT still-image cams (6 Kingston-side, 5 Edmonds-side) as
plain hotlinkable JPEGs on `images.wsdot.wa.gov` — no key. Verified live 2026-07-02.

| Source | Access | Cost | Status in app |
|---|---|---|---|
| Kingston cams (6): Lindvog `orflow/104vc02390`, Barber `orflow/104vc02314`, Ferry Sign East/West `wsf/kingston/fse\|fsw`, Toll Booths `orflow/104vc02466`, Terminal `orflow/104vc02465` | Plain `<img>` hotlink | Free | seeded |
| Edmonds cams (5): Pine `104pine`, Underpass `104underpass`, Dayton `104dayton`, Holding `holding`, Wait-Time Sign `104vms_wts` (all under `wsf/edmonds/`) | Plain `<img>` hotlink | Free | seeded |
| Highway Cameras REST (metadata) | https://wsdot.wa.gov/traffic/api/HighwayCameras/HighwayCamerasREST.svc — `SearchCamerasAsJson?AccessCode={code}&StateRoute=104` (same WSDOT code) | Free | planned (URL-churn checker) |
| Governing terms | https://wsdot.wa.gov/about/policies/travel-information-disclaimer — as-is, no attribution required; "Courtesy WSDOT" is the community norm | Free | seeded (credit line) |
| Skunk Bay Weather (Hansville, ~7 mi N) | https://www.skunkbayweather.com/ — link only; embedding needs owner OK (greg@skunkbayweather.com) | Free to view | link out |
| Port of Edmonds cams | https://portofedmonds.gov/marina-camera/ — two cams; embed terms unpublished | Free to view | link out |
| Port of Kingston | https://portofkingston.org/ — **no webcam exists** (verified); future Chamber pitch | n/a | gap |

Camera-list pages the seed points back to:
`https://wsdot.com/ferries/vesselwatch/cameradetail.aspx?terminalid={8,12}`.

### Gotchas (load-bearing)

- **No CORS, no Cache-Control.** `images.wsdot.wa.gov` sends neither. Plain `<img>` hotlinks
  work; `fetch()`/canvas reads fail. Append a cache-buster (`?t=${Date.now()}`) or browsers
  show stale frames forever. Don't route through the Next image optimizer (frames change every
  minute and would thrash the cache).
- **Snapshots, not video.** `refreshSeconds` reflects measured cadence: newer `orflow/` cams
  ~60 s, older `wsf/` cams 120 s (1–5 min). Show image age; flag cams stale > 10 min.
- **URL churn is real.** Kingston cams moved to `orflow/104vcNNNNN.jpg` with the SR 104
  Traffic Management System rollout (announced April 2026, fully live **June 1, 2026**). The
  WSDOT **ArcGIS camera layer is stale** — it still maps Kingston cams to 2003-era `wsf/`
  URLs. Do not resurrect them. Detect the next migration with the Highway Cameras REST check.
- **Skunk Bay blocks non-browser UAs** (HTTP 406 to curl) — a server-side freshness check
  needs a browser `User-Agent`; embedding still needs owner permission.
- **Search pollution.** "Kingston webcam" surfaces Jamaica/Ontario/NY cams and aggregators
  rebroadcasting these same WSDOT feeds — always source from `images.wsdot.wa.gov` directly.

---

## 6. Maps

| Source | URL | Access | Cost | Status in app |
|---|---|---|---|---|
| Google Maps URLs (deep links) | https://developers.google.com/maps/documentation/urls/get-started | No key, no signup; `api=1` param is **mandatory** | Free, unlimited | **wired** (`mapSearchUrl`/`mapDirectionsUrl` in `src/components/ui.tsx`) |
| OSM raster tiles (Leaflet basemap) | https://tile.openstreetmap.org (currently) · policy: https://operations.osmfoundation.org/policies/tiles/ | Best-effort tile server, no key | Free (best-effort, no SLA) | **wired** — but see the debt note below |
| Leaflet + Geoman | https://leafletjs.com · https://github.com/geoman-io/leaflet-geoman | `npm` deps, client components | Free (open source) | **wired** (admin polygon/feature editing at `/admin/map`, `/admin/maps`) |
| OpenFreeMap / MapLibre / Protomaps (vector-tile swap targets) | https://openfreemap.org · https://maplibre.org · https://docs.protomaps.com | No-key vector tiles / static PMTiles | Free–low | planned (only if OSM raster proves inadequate) |

The map CMS (`/map`, `/admin/maps`) and parking editor (`/admin/map`) render on Leaflet + OSM
tiles; see [MAPS.md](MAPS.md). Google is used only for outbound deep links (free Street View
deep links, no key) — the app's own curated place data avoids ever plotting Google Places on a
non-Google map (a ToS trap).

### Gotchas (load-bearing)

- **The $200/month Google credit is gone** (since March 1, 2025). Free usage is per-SKU; the
  Embed API is the one that's still **unlimited free**. Any Google key needs a billing account
  with a card even for Embed — hard-cap quotas and restrict the key by HTTP referrer.
- **Deep links:** omit `api=1` and Google silently ignores every parameter. URL-encode values;
  2,048-char limit; `travelmode=driving|walking|bicycling|transit`.
- **OSM tiles are best-effort — and the app currently uses the one URL it shouldn't.** The
  Leaflet basemaps hardcode `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (e.g.
  `ferry-vessel-map.tsx`). The OSMF tile policy explicitly discourages this for production
  traffic; it can be throttled/withdrawn without notice. **Debt:** move the tile URL to a
  single config constant and swap to OpenFreeMap / Protomaps-on-R2 / a MapTiler-Stadia free
  key before traffic grows.

---

## 7. Ferry payment, cash & the SR-104 vehicle boarding pass (structured facts)

**There is no ATM/cash-machine dataset.** The old `src/lib/data/atms.ts` was deleted and the
`Atm`/`ParkingArea` interfaces in `src/lib/types.ts` are **orphaned/legacy** (unused). Cash
guidance now lives as structured, admin-editable facts in `src/lib/data/ferry-info.ts`
(overlaid by `ferry-info-store.ts`, edited at `/admin/ferry-info`, rendered on `/ferry`).
Four record groups: `FERRY_PAYMENT`, `CASH_TIPS`, `BOARDING_PASS`, `SOURCES`.

### Verified payment / cash facts

| Fact | Detail | Source |
|---|---|---|
| **Card surcharge** | **3% on every credit/debit ferry fare since March 1, 2026** (per RCW 47.60.860). A pre-loaded ORCA card *not* loaded at a WSF facility avoids it | wsdot.wa.gov/…/ticket-information |
| **Kiosks are card-only** | The self-serve ticket kiosks at Kingston are card-only | verified |
| **Staffed tollbooth takes cash** | Cash **still works at the staffed tollbooths** — but there's no ATM at the dock | memory-confirmed / ferry-info |
| **No ATM at the dock** | Nearest cash machines are **up in downtown Kingston**; get cash before you reach the booth. The Kingston Center grocery is **Grocery Outlet** | memory-confirmed |
| **Free walk-on from Kingston** | Walking on from Kingston is free — WSF collects passenger fares only at Edmonds. Never display a "Kingston walk-on fare" | verified |
| **Good To Go! not accepted** | Highway tolling only; will not pay a ferry fare | verified |

`CASH_TIPS` is a scannable list the Chamber can reorder without touching prose. `SOURCES`
carries the WSF ticket page and the WSDOT blog post announcing the SR-104 system.

### SR-104 vehicle boarding pass (memory-confirmed corrections baked in)

A WSDOT/WSF queue system for the Kingston vehicle line: drivers pull a timestamped pass (like
a parking-garage ticket) to hold their place. Facts in `BOARDING_PASS`:

- **Drivers only.** Foot passengers, cyclists, motorcycles, and medical-priority-pass holders
  are **exempt** — they just board.
- **When:** peak hours **8 a.m.–8 p.m.**, daily in season (Mother's Day → Indigenous Peoples'
  Day, **Oct 12, 2026**), plus every Saturday/Sunday year-round, plus Thanksgiving,
  Christmas, and New Year's weeks. Outside those windows, no pass.
- **Where:** the automated dispenser is on the ferry-bound side of SR 104 **just west of
  Lindvog Road NE** (~1 mile before the tollbooths). An overhead flashing-light advisory sign
  at **Barber Cutoff Road** (~1 mile farther west) signals when the system is active.
- **Voids:** leave the line after pulling a pass and it's void — re-enter for a new one.
- **Current note (early July 2026):** the automated dispenser has been **down**, so a
  uniformed traffic-control officer is **handing passes out by hand at the Lindvog Road
  staging area**. This is the admin-editable `currentNote`.

**How the app derives the live verdict** (two layers, both in code):

1. `getBoardingPassStatus(now)` in `wsf.ts` — a **pure estimate** from season + hours (peak
   8–20; weekend, in-season ≈ May 10–Oct 13, or holiday week). `source: "estimate"`. Mirrored
   by `boardingPassExpected()` in `ferry-forecast.ts` (kept in sync by hand so the model stays
   client-safe).
2. `getEffectiveBoardingPass()` (`boarding-pass-store.ts`) — an **admin daily override**
   (`/admin/ferry-info`) stamped with the Pacific day it was set; `getBoardingPassStatus`'s
   verdict is replaced while that day is today, and it **silently lapses at Pacific midnight**
   (no timer, no DST math). `source: "override"` when applied.

The estimate is UX/routing only — the flashing sign at Barber Cutoff is always the authority.
The `/ferry` "get in the ferry line" nav routes drivers to the SR-104 staging point via a
forced turnaround (`src/lib/ferry-line.ts`), never a mid-highway U-turn.

---

## 8. Fares (seeded prose, not yet the Fares API)

Ed-King fares are currently **seeded copy** inside the ferry-info payment records, not pulled
live. Reference figures (verify against the WSF page before relying on them):

- Ed-King fares page:
  https://www.wsdot.wa.gov/ferries/fares/faresdetail.aspx?departingterm=8&arrivingterm=12
- As of 7/2/2026 (summer rates, WSF raises fares most Octobers): adult $11.35, senior $5.65,
  youth free, car+driver < 22 ft $27.00, motorcycle $11.80. **Fares are dated** — store with
  effective dates or wire the Fares API (planned, §1).

---

## 9. Parking (lots + street overlay)

No live parking APIs — all seeded, with `confidence` and source notes. Two data shapes:

1. **`MapZone` records** in `src/lib/data/parking.ts` (the current shape; **not** the legacy
   `ParkingArea` type) — Port lots, Diamond D515, park-and-rides, ferry-holding, each with a
   center, optional polygon, `confidence` ("verified"/"probable"/"unverified"), `overnight`,
   and a `sourceNote`. Overlaid by `parking-store` and drag-editable at `/admin/map`.
2. **`public/geo/street-parking.json`** — the color-coded street overlay, **generated** by
   `scripts/gen-street-parking.py` from two external inputs (below).

### Street-overlay generator inputs

| Input | Source | How |
|---|---|---|
| Street geometry | **OSM via Overpass** | `POST https://overpass-api.de/api/interpreter` — highways (primary/secondary/tertiary/residential/unclassified) in the Kingston UGA bbox `47.770,-122.530,47.812,-122.483`, `out geom` |
| Town boundary | **US Census TIGERweb** — Kingston CDP GEOID **5335870** | `tigerweb.geo.census.gov/…/Places_CouSub_ConCity_SubMCD/MapServer/5/query?where=GEOID='5335870'&f=geojson` |
| Parking rules | 2015/2016 Kitsap County "Kingston Complete Streets" study; Port of Kingston 2025 policy; KCC 46.02/.04 | hardcoded `NAME_RULES` + per-segment overrides in the script |

Segments are point-in-polygon clipped to the CDP boundary and written minified. Rebuild: fetch
both inputs fresh (commands in the script header), then
`python3 scripts/gen-street-parking.py <streets-raw.json> <kingston-cdp.json>`.

### Verified facts

| Source | Detail | Cost |
|---|---|---|
| Port of Kingston parking | Live page + 2025 policy PDF; T2 text-to-pay zones POKPARK/POKHILL/POKTT (short code 25023) | $12/12h car, $15 truck+trailer, $6 motorcycle, $3.49/hr short-term, $139.99/mo permit |
| Diamond D515 (NE 1st & Ohio, **73 stalls** per WSF) | PermitPoint; card kiosk, PayByPhone, ParkMobile | $8/0–12h, $12/12–24h; monthly **$125.70** (WSDOT's page shows stale $100) |
| George's Corner Park & Ride | Kitsap Transit list; ~2.8 mi west, bus connection | Free |
| WSF Kingston terminal detail | terminaldetail.aspx?terminalid=12 — address, tally system, pickup rules | Free |

### Gotchas (load-bearing)

- **Street rules are 2015-era.** Every street entry is "probable" and carries "Per the 2015
  county study — signs on the pole always win. Not re-surveyed since Complete Streets
  construction." Confidence flags are not decoration; render them.
- **Overnight in Port numbered spaces is PROBABLE, not confirmed** — the Port never explicitly
  authorizes it for cars. Publish "call the Port office first: 360-297-3545."
- **No RV parking on Port property** (per the Port's live site — stricter than the policy PDF;
  publish the conservative version). RV overnighting banned 10 pm–8 am elsewhere.
- **Pennsylvania Ave is unrestricted on ONE SIDE ONLY**; the other side is no-parking.
  **NE Georgia Ave** is the closest no-limit free street parking to the ferry.
- **SR 104 addresses geocode badly** (8xxx at George's Corner, 10–11xxx downtown, 26xxx
  cross-parcels) — store verified lat/lng, never geocode at build time. Re-verify all rates
  quarterly (Diamond reprices monthly permits; the Port revises its schedule).
- Diamond details come from the WSDOT terminal page + PermitPoint — Kitsap Transit's
  park-and-ride list does **not** include it; don't cite KT for it.

---

## 10. Events

| Source | URL | Access | Cost | Status in app |
|---|---|---|---|---|
| **explorekingstonwa.com — The Events Calendar REST** (discovery) | https://explorekingstonwa.com/wp-json/tribe/events/v1/events | Public Tribe REST, no key — the Chamber's own site, machine-readable | Free | **ingest built (E12)** — source `tribe-explorekingstonwa`, enabled-but-empty-tolerant (`total: 0` on every probe through 2026-07-20); precedence per docs/adr/ADR-0005-events-canonical-source.md (in-app > GrowthZone > Tribe, from ADR-0002) |
| Chamber GrowthZone calendar | https://business.kingstonchamber.com/events | Public HTML; per-event iCal `/events/ICal/[slug]-[id].ics`; staff-generated whole-calendar feed URL supported once delivered (`AMS_CALENDAR_FEED_URL` / calendar-sources record — OPERATIONS §9 item 6b) | Free (iCal) | **ingest built (E12)** — source `ams-ical`, enabled, **transitional: ends at the R3 freeze / GrowthZone cancellation ~April 2027** (docs/adr/ADR-0005-events-canonical-source.md; disable = admin toggle, no deploy) |
| Kingston Chamber WordPress (kingstonchamber.com) | /wp-json/tribe/events/v1/events | Tribe REST live but returns **0 events** — empty shell | Free | do not integrate |
| Port of Kingston | https://portofkingston.org/wp-json/tribe/events/v1/events | Public Tribe REST, no key — 32 events on 2026-07-20, structured | Free | **ingest built (E12)** — source `tribe-portofkingston`, **disabled pending Chamber sign-off** (ask-first) |
| Visit Kitsap (county DMO) | https://visitkitsap.com/ | dates only as prose in HTML (acf empty) — push target, not pull source | Free | push target |
| Facebook Events | https://developers.facebook.com/docs/graph-api/reference/event/ | Public events API removed 2018; scraping violates ToS | n/a | output channel only |

Current state: **unified-calendar ingest is BUILT (E12), shipping dark.** The hourly Render
cron (`render.yaml` `events-ingest`) mirrors enabled sources into the `external-events`
store; the merged calendar (pure dedupe + RRULE expansion in `src/lib/events/`, precedence
recorded in docs/adr/ADR-0005-events-canonical-source.md) renders on `/events`,
`/api/feeds/events`, and the portal date-deconfliction lookup **only when the
unified-calendar flag is ON** (`/admin/events-sources`; E15 flips it at launch). Flag OFF,
those surfaces serve exactly the seeded calendar: `src/lib/data/events.ts` overlaid by
`event-store`, editable in the portal + admin. The app emits its own events feed at
`/api/feeds/events` (JSON + `?format=ics`) — see [SYNDICATION.md](SYNDICATION.md). Quarterly
drift alarm: `npm run events:probe` (writes `docs/adr/events-source-probe.json`).

### Gotchas (load-bearing)

- **Two Chamber domains.** kingstonchamber.com (WordPress, calendar **empty**) vs.
  business.kingstonchamber.com (GrowthZone — where Chamber-entered events live today). The
  Chamber's own explorekingstonwa.com also runs The Events Calendar with a live Tribe REST API.
  **Since ADR-0002 (2026-07-10), the app itself is the events system of record and entry point**;
  GrowthZone (via the staff-generated whole-calendar iCal, OPERATIONS §9 item 6b) and Tribe are
  transitional ingest feeds, precedence in-app > GrowthZone > Tribe.
- **No publicly guessable GrowthZone calendar-wide feed (verified 2026-07).** All five candidate
  URLs checked — `/events/ical` is a soft-404 (see docs/adr/ADR-0001-ams-ground-truth.md; rerun
  `npm run ams:checks` to re-verify). Staff can generate a tokenized feed URL in the back office
  (OPERATIONS §9 item 6b) — that staff-generated feed is the planned transitional ingest path.
- **Dedupe or show triplicates.** July 4th and Kingston Public Market appear on multiple
  calendars — dedupe on normalized title + start date, prefer the Chamber record.
- **Timezones/recurrence.** All feeds are America/Los_Angeles; expand RRULEs / VTIMEZONE or
  only the first date shows.

---

## 11. Restaurants & Lodging

Both hand-curated first-party directories (no platform menu APIs are viable at this scale);
`src/lib/data/{restaurants,lodging}.ts`, overlaid by `business-store`/listing stores, edited
at `/admin/listings`. Ordering is deep-links + `tel:` ("Call to order" is a first-class
feature). The app exposes per-business hours/open-now via `/api/feeds/business/[id]`.

| Source | Access | Status |
|---|---|---|
| Explore Kingston dining / accommodations (Chamber) | https://explorekingstonwa.com/dining-cafes/ · /accommodations/ — canonical lists | seeded |
| Toast / SpotOn / SpotHopper ordering pages | Public deep links; Toast **403s server-side fetches** (browser-only verification). The Saucy Sailor = SpotHopper; Los Tres Compadres = SpotOn | seeded (link out) |
| Google Places API (New) — hours only | Server-side, `currentOpeningHours` in the **Enterprise** SKU; ToS forbids persistently storing hours | planned |
| Airbnb / Vrbo-Expedia / Booking.com | Airbnb: deep links only (no API, no affiliate). Expedia Creator + Booking-via-CJ/Awin are affiliate layers (~4%) | seeded links; affiliate planned |

### Gotchas (load-bearing)

- **Menus need humans.** Toast/SpotOn/SpotHopper APIs are closed and Google has no menu data —
  in-app menus = manually transcribed, owner-approved content maintained in the CMS.
- **Small-town churn is the real data problem.** Downpour → Friends and Neighbors Brewing
  (Oct 2, 2025, same address); aggregators are stale. Reconcile against the Chamber quarterly.
- **Toast slugs rot** and 403 server-side — stored order URLs need browser verification, not an
  automated checker. `cellarcat.com` fails TLS — don't ship that link.
- **Airbnb API is closed — deep links only, earns $0.** Any vendor selling "Airbnb API" access
  is reselling scraped data in violation of ToS. Affiliate money is coffee money; FTC
  disclosure + `rel="sponsored"` required once any affiliate link ships.
- **The casinos aren't on the accommodations page** — The Point and Clearwater appear as
  attractions; add them to lodging deliberately.

---

## 12. LTAC visitor survey

`/api/survey` + `src/lib/stores/survey-store.ts` mirror the JLARC lodging-tax reporting schema
(RCW 67.28.1816). File- **or** DB-backed via the same persistence seam (`survey_response`
append table on Postgres). Kingston is unincorporated — the **Kitsap County LTAC** is the
authority. The survey is anonymous (zip-code micro-survey, method = Informal Survey, no PII).

- Schema mirror: JLARC Data Field Definitions PDF (six metric groups — Overall Attendance,
  50+ Miles, Out of State/Country, Paid Overnight Lodging, Did Not Pay, Paid Lodging Nights;
  each with Predicted/Actual/Method/Explain).
- The full statutory / grant-cycle detail lives with the Chamber action items below and in the
  earlier research; the LTAC grant window (2027 funds) is **Oct 1–30, 2026**.

---

## Action items for the Chamber

1. **Get a WSDOT access code** — https://wsdot.wa.gov/traffic/api/, instant and free. Set
   `WSDOT_API_KEY`. (Live on Render already; keep it set.) Without it the app serves the
   bundled fallback and no live space/delays/vessels.
2. **Generate the GrowthZone whole-calendar iCal feed** (OPERATIONS §9 item 6b) — the
   transitional ingest path now that the app is the events system of record per
   docs/adr/ADR-0002-app-first-events-and-manual-exports.md; the Tribe REST feeds
   (explorekingstonwa.com, Port of Kingston) are lower-precedence supplements.
3. **Send the Kitsap Transit permission email** (lindsayc@kitsaptransit.com — the GTFS
   `feed_info` contact) for written OK to use the GTFS/GTFS-RT feeds in a Chamber tourism app;
   same email can resolve the **PugetPass contradiction**.
4. **Restaurant menu partnership workflow** — the only legal, accurate menu source is
   owner-supplied, owner-approved content in the CMS (Toast/SpotOn/SpotHopper APIs are closed,
   Google has no menu data). Bundle a quarterly "anything change?" check.
5. **LTAC grant cycle** — Kitsap County RFP **Oct 1–30, 2026** (2027 funds). Apply as the
   Chamber (501(c)(6), eligible), framing the app as "tourism promotion" under RCW 67.28.080,
   with the survey methodology named.
6. **Softer asks:** Skunk Bay embed permission (greg@skunkbayweather.com); pitch the Port of
   Kingston on a marina webcam (downtown has zero); confirm free VolunteerKitsap agency
   registration with United Way.

## Roadmap integrations

- **GTFS ingest job** (weekly cron) — download `pride.kitsaptransit.com/gtfs/google_transit.zip`,
  regenerate the fast-ferry times, alert when `feed_info.feed_end_date` nears (current feed
  dies **2026-09-12**). Same job can pull the WSF static GTFS.
- **Kitsap GTFS-RT** — proxy `kttracker.com/gtfsrt/{vehicles,trips}` (decode with
  `gtfs-realtime-bindings`), filter 401/404, power a "boat is here" widget; alerts from
  `cdn.simplifytransit.com/.../service-alerts.pb`. Fallback: deep-link the tracker map.
- **WSF Fares API** — replace the seeded fare prose (§8) with live line items.
- **WSF terminal bulletins + Highway Alerts + Hood Canal Bridge drawspan** (same access code) —
  a drawspan opening halts SR 104 for 45+ min; a bulletin banner needs `/terminalbulletins`.
- **NWS marine zone forecast** for crossing conditions; **AirNow** for smoke season.
- **Weekly link-checker** for ordering/menu/lodging URLs — but Toast/DoorDash 403 server
  fetches, Airbnb may 403 datacenter IPs, Skunk Bay 406s non-browser UAs: flag those for
  manual browser review rather than auto-failing.

---

## Environment variables (data-source-relevant)

Authoritative source: `.env.production.example`, `render.yaml`, `fly.toml`. See
[DEPLOY.md](DEPLOY.md) for full deployment context.

| Var | Required? | Purpose | Notes |
|---|---|---|---|
| `WSDOT_API_KEY` | optional | Live Edmonds–Kingston ferry data (`wsf.ts`) | Absent → bundled fallback schedule, no live space/delays/vessels |
| `NEXT_PUBLIC_SITE_URL` | **required in production** | Absolute origin for shared-link cards / feeds (`layout.tsx` `metadataBase`) | Wired in `render.yaml`/`fly.toml`/`.env.production.example`. **Build-time** — a dashboard-only change needs a rebuild. Defaults to `http://localhost:3000` if unset |
| `FERRY_OBSERVE_TOKEN` | optional | Gates `/api/ferry/{observe,accuracy}` | If set, requires `?token=` or `Authorization: Bearer`; else open |
| `AUTH_SECRET` | **required** | Signs session cookies (`auth.ts`) | Not a data source, but required to boot |
| `DATABASE_URL` | **required (all deploys, E05)** | Neon Postgres — `record` + append tables (`analytics_event`/`survey_response`/`ferry_observation`); the only home for structured data | POOLED url (host has `-pooler`), ending `?sslmode=verify-full` (docs/DEPLOY.md §2e — Neon's copy button gives `require`, which pg v9 will reinterpret as unauthenticated). `/api/health` 503s without it, so a deploy missing it fails closed |
| `BLOB_READ_WRITE_TOKEN` | prod-only (Vercel) | Vercel Blob for uploaded images | `hasBlob()` auto-detects |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | prod-only (Vercel) | Shared rate limiter (`rate-limit.ts`) | Needed on serverless; else in-process Map |
| `DATA_DIR` | disk hosts | Persistent-disk root (`/data` on Render) — since E05 holds only images/hunt photos (until E15) | **NOT set on Vercel** — Blob takes over images |

The self-collected ferry-observation schedulers use repo-level GitHub config, not app env:
`FERRY_OBSERVE_URL` (Actions variable, defaults to the Render host) points the observe/accuracy
crons at the deployment.

---

## Hosting on explorekingstonwa.com (verified 2026-07-02)

The Chamber site is WordPress 7 + Elementor on a VPS at **165.140.69.20**, which also serves
the domain's **DNS and email** (MX + SPF on the same box) — **do not move nameservers.**

Who controls what (re-measured 2026-07-22): the **registrar is NameCheap**, and records are
**not** edited there — the domain uses custom nameservers, so NameCheap's DNS tab is inert.
Registry delegation is `ns1/ns2.enticemedia.com`; the zone's own NS are
`ns1/ns2.vps42664.nodevm.com`; all four resolve to 165.140.69.20. The IP belongs to Name Hero,
LLC (the infrastructure vendor), and the box is most likely administered by **Entice Media**.
cPanel (`:2083`) and WHM (`:2087`) are both live on it.

**Path to go live:** add `app` **CNAME → `explore-kingston.onrender.com.`** in the **cPanel Zone
Editor on that VPS**, then add the custom domain in the **Render** dashboard. Never via cPanel's
Subdomains tool (it writes a shadowing A record) and never a redirect record. Zero impact on the
WordPress site, apex, or email. Full procedure and failure modes: [DEPLOY.md §6](DEPLOY.md).
If the app ever replaces the WP site, swap the apex A record at cutover.
(This subdomain move is **deferred until launch** — the running home is
https://explore-kingston.onrender.com.)

**Bonus discovery (see §10):** explorekingstonwa.com runs The Events Calendar with a live Tribe
REST API (`/wp-json/tribe/events/v1/`) — a machine-readable event feed the Chamber already
controls, and the strongest candidate to replace the `src/lib/data/events.ts` seed.
