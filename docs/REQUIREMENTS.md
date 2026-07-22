# Explore Kingston — Requirements Specification

**Version 3.0 · July 2026 · Status: Phase 1 deployed and live on Render
(https://explore-kingston.onrender.com). This document specifies the full
requirement set the running system satisfies, plus honestly-flagged gaps.**

This is the authoritative statement of *what the system must do and why*. It
serves three uses: (1) maintaining the current implementation, (2) evaluating
changes against original intent, and (3) re-creating the system from scratch
(an improved v2) without access to the original code.

Companion documents: [SDD.md](SDD.md) (how it is designed),
[ARCHITECTURE.md](ARCHITECTURE.md) (system structure and decisions),
[DATA_SOURCES.md](DATA_SOURCES.md) (every external source, verified),
[MAPS.md](MAPS.md) (the map CMS and parking model),
[SYNDICATION.md](SYNDICATION.md) (outbound propagation plan),
[OPERATIONS.md](OPERATIONS.md) (runbook), [DEPLOY.md](DEPLOY.md) (deploy
topology and the persistence seam), [ROADMAP-V2.md](ROADMAP-V2.md)
(prioritized improvements).

The product is named **Explore Kingston** in the UI — the companion app to
explorekingstonwa.com. The repository is `visit-kingston`.

---

## 1. Vision and stakeholders

**Vision.** One mobile-first web app where anyone passing through Kingston,
Washington — ferry riders above all — can answer, in seconds, on a phone:
*when is my boat, how busy is the line, which side of the water am I on, where
do I park, what's open right now, what's happening today, and what should I do
with the time I have?* The same system is the Greater Kingston Chamber of
Commerce's operating platform: businesses and nonprofits maintain their own
listings, hours, events, and volunteer needs in one place; the Chamber edits
site copy, page visibility, ferry facts, itineraries, and every map from admin
screens without a developer; and that single source of truth flows outward
(site pages, feeds, embeds, and eventually Google/Apple/social platforms).
Visitor activity is measured — anonymously and honestly — to support Lodging
Tax (LTAC) grant applications that fund the town's tourism work.

**Stakeholders.**

| Stakeholder | Stake |
|---|---|
| Visitors (primary) | Fast, accurate, mobile answers; no accounts, no creep factor |
| Greater Kingston Chamber of Commerce | Owns the platform; admin control of all content; LTAC-grade data; member value |
| Local businesses | Free presence they control; hours/events propagation; foot traffic |
| Local nonprofits | Volunteer recruiting; event date deconfliction |
| Kitsap County LTAC / JLARC | Aggregate visitor metrics in grant applications (RCW 67.28) |
| Project owner (Mat) | Personal project, low-single-digit $/month budget, personal (non-work) accounts |

**Personas.**

- **Deckhand Dana** — walked on at Edmonds, 4 hours in Kingston, phone in
  hand, wants food + a plan + the boat home. Never scrolls past the fold.
- **Line-waiter Lee** — sitting in the SR-104 holding line as a driver, wants
  to know whether to bail, park, and walk on; checks webcams, drive-up space,
  and whether a vehicle boarding pass is required today.
- **Planner Priya** — deciding *which day and which sailing* to drive over a
  week from now; wants a busyness estimate she can trust and a calendar
  reminder for the boat she picks.
- **Arriver Alex** — on the Edmonds side of the water, hasn't crossed yet;
  wants the app framed around *getting to* Kingston, not leaving it.
- **Owner Maria** — runs a restaurant; changes hours seasonally; wants to type
  them once and stop fielding "are you open?" calls.
- **Coordinator Chris** — runs a nonprofit's events; needs volunteers and
  needs to not schedule against the fireworks.
- **Chamber Director** — administers everything (copy, pages, ferry facts,
  maps, listings, itineraries, hunts, accounts); files the LTAC application
  each October; is not a programmer.

## 2. Scope

**In scope (implemented and deployed):** public tourism site (ferry incl.
busyness planner, food, events, itineraries, lodging, parking, a general
multi-view map, webcams); side-of-water framing (Kingston vs Edmonds);
SR-104 vehicle boarding-pass guidance and driver staging routing; ferry
departure reminders (.ics); role-based portals (business / nonprofit / admin)
editing content at runtime; a content CMS (editable copy blocks + per-page
show/hide); a general map CMS with named views, drawable features, and a
parking-zone editor; structured admin-editable ferry facts; self-service
account management (name/email/password) and admin password reset; outbound
feeds + syndication tooling; first-party anonymous analytics incl. opt-in
device location; LTAC survey; a production persistence seam (file, or
Neon/Blob/Upstash) with health probe and backup/restore.

**Out of scope (v1, explicitly):** payment processing; user accounts for
*visitors*; native mobile apps; scraping any ToS-protected platform (Airbnb
especially); automated writes to external platforms (specified for v2 in
[SYNDICATION.md](SYNDICATION.md)); email sending (invite codes and reset
passwords are handed over manually until an email adapter is wired).

## 3. Functional requirements

Requirement IDs are stable; do not renumber. **[GAP]** marks known shortfalls
of the current implementation. Every requirement about *data* carries an
implicit sub-requirement: the UI must label non-live/estimated data as such and
link the authoritative source.

### FR-1 Ferry (the anchor feature)

- FR-1.1 Show today's Edmonds–Kingston sailings, both directions, with
  next-departure countdowns, refreshed at least every 60 s while viewed.
- FR-1.2 Use live WSDOT/WSF data (schedule, drive-up space, staff wait notes,
  service alerts, delays) when `WSDOT_API_KEY` is configured; otherwise fall
  back to a bundled approximate schedule **clearly labeled "not live."** The
  app must never hard-fail because an upstream API is down.
- FR-1.3 Show the Kitsap Transit fast ferry (Kingston–Seattle) schedule with
  its non-obvious rules surfaced: direction-based fares ($2 out / $13 back),
  no Sunday service, summer-only Saturdays, Seattle side is Pier 50 not Colman
  Dock, walk-on only. Carry the seasonal expiry (GTFS ends 2026-09-12).
- FR-1.4 Practical guidance: walk-on vs drive decision help; fares and payment;
  July-4th/peak surge warning; Hood Canal Bridge drawspan advisory. Cash and
  payment facts are **structured, admin-editable ferry facts** (see FR-7.4),
  not hard-coded prose.
- FR-1.5 Car-free arrival guidance from the Seattle side (Sounder/Amtrak to
  Edmonds; fast ferry from Pier 50).
- FR-1.6 **Busyness forecast / trip planner (`/ferry/plan`).** Provide a
  per-sailing busyness *estimate* (Light → Extreme) for any date up to a year
  out, so a visitor can plan a drive days or weeks ahead. The model
  (`src/lib/ferry-forecast.ts`) is **pure and client-safe** — it recomputes in
  the browser as the visitor drags time or flips direction — and is calibrated
  against WSF's own "Best Times to Travel" per-sailing grid for Summer 2026. It
  **blends empirical observations** logged over time (`ferry_observation`,
  weighted by sample count) into the heuristic, staying heuristic when data is
  thin and growing data-driven as it accrues. For *today's* chosen sailing the
  planner corroborates the estimate with live drive-up space. Every surface
  that renders the forecast must label it an estimate and defer to the live
  board / WSDOT for the real thing.
- FR-1.7 **Prediction is admin-gated and ships dark.** The forecast (planner,
  the "how busy today" panel on `/ferry`, and the home planning callout) is
  hidden from the public until an admin enables it on `/admin/ferry-info`;
  default is **OFF**. While off, signed-in admins get a preview so they can
  validate it; `visible = enabled || adminPreview`. The estimate must be
  back-testable: an admin-run accuracy backtest
  (`POST /api/admin/ferry-accuracy`, panel on `/admin/ferry-info`) compares the
  forecast against logged observations on demand.
- FR-1.8 **Observation logging.** Sailing fullness + delay snapshots are logged
  to feed FR-1.6 (`/api/ferry/observe`, and throttled captures on organic
  status traffic). The endpoint is open by default (writes are throttled and
  store only public ferry data) and can be locked with an optional
  `FERRY_OBSERVE_TOKEN` when pointed at by an off-site scheduler.
- FR-1.9 **Departure reminder.** For any sailing the visitor can get a calendar
  reminder: `GET /api/ferry/reminder?dir=&departs=` returns a single-event
  `.ics` with a 20-minute VALARM before departure, which drops into
  Apple/Google Calendar on a phone.

### FR-1S Side-of-water framing

- FR-1S.1 The app reframes for **which side of the water** the visitor is on:
  *Kingston side* (default; the visitor is here and cares about leaving/what to
  do) vs *Edmonds side* (the visitor is across Puget Sound and cares about
  getting to Kingston). The geographic divide is longitude −122.44
  (`SIDE_DIVIDE_LNG`); a `vk-side` cookie persists the choice.
- FR-1S.2 Ask location **once**, opt-out. On a first visit the app may prompt
  for geolocation to auto-detect the side; a hand-picked side or a prior ask
  (`vk-side-asked` cookie) suppresses the prompt forever — never nag. A visible
  side-switcher lets the visitor override the detection at any time.
- FR-1S.3 The classifier is client-safe and pure (`src/lib/side.ts`); the
  server-only cookie read lives in `src/lib/side-server.ts` so the framing
  works in both server and client components without a flash of the wrong side.

### FR-1B SR-104 vehicle boarding pass (drivers)

- FR-1B.1 Tell drivers whether a **WSDOT vehicle boarding pass** is required on
  SR-104 today. The default verdict is a season/hours **estimate**
  (`getBoardingPassStatus`); it is surfaced on the home ferry widget, `/ferry`,
  and the "get in the ferry line" nav so they always agree.
- FR-1B.2 **Admin daily override.** Chamber staff can pin the verdict ON or OFF
  for the rest of the day at `/admin/ferry-info` (backed by
  `/api/admin/boarding-pass`) when they know better than the heuristic. The
  override is stamped with the Pacific day it was set and **lapses silently at
  the next Pacific midnight** back to the estimate — no timer, no DST edge — or
  an admin can clear it early ("use automatic").
- FR-1B.3 **Driver staging routing.** When a pass is required, "get in the
  ferry line" must route drivers to the SR-104 staging point *from the back of
  the line*, not to the dock. The route is forced through a turnaround waypoint
  sized to wait length (`src/lib/ferry-line.ts`): via NE Barber Cutoff Rd for a
  normal (≤2 hr) line; via NE Miller Bay Rd (George's Corner) once a staff wait
  note indicates the line has backed up **past** Barber Cutoff (>2 hr). This
  prevents a mid-highway U-turn straight into the line.
- FR-1B.4 Surface live WSDOT-style vessel positions and SR-104 traffic, plus a
  ferry-webcam box, so a driver in line can read conditions for themselves.

### FR-2 Weather & tides

- FR-2.1 Current NWS forecast for Kingston on the home page (keyless API,
  graceful absence).
- FR-2.2 Today's NOAA tide predictions for Appletree Cove (station 9445639)
  with beach-walk framing.

### FR-3 Eat & Drink

- FR-3.1 Curated listing of every food business in town with description,
  cuisine, price level, walk time from the ferry, menu/ordering/map links.
  Content accuracy standard: every operational fact verified against ≥2 live
  sources, dated (`hoursVerified`), disputes kept visible ("call ahead") rather
  than silently resolved.
- FR-3.2 Structured weekly hours per business driving a **live open/closed
  badge** ("Open · closes 8 pm" / "Closed · opens tomorrow 11 am") computed in
  the visitor's browser in Pacific time (never stale static HTML), handling
  split shifts, past-midnight closes, and closed days.
- FR-3.3 An ordering-adjacent warning when the kitchen is closed, without
  blocking access to menus.
- FR-3.4 "What's open near me": opt-in device location sorts businesses by
  distance with walk estimates and open state; the permission ask is honest and
  paired with the value (see NFR-5).
- FR-3.5 Every listing emits schema.org LocalBusiness structured data (hours
  signal to search engines).

### FR-4 Events

- FR-4.1 Chronological, month-grouped calendar of real, verified events with
  date/time/venue/organizer/category/map/link; "this weekend" grouping.
- FR-4.2 Events are runtime-editable through the portals (FR-11/12) and flow to
  the home page, deconfliction views, and outbound feeds without redeployment.
- FR-4.3 [GAP → v2] Automated ingest from the Chamber's calendar (GrowthZone
  iCal and/or explorekingstonwa.com's Events Calendar REST API) instead of
  manual entry; recurring-event model instead of duplicated occurrences.

### FR-5 Itineraries

- FR-5.1 Curated, timed itineraries (walk-on/car/either) with real places only,
  map links per stop, and a return-ferry prompt. Four ship as seed (walk-on
  half day, family beach day, rainy day, Olympic gateway).
- FR-5.2 **Admin itinerary editor** (`/admin/itineraries`): the Chamber can
  create/edit/reorder itineraries and their timed stops at runtime; edits
  overlay the seed and go live without a deploy.

### FR-6 Stay

- FR-6.1 Real local lodging options (inns, rentals-community, camping, marina
  guest moorage) plus **compliant** deep links to Airbnb/Vrbo search (no
  scraping — Airbnb has no public API and its ToS forbids collection).
- FR-6.2 Lodging is admin-editable through the listings editor (FR-13.5).

### FR-7 Parking, payment & the ferry line

The former "ATMs" scope is **removed.** There is no ATM map, no ATM dataset,
and no cash-machine feature. Cash guidance is now a structured, admin-editable
ferry fact (FR-7.4). Parking is one view of the general map CMS (FR-17).

- FR-7.1 A parking view of the town map showing every known parking zone as a
  **labeled polygon** (not marker bubbles): Port of Kingston sections, the free
  2-hr row, park & rides, load zones, permit/commuter areas, and no-parking
  streets, each colored by rule (free 2-hr / free unrestricted / paid /
  park-and-ride / permit / load zone / no parking).
- FR-7.2 The Port of Kingston's lot rendered at section resolution (free 2-hr
  row, POKPARK/POKHILL/POKTT text-to-pay zones with short code 25023, load
  zones) with per-section rates, text-to-pay codes, and rules, plus Diamond
  D515 (73 stalls, $8/$12 + multi-day, permit tier).
- FR-7.3 The ferry holding corridor (SR-104) must read as "the line for the
  boat," visually distinct from — and quieter than — genuine no-parking streets.
- FR-7.4 **Structured ferry facts (`/admin/ferry-info`).** Payment, vehicle
  boarding-pass copy, **cash tips**, and sources are four editable structured
  records (`ferry-info` store, seed in `src/lib/data/ferry-info.ts`), rendered
  identically on `/ferry` and `/parking`. The cash tips carry the honest fact
  that **there is no ATM at the dock — get cash up in downtown Kingston first**,
  that a pre-loaded ORCA card skips the 3% card surcharge, that walking on from
  Kingston is free (fares are collected at Edmonds), and that Good To Go! passes
  do not pay ferry fares.
- FR-7.5 Zone shapes offer Street View via a free deep link so users can see
  the curb.
- FR-7.6 An honest overnight-parking answer per zone (`overnight: yes / no /
  confirm-first`), including "call the Port office first: 360-297-3545" where
  that is the truth.
- FR-7.7 Data honesty: street rules trace to the 2015 county study and say so
  ("the sign on the pole always wins"); Port polygons carry a georeferencing
  caveat (±10–15 m — painted stall markings win); unverified items are labeled;
  every zone carries a `confidence` of verified / probable / unverified.
- FR-7.8 Admins can correct any zone's shape, position, rules, overnight
  answer, and confidence in the **parking-zone editor** (`/admin/map`, Geoman
  polygon drawing) with changes overlaying the seed and going live without a
  deploy (`parking-zones` store).

### FR-8 Webcams

- FR-8.1 All verified WSDOT cameras relevant to the ferry run (both sides),
  auto-refreshing stills with freshness indicator, offline placeholders, source
  credit, and "how locals read these" guidance. Webcams are admin-editable in
  the listings editor (FR-13.5).

### FR-9 Give Back (nonprofits)

- FR-9.1 Directory of real local nonprofits; volunteer shifts with slot counts
  and honest signup paths (contact the org).
- FR-9.2 **Deconfliction calendar**: all upcoming events in one date-grouped
  view with busy-date flags, so organizations don't book against each other.

### FR-10 Scavenger hunts

- FR-10.1 Self-guided hunts: sequential stops with clue → optional GPS check-in
  ("assist, not gate") → photo submission; progress survives reloads
  (localStorage); offline never bricks a hunt.
- FR-10.2 Photo check-off: the player's photo uploads with GPS coordinates; the
  server verifies distance against the stop radius → "verified" badge, else
  honor-system. Player copy is honest that photos go to organizers.
- FR-10.3 Admin hunt builder (`/admin/hunts`): create/edit hunts and stops,
  attach a **reference photo** per stop ("what you're looking for," shown to
  players), review submissions beside the reference with verified badges.

### FR-11 Business portal

- FR-11.1 Invite-linked accounts may edit only their own listings (admin: all).
  Editable: description, contact, links, ordering platform, cuisine, price,
  tags, and **structured weekly hours** through a purpose-built editor (per-day
  spans, split shifts, past-midnight, copy-to-weekdays) that regenerates the
  human-readable hours line and stamps the verification date.
- FR-11.2 Businesses manage their own events (create/edit/delete), with a
  non-blocking same-day-conflict warning at date selection.
- FR-11.3 Portal edits appear on the public site within 60 seconds.

### FR-12 Nonprofit portal

- FR-12.1 Org accounts edit their profile and volunteer shifts (including a
  quick slots-filled counter for phone/email signups).
- FR-12.2 Event creation shows the deconfliction warning *before* the date is
  committed.

### FR-13 Admin (Chamber)

- FR-13.1 First-run bootstrap creates the admin account; the setup page then
  disappears forever. Admins mint invite codes bound to role + specific
  listings/orgs, with copy-paste onboarding text.
- FR-13.2 Admin sees/edits everything: all portals, accounts and invites, hunts,
  itineraries, listings, the content CMS, the map CMS and parking editor,
  structured ferry facts, the ferry-prediction switch, and visitor insights.
- FR-13.3 All `/admin` routes are role-gated at the request boundary by
  `src/proxy.ts` (the Next 16 convention — not `middleware.ts`) and again by
  `src/app/(site)/admin/layout.tsx`. There is **no pre-setup grace** — it was removed
  in E06. `/admin` is never world-readable, not even when zero accounts exist;
  it always redirects non-admins to `/portal`, and bootstrap goes through the
  first-run setup route (FR-13.1) instead. Every admin API route re-checks the
  session independently, because API routes bypass the layout.
- FR-13.4 **Content CMS (`/admin/content`).** (a) Edit any of the site's
  headline **copy blocks** — currently 92 registered blocks
  (`src/lib/site-copy-registry.ts`) — where each block's fallback is the exact
  string hard-coded in the page, so an untouched block always tracks the code;
  overrides live in the `site-copy` store and reach both server *and* client
  components via `copy-context` (`CopyProvider`/`useCopy`/`EditableText`). Some
  blocks support **bold** and links via `RichText`. (b) **Per-page show/hide**
  (`site-pages` store, enforced by `src/lib/page-visibility.tsx`): a hidden page
  drops from nav/footer/home grid and 404s for visitors, while admins still see
  it (with a banner) to prep content before launch.
- FR-13.5 **Listings editor (`/admin/listings`).** Edit restaurants (including
  **add a new restaurant** and **hide/soft-delete** one via a tombstone —
  `deleteRestaurant`), lodging, and webcams from one admin screen; edits overlay
  the seed.
- FR-13.6 **Structured ferry facts editor (`/admin/ferry-info`)** — see FR-7.4,
  plus the boarding-pass override (FR-1B.2), the ferry-prediction on/off switch
  (FR-1.7), and the forecast-accuracy panel (FR-1.7 backtest).

### FR-14 Syndication ("update once, everywhere")

- FR-14.1 Per business/org: public JSON feed (incl. live `openNow`), iCal feed
  usable as a calendar subscription (`/api/feeds/events?format=ics`), and a
  dependency-free embeddable events widget for their own website (CORS-open).
- FR-14.2 A per-account syndication page (`/portal/syndicate`): their feed URLs
  and snippets; copy-paste hours block plus deep links to Google/Apple/Yelp/Bing
  edit surfaces; per-event social compose blocks. **No promise of auto-sync may
  appear anywhere until an adapter actually ships.** The verified per-platform
  feasibility (Google: wireable; Meta: pilot path; Apple: application; Yelp:
  impossible; TikTok: deferred) is in [SYNDICATION.md](SYNDICATION.md) and is a
  v2 requirement set.

### FR-15 Visitor measurement (LTAC)

- FR-15.1 Automatic, anonymous, first-party (`/api/track`): pageviews,
  outbound-link taps (which businesses we send people to), coarse origin from
  the connection (country/region/city in production), per-session random id,
  **no cookies for tracking, no third parties, no IP storage**.
- FR-15.2 Opt-in device location: only when the visitor taps a location feature;
  browser permission prompt; coordinates are bounds-checked and rounded
  transiently, then **only the named town-area bucket is stored — never a
  coordinate** (E11); disclosed at the point of use, on the About page, and in
  the versioned privacy notice.
- FR-15.3 Anonymous visitor survey (distance band, overnight stay, nights, party
  size) — the only zip-level origin source, because devices do not expose zip
  codes (see NFR-5 honesty requirement). Survey reads are admin-only
  (`GET /api/survey`).
- FR-15.4 An admin insights dashboard (`/admin`) aggregating all of the above
  into LTAC/JLARC-citable numbers: sessions, origins, top pages, outbound taps,
  around-town area counts, survey summary.
- FR-15.5 [GAP → v2] Time-series charts, CSV/PDF export aligned to JLARC
  reporting categories, bot filtering, k-anonymity floor.

### FR-16 About & trust

- FR-16.1 A plain-English page: who built it, why visits count (LTAC), exactly
  what is and isn't tracked, data-source credits, and how businesses get listed.
  The privacy copy must be updated in the same change as any tracking behavior
  change — drift between behavior and disclosure is a release blocker.

### FR-17 General map CMS (multi-view)

- FR-17.1 A **general-purpose map CMS** drives a public multi-view map at
  `/map`. A **MapView** is a named, reusable configuration (center/zoom/layers,
  e.g. "food-drink", "parking", "trails"); a **MapFeature** is a drawn marker,
  line, trail, or area that declares which views it appears on. Model lives in
  `src/lib/map/types.ts`; seed in `src/lib/data`; edits overlay in the
  `map-store`.
- FR-17.2 Views can pull in **built-in data layers** without re-entering data:
  `restaurants`, `parking-zones`, and the street-parking overlay
  (`BuiltInSource`), so the Chamber never duplicates data already in the app.
- FR-17.3 **Admin map builder (`/admin/maps`).** Create/edit named views;
  draw/drag markers (16-category icon palette), lines, trails, and areas with
  Geoman; set color, notes, links, and per-feature images (uploaded via
  `/api/admin/map-features/image`, served by `/api/map/image`). A view can be a
  **draft** (`published: false`) — visible to admins, hidden from the public
  `/map` switcher.
- FR-17.4 Feature areas can be tagged as **parking** (`ParkingMeta`: type,
  owner, phone, payment method/link/notes, time limit) with automatic
  rule-based color; this and the dedicated parking-zone editor (FR-7.8) are the
  two ways parking geometry is maintained. See [MAPS.md](MAPS.md).
- FR-17.5 Public map data is served per view by `GET /api/map/[viewId]`
  (resolved config + custom features + built-in payloads via
  `src/lib/map/resolve.ts`).

### FR-18 Accounts & auth self-service

- FR-18.1 **Self-service profile** (`/portal/account`,
  `PUT /api/auth/account`): a signed-in user updates their own name and email;
  emails stay unique; blank fields fall back to current values.
- FR-18.2 **Self-service password change** (`POST /api/auth/password`): prove
  the current password (scrypt) and set a new one; both client IP and user id
  are rate-limited.
- FR-18.3 **Admin password reset**: an admin resets any user's password
  (`POST /api/portal/users` action `reset-password`), which generates a random
  temporary password and returns it **once** — passwords are one-way hashes and
  can never be viewed, so this is handed to the user out-of-band.

## 4. Non-functional requirements

### NFR-1 Mobile-first (CRITICAL)

The primary session is a phone, outdoors, possibly on ferry-terminal congested
cell service. Implemented today: mobile bottom navigation (5 slots + More
sheet), responsive layouts on every page, tap-oriented maps (scroll-wheel
hijack disabled, tap targets on small polygons), phone-first features (camera
capture, GPS, one-tap "add to calendar" reminder), and the side-of-water
auto-detect so the first screen is already framed for where the visitor is.
**Shipped since v1:** a verified mobile/design review pass fixing touch targets
and layout regressions, and single-ask location detection (opt-out). **Formal
v2 bar (see [ROADMAP-V2.md](ROADMAP-V2.md)):** PWA installability with offline
ferry schedule + tides cache; ≥44 px touch targets audited everywhere; primary
CTAs in thumb reach; safe-area insets; `inputmode` on all form fields;
Lighthouse mobile LCP < 2.5 s on 4G (current risk: hero photography);
real-device test matrix (iOS Safari, Android Chrome) as a release gate.

### NFR-2 Cost

Low single-digit $/month. Phase 1 runs on a Render Starter web service + 1 GB
disk (~$7.25/mo); everything else stays free-tier/keyless (WSDOT/NWS/NOAA keys
are free; deep links instead of billable map/search APIs; self-hosted auth).
Any change that introduces new spend requires explicit owner sign-off. Known
future spend candidates: managed Postgres tier (Phase 2), error monitoring —
both have free tiers.

### NFR-3 Reliability through graceful degradation

Every external dependency must have a defined degraded mode that keeps the page
useful and honestly labeled (fallback ferry schedule, "camera offline", missing
forecast, failed overlay fetch, offline hunt completion, forecast falls back to
pure heuristic when observations are sparse). Upstream outages must never
produce a blank or broken page.

### NFR-4 Data honesty (a product requirement, not a style choice)

Verified facts carry verification dates; disputed facts show the dispute;
derived/approximate geometry says so; the busyness forecast and boarding-pass
verdict are labeled **estimates** and defer to the live board; "the sign on the
pole always wins" on anything traceable to the 2015 study; nothing unverified
is presented as fact. Wrong parking/hours data does real-world harm (towed
cars, locked doors, missed boats) — when in doubt, under-claim.

### NFR-5 Privacy

No PII beyond account holders, no accounts for visitors, no ad tech, no data
sales, no cookies for tracking, no IP retention, location only by explicit
permission and only coarsened, photos only where copy says so. (The
side-of-water and side-asked cookies are functional preference cookies, not
tracking, and store only "kingston"/"edmonds".) Public dashboards/exports carry
aggregates only. Honesty constraint: never imply the device can reveal a home
zip — it can't; the survey is the zip source.

### NFR-6 Security

Server-side authorization on every write (session + per-record `canEdit`);
scrypt password hashing; HMAC-signed expiring session cookies (`AUTH_SECRET`);
httpOnly/sameSite cookies; path-traversal-safe file serving; upload type/size
limits; secrets only in host env / `.env.local`. **Rate limiting is DONE**
(`src/lib/rate-limit.ts`): login, first-run setup, invite redeem, profile edit,
and password change are all capped per client IP and (where relevant) per
target key, with a `429` + `Retry-After`. The limiter itself rides the
persistence seam — shared Upstash Redis sliding window when
`UPSTASH_REDIS_REST_URL` is set (correct across serverless replicas), else an
in-process Map (correct for a single persistent-disk instance).

### NFR-7 Maintainability by non-developers

The Chamber must be able to run this without engineering: all content editable
through the portals and the content/map/ferry-info admin editors; remaining seed
files are typed, commented, and single-purpose; every data source documented
with refresh instructions; seasonal maintenance is a dated checklist
([OPERATIONS.md](OPERATIONS.md)); admin UIs favor plain language.

### NFR-8 Brand fidelity

The app is visually part of explorekingstonwa.com: its palette
(#1E96C0 / #324A6D family), fonts (Satisfy display accents, Roboto, Poppins),
logo and photography — implemented exclusively through the design tokens so a
future rebrand is again a token swap.

### NFR-9 Accessibility

Semantic headings/landmarks, alt text, visible focus, AA contrast on text
(verified during rebrand; decorative cyan eyebrow exempted deliberately), color
never the sole carrier of map meaning (popups/list mirror the rules). [GAP → v2]
full audit + keyboard-first map alternative formalized.

### NFR-10 Deployability & persistence portability (the seam)

The system must run unchanged on a persistent-disk host **or** a serverless host
with no code change above the store layer. Since E05 structured data lives in
Neon Postgres on every host; only the image and rate-limit seams
(`src/lib/data-dir.ts`, `blob-store.ts`, `rate-limit.ts`) still branch on env
presence, and nothing above the stores knows which backend is active.

- **Postgres (required, E05):** the `record` table backs every seed+overlay
  collection; auth lives in its own dedicated `users` / `orgs` / `invites`
  tables (E06), not in `record`; append tables for
  analytics/survey/observations. Schema from `src/lib/db/schema.ts` →
  checked-in `db/migrations/`, applied at boot; every write goes through the
  audited zod choke point (`src/lib/db/records.ts`). Seeds in git remain the
  merge baseline.
- **Disk (`DATA_DIR`, default `.data/`):** images/hunt photos only (until
  E15); Vercel Blob takes them when `BLOB_READ_WRITE_TOKEN` is set; Upstash
  Redis for serverless rate limiting.
- A **health probe** (`/api/health`) reports `{ ok, db, storage, time }` and
  returns 503 until Postgres answers; since E15 it does not touch the disk.
  **This now fails closed** — with the disk removed the previous release keeps
  serving. (Before E15 it did not: only one instance could hold the mount, so
  Render stopped
  the old instance before starting the new one: every deploy is a ~15 s full
  outage, and a release that never goes healthy leaves the service returning
  502 with no previous release still serving. Merging to `main` auto-deploys,
  so `DATABASE_URL` and the disk mount must be verified *before* the merge, not
  after. Full explanation in [RUNBOOK-CUTOVER.md](RUNBOOK-CUTOVER.md) under
  "Migrations under auto-deploy" and "Deploys are zero-downtime".
- **Backup/restore** must exist: an admin-gated JSON bundle of the whole data
  directory (`/api/admin/backup`, "⤓ Download backup" on `/admin`,
  restore via `scripts/restore-backup.mjs`), plus host-level snapshots.

Full topology, env matrix, and the migration are in [DEPLOY.md](DEPLOY.md) and
[ARCHITECTURE.md](ARCHITECTURE.md).

## 5. Data requirements

All external sources, endpoints, verification status, and gotchas:
[DATA_SOURCES.md](DATA_SOURCES.md). Binding rules: adapters isolate every source
(`wsf`, `kitsap`, `weather`, `tides`); time math is Pacific-anchored (server TZ
must not matter — `time.ts`/`hours.ts`); seasonal data carries expiry awareness
(fast-ferry GTFS ends 2026-09-12; WSF fares change ~October; hours re-verified
quarterly; Port rates/permits re-verified quarterly). The busyness forecast is
its own data pipeline: a client-safe model plus an append-only observation log
it learns from.

### Environment variables (authoritative)

| Var | Required | Purpose |
|---|---|---|
| `AUTH_SECRET` | **yes** | Signs HMAC session cookies |
| `WSDOT_API_KEY` | no | Live ferry data; absent → labeled fallback schedule |
| `NEXT_PUBLIC_SITE_URL` | **yes** in production | Absolute base URL for feeds/canonical links; **build-time** (inlined into the client bundle at build) |
| `SETUP_TOKEN` | no | Gates first-run admin bootstrap fail-closed; unused once an admin exists |
| `DATA_DIR` | disk hosts | Persistent volume path (e.g. `/data`) — images/hunt photos since E05 |
| `FERRY_OBSERVE_TOKEN` | no | Locks `/api/ferry/observe` when an off-site scheduler calls it |
| `DATABASE_URL` | **yes** (E05) | Neon Postgres (pooled URL) — the structured-data home; health 503s without it |
| `BLOB_READ_WRITE_TOKEN` | Phase 2 | Vercel Blob for uploaded images |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Phase 2 | Shared rate-limit backend |

## 6. Constraints & assumptions

- Web platform only: no background location; camera/GPS by permission only;
  local storage is per-browser (documented in player copy).
- Structured data is Postgres everywhere (E05); the single-node disk (`.data/`
  or a mounted `DATA_DIR`) now carries only images, so serverless needs just
  the Blob/Upstash backends of NFR-10 — a config choice, not a blocker.
- Kingston is unincorporated Kitsap County — county code + posted signs govern
  parking; the Port governs its own property.
- The owner's git/hosting identity separation (personal vs work) per
  [GIT_SETUP.md](GIT_SETUP.md).

## 7. Acceptance criteria (all currently met unless [GAP])

1. A phone user answers "next boat home + what's open now" in ≤ 2 taps from the
   home page, in under 30 seconds, correctly framed for their side of the water.
2. With no API keys and no network to WSDOT, every page still renders with
   labeled fallback data.
3. A business owner can change hours in the portal and see the public badge and
   hours line update within 60 s — with zero developer involvement.
4. A nonprofit sees same-day conflicts *before* committing an event date.
5. The Chamber can produce LTAC-citable aggregate numbers (origins, visits,
   around-town movement, overnight stats) from `/admin` without engineering.
6. A driver told a boarding pass is required is routed to the *back* of the
   SR-104 line (via Barber Cutoff, or Miller Bay when the line tops 2 hr) with
   no mid-highway U-turn.
7. With the prediction switch OFF, no visitor sees the busyness forecast; a
   signed-in admin still previews it; flipping it ON exposes it site-wide.
8. An admin edits any of the 92 copy blocks, hides/shows a page, edits ferry
   facts, or redraws a parking/map feature, and the change is live for visitors
   without a deploy.
9. `npm run build` completes clean; every route responds 200 (or an intentional
   redirect) on a fresh checkout with only documented setup.
10. All admin/portal writes are rejected without a valid session of the right
    role; auth write endpoints reject brute-force with `429 + Retry-After`.
11. `/api/health` returns 200 with `dataWritable: true` on a correctly mounted
    host and 503 otherwise; an admin can download a full backup bundle from
    `/admin`.

## 8. Open questions

1. When does the Chamber flip the ferry-prediction switch ON for the public —
   what accuracy threshold from the backtest panel is the bar?
2. Which additional inaccuracies has the owner spotted on the parking/town map?
   (The `/admin/map` and `/admin/maps` editors are the fix-anything tools.)
3. Should visitor-facing content ship a Spanish translation in v2?
4. Does the Chamber want volunteer *signup* handled in-app (accounts for
   volunteers) or is the contact-the-org path permanent?
5. PWA scope for v2: offline schedules only, or full page caching?
6. Phase 2 trigger: structured data already moved to Neon (E05, live in
   production). What event moves the remaining seams — image storage and rate
   limiting — off Render's disk to the Blob/Upstash backends (traffic, cost, or
   the custom-domain launch)?
