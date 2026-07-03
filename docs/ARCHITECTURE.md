# Explore Kingston — Architecture

**Version 2.0 · July 2026.** Structure, boundaries, and the reasoning behind
them. Code-level design is in [SDD.md](SDD.md); requirements in
[REQUIREMENTS.md](REQUIREMENTS.md).

## 1. System context

```
                       ┌────────────────────────────────────────────┐
  Visitors (phones) ──▶│                                            │
  Business owners  ──▶ │      Explore Kingston (Next.js 16)         │──▶ WSDOT Ferries API (live boats)
  Nonprofits       ──▶ │                                            │──▶ NWS api.weather.gov (keyless)
  Chamber admin    ──▶ │  pages · portals · API routes · feeds      │──▶ NOAA CO-OPS tides (keyless)
                       │                                            │──▶ OSM tiles + Overpass (map)
  Their websites   ◀── │  (JSON/iCal feeds, embed widget, JSON-LD)  │──▶ Census TIGERweb (UGA boundary)
  Calendar apps    ◀── │                                            │
  Search engines   ◀── └──────────────────┬─────────────────────────┘
                                          │
                                    .data/ (file persistence)
                                    auth · store overlays · hunts
                                    analytics · survey

  Future outbound (SYNDICATION.md): Google Business Profile API, Meta pages,
  Apple Business — adapters behind the same seam as everything else.
```

One deployable unit. No database server, no queue, no auth service, no CDN
dependency beyond the host. Everything the system *owns* lives in the repo
plus one mutable directory (`.data/`).

## 2. Principles (the load-bearing ones)

1. **Adapters isolate every external source.** UI never fetches an external
   service; it calls `src/lib/*` functions returning domain types. Swapping
   a source touches one file. Every adapter returns a degraded-but-honest
   result on failure (`{live:false}`, `[]`, fallback schedule) — upstream
   outages must never blank a page.
2. **Seed + overlay.** Checked-in typed seed files define baseline content;
   runtime edits write JSON overlays in `.data/stores/` that win by id
   (with `_deleted` tombstones). Result: git-reviewable defaults, portal
   editability without deploys, trivially resettable state, and a clean
   seam for the eventual database (re-implement the store module, nothing
   above it changes).
3. **Tokens are the only theming channel.** Twelve semantic color tokens +
   four font variables (globals.css `@theme`); pages/components never use
   raw hex (maps excepted — canvas colors aren't part of the page theme).
   The Explore Kingston rebrand was executed purely by remapping token
   values; the next rebrand should be too.
4. **Pacific-anchored time.** All wall-clock logic (hours badges, schedule
   fallbacks, date grouping) goes through `src/lib/time.ts` / `hours.ts`
   Intl-based helpers so the server's timezone never matters. Anything
   time-of-day-sensitive that must be *fresh* is computed client-side
   (open-now badges) rather than baked into cached HTML.
5. **Honesty is architectural.** Confidence/verification metadata travels
   *with* data (types carry `confidence`, `hoursVerified`, `live`,
   `sourceNote`) so UIs can't accidentally present stale or derived data as
   fact.
6. **No third party until forced.** Auth, analytics, feeds, ICS, embeds are
   self-implemented. External SaaS enters only with a verified free tier
   and a documented reason (see decision log).

## 3. Layers and their contracts

```
routes (src/app/**)             pages: RSC by default; ISR-60 for store-backed
                                content; force-dynamic for portals/admin
   │        │
   │        └── API routes (src/app/api/**): auth, portal writes, feeds,
   │            hunts, survey, track, ferry status — thin, validating,
   │            store/adapter-calling handlers
   ▼
client islands (src/components/**)   only where interactivity demands it:
                                     tracker, open-badge, near-me, town-map,
                                     hunt-player, ferry-board, webcam-grid,
                                     visitor-survey, nav, portal editors
   ▼
domain layer (src/lib/)
   types.ts        one domain model for everything
   stores/*        seed+overlay persistence (business, events, charities,
                   parking) · hunt-store · analytics-store · survey-store
   adapters        wsf, kitsap, weather, tides (+ time/hours engines)
   auth.ts         users, invites, sessions, canEdit
   ▼
persistence        seed: src/lib/data/*.ts (git)
                   mutable: .data/** (gitignored; THE backup unit)
                   generated: public/geo/street-parking.json (script)
```

**Rendering strategy per class of route:** static (marketing-ish pages with
no mutable data), ISR `revalidate=60` (anything reading stores: home, eat,
events, give, parking), `force-dynamic` (portals, admin, hunts — always
fresh, auth-dependent), route handlers uncached except feeds
(`s-maxage=60/300` + CORS `*`).

## 4. Data architecture

- **Domain model:** single source in `src/lib/types.ts` — Restaurant
  (with structured `WeeklyHours`), EventItem (`ownerId` links portal
  ownership), Charity/VolunteerNeed, Hunt/HuntStop, ParkingArea + MapZone
  (+`confidence`), Webcam, Itinerary, SurveyResponse. SDD §2 documents
  invariants.
- **Mutable state inventory (`.data/`):** `auth/` (users, invites),
  `stores/` (overlays: restaurants, events, charities, volunteer-needs,
  parking-zones), `hunts/` (custom hunts, reference photos, player
  submissions + JSONL log), `analytics/events.jsonl`,
  `ltac-responses.jsonl`. Copying `.data/` is a complete backup; deleting a
  file resets exactly that subsystem.
- **Generated artifacts:** `public/geo/street-parking.json` from
  `scripts/gen-street-parking.py` (OSM Overpass + Census CDP inputs;
  re-run on rule changes) — fetched at runtime by the map so street
  geometry never bloats the JS bundle.
- **Identity of records** is a human-readable slug id everywhere; overlays
  and cross-references (events↔owners, needs↔charities, accounts↔linkedIds)
  join on it.

## 5. Auth architecture

Invite-only, three roles (`business`, `nonprofit`, `admin`), no visitor
accounts. scrypt hashes; stateless HMAC-signed session cookies (30 d);
first-run bootstrap page that self-destructs once a user exists; admin
layout gates all of `/admin` (with pre-setup grace); every write handler
re-validates session + `canEdit(user, recordId)` — defense in depth, never
trusting the UI. Deliberate v1 limits (single-node file store, no rate
limiting, no reset flow) are deploy blockers listed in OPERATIONS.md.

## 6. Analytics architecture

First-party only, append-only JSONL, four event kinds: pageview, outbound
tap, geo-ping (opt-in, server-rounded to 3 decimals, area-bucketed),
survey response (separate store). Ingest via `sendBeacon` to `/api/track`;
geo derived server-side from platform headers (never stored raw). Reporting
is aggregate-only in `/admin`. The area classifier (named bounding boxes) is
data the Chamber can refine.

## 7. Decision log (ADR summary)

| # | Decision | Why | Rejected alternatives |
|---|----------|-----|----------------------|
| 1 | Next.js 16 App Router + TS, single app | One deployable, RSC fits read-heavy site, free hosting path | Separate SPA+API; WordPress plugin on the existing site |
| 2 | File-based seed+overlay stores, no DB in v1 | $0, zero ops, git-reviewable content, clean DB seam later | Supabase/Postgres now (adds ops before it adds value); CMS SaaS |
| 3 | Hand-rolled invite auth (scrypt + HMAC cookie) | No third-party dependency/cost; tiny trusted user set; full control | NextAuth (heavier, still needs a DB/adapter), Clerk/Auth0 ($, external) |
| 4 | Google Maps *deep links* everywhere; Leaflet+OSM only where we render maps | $0 at any scale; no key management; native app handoff on phones | Google Maps JS embeds (billable SKUs, ToS caching limits) |
| 5 | WSDOT native REST over GTFS/GTFS-RT | Instant free key, richer data (drive-up space, wait notes), no protobuf | OneBusAway GTFS-RT (key wait, less data) |
| 6 | Structured `WeeklyHours` + client-computed badges | Static/ISR pages can never show stale open/closed state; DST-safe via Intl | Server-computed badges (stale in cache); Google Places hours (billing + caching ToS) |
| 7 | Two-source verification with dated stamps + visible disputes for all operational facts | Wrong hours/parking data does real-world harm; trust is the product | Trust-the-first-source; scraping aggregators |
| 8 | Hunt photos upload with GPS verify (v2 of hunts) | Owner requirement: auto check-off "when a pic is posted at that spot" | On-device only (v1; no admin visibility); image-content ML matching (cost/complexity — roadmap) |
| 9 | Analytics: first-party JSONL + opt-in coarse GPS | LTAC needs aggregates, not surveillance; zero third-party leakage | GA4 (ad-tech baggage, consent complexity); paid analytics |
| 10 | Rebrand via token remap only | One-file restyle; provable contrast decisions; repeatable | Per-page restyling (drift, unreviewable) |
| 11 | Street geometry baked to static JSON by script | Runtime has zero Overpass dependency; regeneration is explicit and rare | Live Overpass queries (rate limits, latency, fragility) |
| 12 | Feeds: hand-rolled ICS + JSON + vanilla embed script | RFC-simple, no deps, works in Google/Apple Calendar; CORS-open by design | ical libraries (dep for 40 lines); iframe embeds (styling/clickjack issues) |
| 13 | geoman for admin polygon editing | Only mature free Leaflet editing plugin; admin-only bundle cost | Hand-rolled vertex editing (days of fiddly math); Google My Maps (data leaves the system) |
| 14 | Syndication = feeds + checklists now, APIs later in verified order (Google→Meta→Apple; never Yelp) | Every claim to businesses must be deliverable; API gates verified against primary docs | Promising auto-sync before access approvals exist |

## 8. Deployment topology

**Now:** single machine, `npm run dev`/`next start`, `.data/` on local disk,
secrets in `.env.local` (WSDOT_API_KEY, AUTH_SECRET, optional
NEXT_PUBLIC_GMAPS_EMBED_KEY).

**Target — two phases (DEPLOY.md is the step-by-step):**

- **Phase 1 (now): persistent-disk host** — Docker `output: "standalone"`
  image on Render/Fly/Railway/VPS with `DATA_DIR` pointed at a mounted
  volume, so the file stores work unchanged. Health probe at `/api/health`
  (checks the volume is writable). Auth endpoints are rate-limited
  (`src/lib/rate-limit.ts`, in-memory — correct for a single instance).
  Reached via one CNAME at NameHero. Still pending before real users: an
  automated `.data` backup schedule and Resend DNS for invite email.
- **Phase 2 (later): Vercel** — serverless has no persistent disk, so the
  store modules behind `src/lib/data-dir.ts` (auth, json-store overlays,
  hunts+photos, analytics, survey, maps) migrate to Postgres/Supabase +
  object storage, and `rate-limit.ts` moves to a shared KV. `data-dir.ts`
  and each store's exported functions are the exact swap seam — nothing
  above them changes.

**DNS both phases:** one CNAME at NameHero (**never** a nameserver move —
the VPS also serves the domain's DNS and mail). Full runbook: OPERATIONS.md;
deploy guide: DEPLOY.md.

## 9. Known debt & risks (honest list)

- No automated tests (SDD §12 defines the priority suite; ROADMAP-V2 P0).
- File persistence is single-writer; concurrent admin edits can last-write-
  win at the record level (acceptable for a one-admin Chamber; fixed by DB
  migration).
- Seasonal data rots on a schedule (GTFS 2026-09-12, WSF fares ~Oct, hours
  quarterly) — mitigated by OPERATIONS.md calendar, not by code.
- Port polygon geometry is schematic-georeferenced (±10 m) pending the
  admin's hand-correction pass in `/admin/map`.
- `/admin` insights include opt-in GPS samples — small-n; treat as sample,
  not census (labeled in UI).
- Legacy Google v4 localPosts dependency (when GBP adapter ships) is
  Google's risk to force-migrate; adapter must stay isolated.
