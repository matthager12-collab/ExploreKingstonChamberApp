# Operations Runbook

How to run, deploy, back up, and maintain **Explore Kingston** — the companion
app to explorekingstonwa.com. Written **July 2026**, for the **live Phase-1
deployment on Render** at <https://explore-kingston.onrender.com>.

Companion docs:
[DEPLOY.md](DEPLOY.md) (authoritative deploy guide — Phase-1 Render steps, the
Phase-2 Vercel path, DNS, pre-launch checklist),
[ARCHITECTURE.md](ARCHITECTURE.md) (code layout + the persistence seam),
[DATA_SOURCES.md](DATA_SOURCES.md) (every upstream source + gotchas),
[SDD.md](SDD.md) (design), [MAPS.md](MAPS.md) (map CMS + parking overlay),
[SYNDICATION.md](SYNDICATION.md) (outbound-channel plan).

> **Naming.** Product/UI name is **Explore Kingston**; the repo/dir is
> `visit-kingston` (public GitHub `matthager12-collab/ExploreKingstonChamberApp`); the Render
> service and Fly app are named `explore-kingston`.

---

## 0. Two facts that drive everything below

1. **`DATA_DIR` is the whole mutable world.** Every account, portal edit,
   ferry override, hunt photo, analytics and survey row is written under one
   directory resolved by `src/lib/data-dir.ts`. Code, seed content, brand
   assets, and the generated parking overlay are all reproducible from git +
   `npm install`. Back up `DATA_DIR`; nothing else matters.
2. **Each store auto-detects its backend from env presence** (the persistence
   seam — see [ARCHITECTURE.md](ARCHITECTURE.md)). On Render **no** DB/Blob/
   Upstash vars are set, so every store uses the **`/data` filesystem**. Set
   `DATABASE_URL` (+ Blob + Upstash) and the same code runs serverless on
   Vercel with `DATA_DIR` unset. The migration between them is a one-time data
   move (§7), not a rewrite.

---

## 1. Local development

**Prereqs:** **Node 22+** (the production image is `node:22-alpine`; Next 16
needs ≥ 20.9) and npm. No database, no Docker, no paid service required for
local dev — the app runs entirely on the filesystem fallback.

```bash
npm install
npm run dev        # http://localhost:3000
```

Scripts (`package.json`): `dev`, `build`, `start`, `lint`, `lint:boundaries`,
`typecheck`, `test`/`test:server`/`test:all` (E02), `ams:checks`, plus the E05
schema scripts `db:generate` (drizzle-kit generate) and `db:migrate`
(drizzle-kit migrate — needs `DATABASE_URL`).

### `.env.local`

Never commit this file (`.env*` is gitignored). Values already exist in the
working copy's `.env.local` — reference that, don't reprint secrets.

| Key | Required? | Where the value comes from |
|-----|-----------|----------------------------|
| `AUTH_SECRET` | **Yes** for the portals — `src/lib/auth.ts` `secret()` throws `AUTH_SECRET missing` without it | Any long random string, e.g. `openssl rand -hex 32`. Signs the stateless `vk-session` HMAC cookie. **Changing it logs everyone out** (see §8). |
| `WSDOT_API_KEY` | No — app falls back to the bundled schedule, labeled not-live | Free access code from <https://wsdot.wa.gov/traffic/api/> (enter an email, code issued instantly). Current code registered under matt.hager12@gmail.com; already in `.env.local`. Rotating = registering again. |
| `NEXT_PUBLIC_SITE_URL` | No locally (defaults to `http://localhost:3000`); **set in production** | Absolute production origin for share-card/canonical URLs (`src/app/layout.tsx` `metadataBase` — the app spreads by visitors texting links). **Build-time var** — inlined into the client bundle at `npm run build`; a dashboard-only change needs a rebuild. |
| `DATA_DIR` | No locally (defaults to `<repo>/.data`); **set in production** | Absolute path to the mutable-state root, resolved via `src/lib/data-dir.ts`. Leave unset locally. In production it **must** be an absolute path on a mounted persistent volume (`/data` on Render/Fly) or redeploys wipe accounts, portal edits, and photos. |
| `SETUP_TOKEN` | Only to bootstrap the first admin (locally or in production) — `POST /api/auth/setup` 403s fail-closed without it | Any string you choose, e.g. `openssl rand -hex 16`. Only consulted while zero users exist (`hasAnyUsers()` is checked first) — once an admin exists, it's never read again. Set it in `.env.local` before running `/portal/setup` on a fresh `.data/`; on Render it's `generateValue: true`. |

**Phase-2 (Vercel) vars** — `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`,
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — are **not** set locally or
on Render; they belong only to a Vercel deployment (§7, `.env.production.example`).

### First run — bootstrap the admin and mint invites

1. `npm run dev`, open <http://localhost:3000>.
2. **Bootstrap the first admin:** set `SETUP_TOKEN` in `.env.local` (any string;
   the endpoint 403s fail-closed without it), then visit `/portal/setup` and
   enter that same value in the "Setup token" field. It works **only while
   `DATA_DIR/auth/users.json` has zero users** — it creates the first admin
   account (role `admin`, empty `linkedIds`), signs you in, then locks itself
   forever (`/api/auth/setup` returns 403 once any user exists; the endpoint is
   also rate-limited to 5 attempts). Until the first admin exists, `/admin` is
   open with a loud amber banner so bootstrap can't lock itself out
   (`src/app/admin/layout.tsx`).
3. **Mint invites:** as admin go to `/admin/accounts`. Each invite code is tied
   to a role (`business` / `nonprofit` / `admin`) and the listing/org ids that
   account may edit (`linkedIds`). Hand the code to the business; they redeem it
   at `/portal/join`. (`/api/auth/login`, `/setup`, `/redeem` are rate-limited.)
4. Portal edits (hours, listings, events, volunteer needs) land in
   `DATA_DIR/stores/*.json` and appear on public pages within ~60 s (ISR).

---

## 2. State layout — everything under `DATA_DIR`

Local dev: `<repo>/.data/`. Render: `/data`. Same tree either way. Files and
subdirectories appear **lazily** — a missing file just means that subsystem
hasn't been used yet.

```
DATA_DIR/
  auth/users.json            portal accounts (scrypt hashes, roles, linkedIds)
  auth/invites.json          invite codes (created lazily on first mint)
  stores/restaurants.json    portal/admin edit OVERLAYS — a custom record wins
  stores/events.json           by id; { "_deleted": true } tombstones hide a
  stores/charities.json        seed row (src/lib/stores/json-store.ts)
  stores/volunteer-needs.json
  stores/lodging.json        admin listing editor (lodging)
  stores/webcams.json        admin listing editor (webcams)
  stores/itineraries.json    admin itinerary editor
  stores/parking-zones.json  admin parking-zone polygon editor (MapZone)
  stores/map-views.json      map CMS — named public map views
  stores/map-features.json   map CMS — drawn markers/lines/trails/areas
  stores/site-copy.json      content CMS — edited copy blocks (overrides)
  stores/site-pages.json     content CMS — per-page show/hide flags
  stores/ferry-info.json     structured ferry facts (payment/boarding-pass/
                               cash-tips/sources), overlay wins by id
  stores/ferry-prediction.json  admin on/off flag for the busyness forecast
  stores/boarding-pass-override.json  admin daily SR-104 pass override
  stores/ferry-observations.jsonl     logged sailing snapshots (forecast input)
  map/images/                admin-uploaded map-feature images
  hunts/custom-hunts.json    admin-built/edited hunts (override seed by id)
  hunts/refs/                per-stop reference photos (<huntId>-<stopId>.<ext>)
  hunts/photos/<huntId>/<stopId>/   player photo submissions
  hunts/submissions.jsonl    one JSON line per hunt submission (GPS verdicts)
  analytics/events.jsonl     pageviews / outbound clicks / opt-in geo pings
  ltac-responses.jsonl       anonymous LTAC visitor-survey responses
```

> Exact store filenames follow each module in `src/lib/stores/`; treat the tree
> above as the map, the code as the truth. `map/images/` and the overlay image
> fields are what the Phase-2 migration lifts into Vercel Blob (§7).

### Reset a subsystem (local dev)

Deleting a store file resets **only** that subsystem to its git seed. Stop the
dev server first so a write doesn't race the delete.

| To reset… | Delete… | Effect |
|---|---|---|
| All accounts + invites | `auth/users.json` and `auth/invites.json` | `/portal/setup` bootstrap becomes available again |
| One content domain | `stores/<name>.json` | That domain reverts to its seed in `src/lib/data/` |
| Content-CMS edits | `stores/site-copy.json` (+ `site-pages.json` for visibility) | Copy reverts to `src/lib/site-copy-registry.ts`; all pages visible again |
| Ferry facts | `stores/ferry-info.json` | Reverts to `src/lib/data/ferry-info.ts` (payment/boarding-pass/cash-tips/sources) |
| Ferry prediction flag | `stores/ferry-prediction.json` | Reverts to default **OFF** (public sees nothing; admins still preview) |
| Boarding-pass override | `stores/boarding-pass-override.json` | Reverts to the season/hours estimate |
| Admin-built hunts | `hunts/custom-hunts.json` (+ `hunts/refs/`) | Hunts revert to `src/lib/data/hunts.ts` seeds |
| Hunt submissions | `hunts/submissions.jsonl` and `hunts/photos/` | Empty submission review queue |
| Analytics | `analytics/events.jsonl` | Dashboard counts return to zero |
| LTAC survey | `ltac-responses.jsonl` | **Export first if an LTAC/JLARC period is open** — this is grant evidence |

---

## 3. The live Render deployment (Phase 1)

**Phase 1 is LIVE on Render** at <https://explore-kingston.onrender.com>. The
full step-by-step is in **[DEPLOY.md §b](DEPLOY.md)**; this is the operating
picture.

| Aspect | Reality |
|---|---|
| Blueprint | `render.yaml` — a Docker web service (`runtime: docker`, `dockerfilePath: ./Dockerfile`), region `oregon`, plan **starter** (persistent disks require a paid plan) |
| Image | Multi-stage `Dockerfile`: `node:22-alpine`, `npm ci`, `npm run build`, ships only the standalone runner (`.next/standalone` + copied `.next/static` + `public/`), runs as non-root `nextjs`, `CMD ["node","server.js"]` on port 3000 |
| Persistence | 1 GB disk named `data` mounted at **`/data`**; `DATA_DIR=/data` (set in `render.yaml`) → **filesystem mode**, because no DB/Blob/Upstash env vars are set on Render. The disk survives deploys and restarts |
| Health gate | `healthCheckPath: /api/health` — Render routes traffic only after 200. `/api/health` returns `{ ok, dataDir, dataWritable, time }`, **200 when `/data` is writable, 503 otherwise** (it write-probes `/data/.health-probe`). This catches an unmounted/read-only volume before users do |
| Secrets | `AUTH_SECRET` and `SETUP_TOKEN` = `generateValue: true` (Render mints them once; **do not rotate `AUTH_SECRET` casually**); `WSDOT_API_KEY` and `NEXT_PUBLIC_SITE_URL` are `sync: false`, entered in the dashboard. `NEXT_PUBLIC_*` is inlined at **build** time — Render bakes it during the Docker build |
| Deploys | **Auto-deploy on push** to the tracked branch. The repo was made **public** to bypass a Render↔GitHub sync issue (no secrets live in git — `.env*`, `.data/` are gitignored; `.env.production.example` is documentation only) |
| Cost | **≈ $7.25 / mo** (Starter web instance + 1 GB disk) |
| State today | Admin account created and persisted; `WSDOT_API_KEY` set → ferry board is **LIVE**; disk snapshots on |

**`fly.toml` is a maintained alternative** (Fly, Seattle region, volume `data`
at `/data`, same `/api/health` check) but Render is the running home. Other
persistent-disk hosts (Railway, a VPS) work identically — the only requirement
is a writable disk at `DATA_DIR`.

**Custom domain** `app.explorekingstonwa.com` (a single **CNAME** in the
NameHero Zone Editor → the `onrender.com` target; **do not move nameservers** —
that would break Chamber email) is **deferred until launch**. See
[DEPLOY.md §c](DEPLOY.md). The `onrender.com` URL is the live address until then.

### Redeploy / rollback

- **Redeploy:** push to the tracked branch → Render rebuilds the Docker image
  and swaps in the new container. The `/data` disk persists across the swap.
- **Env change:** edit in the Render dashboard and trigger a deploy. Note a
  `NEXT_PUBLIC_*` change requires a **rebuild** (build-time inlining), not just a
  restart.
- **Rollback:** redeploy a previous commit from the Render dashboard. Data on
  `/data` is unaffected — code and state are independent.

---

## 4. State & backups — three independent layers

`DATA_DIR` (`/data` on Render) is the entire backup surface. There are **three
backup layers**, deliberately independent:

### Layer 1 — Render daily disk snapshots (on-host, automatic)

Render snapshots the `/data` disk **daily** with a **7-day** restore window.
Restore from **Dashboard → the service → Disk → Snapshots**. This is the
zero-effort baseline and covers accidental deletion or corruption within a week.

### Layer 2 — off-site admin backup bundle (portable, on demand)

`/admin` shows a **"⤓ Download backup"** button (top of the dashboard) that hits
**`GET /api/admin/backup`** (`src/app/api/admin/backup/route.ts`). It walks the
whole `DATA_DIR`, inlines text files (`.json/.jsonl/.txt/.md/.csv`) as UTF-8 and
base64-encodes everything else (photos), and streams one file
`explore-kingston-backup-YYYY-MM-DD.json`. **Admin session only** — the bundle
contains password hashes, so **treat the download as sensitive**.

This is the *off-Render* copy. Pull one before risky changes and on a regular
cadence (important for LTAC/survey records, which live only in `DATA_DIR`).

**Restore an off-site bundle** with `scripts/restore-backup.mjs`:

```bash
node scripts/restore-backup.mjs ~/Downloads/explore-kingston-backup-2026-07-03.json ./.data
```

It validates the bundle header (`app === "explore-kingston"`), guards against
path traversal, and rewrites every file into the target dir. Use it to restore
onto a fresh host, a local machine, or as the source for a DB import. (For
in-place recovery on the live service, prefer the Render disk snapshot.)

### Layer 3 — scheduled off-site encrypted backup (automatic, E03)

`.github/workflows/backup-offsite.yml` runs **daily** (09:23 UTC) on GitHub
Actions: it calls `GET /api/admin/backup` with a scoped, read-only
`BACKUP_TOKEN` bearer token (no admin session needed), encrypts the response
with [`age`](https://github.com/FiloSottile/age) **on the runner, before
anything is written to disk**, and lands the encrypted `.age` file in the
Cloudflare R2 bucket `explore-kingston-backups` (or, until R2 is configured, a
14-day GitHub Actions artifact — the repo is public, so the artifact's
"downloadable by any logged-in GitHub user" exposure is fine precisely because
the payload is encrypted). The plaintext bundle never touches the runner's
disk or leaves the process piping `curl` into `age`.

**A red ✗ on this workflow means the backup did not happen that day** — that
*is* the alert; there's no separate paging channel for it. Check
`gh run list --workflow backup-offsite.yml` (or the Actions tab) if you
haven't seen a green run recently.

**Restore an off-site `.age` file:**

```bash
# 1. Decrypt with the private key from 1Password ("ExploreKingston backup age key"):
age -d -i /path/to/age-key.txt explore-kingston-backup-2026-07-06.json.age > bundle.json

# 2. Restore exactly like a Layer-2 bundle:
node scripts/restore-backup.mjs bundle.json ./.data
```

**Prove the chain works** (encrypt → decrypt → restore, byte-for-byte) any
time with `sh scripts/backup-roundtrip-test.sh` — it generates a throwaway
keypair and a synthetic bundle, so it never touches the real recipient key or
real data. Requires `age`/`age-keygen` on `PATH` (`brew install age` /
`apt-get install -y age`).

**Manual pull + encrypt** (e.g. before a risky change, independent of the
schedule):

```bash
BASE_URL=https://explore-kingston.onrender.com \
BACKUP_TOKEN=<from Render dashboard or 1Password> \
BACKUP_AGE_RECIPIENT=<age1... public key> \
sh scripts/fetch-encrypt-backup.sh
```

### `scripts/backup-data.sh` — tar snapshots (cron)

A POSIX-`sh` tarball snapshotter for a persistent-disk host that wants scheduled
archives independent of the app:

```bash
# defaults: tar /data -> /data/backups, keep 14 days
./scripts/backup-data.sh
# override target + retention:
DATA_DIR=/data BACKUP_DIR=/mnt/offbox RETENTION_DAYS=30 ./scripts/backup-data.sh
```

Cron example (daily 03:15):

```cron
15 3 * * * DATA_DIR=/data BACKUP_DIR=/data/backups /app/scripts/backup-data.sh >> /var/log/kingston-backup.log 2>&1
```

**A backup that lives only on the volume it backs up is not a backup** — point
`BACKUP_DIR` at off-box storage (S3/B2), or run the admin bundle to a machine
outside Render. On Render, layer 1 (snapshots) already covers the on-host case;
use layer 2 (bundle) for the off-site copy. See [DEPLOY.md §d](DEPLOY.md).

---

## 5. Admin operations

Everything under `/admin` is gated by `src/app/admin/layout.tsx` (role `admin`,
or open-with-banner pre-bootstrap). Editors write overlays into `DATA_DIR` and
public pages pick them up on the next ISR revalidate (~60 s).

| Admin page | What it does |
|---|---|
| `/admin` | Visitor insights (analytics + survey rollups for LTAC reporting) **and** the "⤓ Download backup" button |
| `/admin/accounts` | Mint invite codes (role + `linkedIds`), see users/invites, admin **password reset** (returns a temp password shown **once** — `adminResetPassword`) |
| `/admin/content` | Content CMS: edit the 77 copy blocks (`src/lib/site-copy-registry.ts`, reaching client components via `copy-context.tsx`) and **show/hide pages** (page-visibility) |
| `/admin/ferry-info` | Structured ferry **facts** (payment / boarding-pass / cash-tips / sources), the **prediction on/off** toggle, and the **SR-104 boarding-pass override** |
| `/admin/listings` | Restaurants (add / edit / hide via tombstone), lodging, and webcams |
| `/admin/itineraries` | Build/edit itineraries |
| `/admin/hunts` | Build/edit scavenger hunts; review player submissions |
| `/admin/map` | Parking-zone **polygon editor** (MapZone, Geoman) |
| `/admin/maps` | General map builder — named public views + drawable markers/lines/trails/areas + built-in data layers (output at `/map`) |

**Ferry prediction toggle** (`/admin/ferry-info` → `POST /api/admin/ferry-prediction {enabled:boolean}`): the busyness forecast (`/ferry/plan`, the "how busy today" panel on `/ferry`, the home callout) ships **dark**. The flag
(`stores/ferry-prediction.json`) defaults to **OFF**: the public sees nothing,
but **signed-in admins get a preview** so they can validate before flipping it
on. Flip it on only once you trust the estimate against reality.

**Boarding-pass override** (`/admin/ferry-info` → `POST /api/admin/boarding-pass
{action:"on"|"off"|"auto"}`): pins the SR-104 vehicle-boarding-pass verdict for
the rest of **today's Pacific day** when staff know better than the season/hours
estimate (machine down, off-season crowd, dead shoulder weekend). It's stamped
with the Pacific day it was set and **lapses silently at the next Pacific
midnight** — no timer, no DST edge case. `"auto"` clears it immediately (reverts
to the estimate). The widget, `/ferry`, and the "get in the ferry line" nav all
read the *effective* verdict, so they stay consistent.

---

## 6. Seasonal & recurring maintenance calendar

Dated, concrete, grounded in the seed files. Put these on a real calendar.

### Fixed dates

| When | What | Where |
|---|---|---|
| **2026-09-12** | Kitsap Transit GTFS feed **S1000066 expires** (valid 2026-06-14 → 2026-09-12). The bundled fast-ferry times are hardcoded from it — refresh when the fall schedule drops (`https://pride.kitsaptransit.com/gtfs/google_transit.zip`) or the app shows a stale summer schedule. Also re-check the Saturday seasonal window (currently months 5–9). | `src/lib/kitsap.ts` |
| **~2026-09-14** | Friends & Neighbors Brewing resumes Monday 4–8 pm hours (closed Mondays until MNF returns). Update the hours string (or have them edit via the portal). | `src/lib/data/restaurants.ts` |
| **October 2026** | WSF typically changes fares each October. The ferry page hardcodes **summer 2026** fares ($11.35 walk-on round trip, $27.00 car + driver) — update the numbers, or wire the Fares API. Kitsap Transit fares also historically take effect Oct 1. | `src/app/ferry/page.tsx` (per DATA_SOURCES §1) |
| **Oct 1–30, 2026** (annually; watch kitsap.gov/das each summer — the window has moved) | Kitsap County **LTAC** grant RFP for 2027 funds. One-month window; late = rejected. Export the survey/analytics summaries from `/admin` for the application. | DATA_SOURCES §12 |
| **Annually** (pick a fixed month once E03's migration date is known) | Rotate the **age backup keypair** (`BACKUP_AGE_RECIPIENT`) — see §12 Secret rotation. Keep every retired private key; old backups need them. | 1Password "ExploreKingston backup age key" |

### Quarterly re-verification

Small-town churn is the real data problem; trust no aggregator. Every quarter,
by hand and in a real browser (datacenter IPs get 403'd, so no automated checker
is authoritative):

- **Ordering deep links** — Toast/DoorDash return 403 to server fetches; click
  every link. Toast slugs rot (e.g. Sourdough Willy's slug still references its
  old address).
- **Restaurant hours vs the Chamber** — ask "anything change?" per venue.
- **Port + Diamond parking rates** — re-verify against
  portofkingston.org/port-of-kingston-parking/ and the PermitPoint page; update
  `lastVerified` dates in `src/lib/data/parking.ts`.
- **Airbnb/Vrbo lodging deep links** — listings die when owners delist; check
  in a browser.
- **Pull an off-site admin backup bundle** (§4) so the off-Render copy stays fresh.
- **Rotate `BACKUP_TOKEN` and `FERRY_OBSERVE_TOKEN`** — see §12 Secret rotation.

---

## 7. Recalibrate & refresh procedures

### Street-parking overlay — `public/geo/street-parking.json`

The color-coded street overlay is a **generated artifact** fetched client-side
by `src/components/town-map.tsx`. Regenerate with `scripts/gen-street-parking.py`
(rules live in `NAME_RULES` inside the script — edit there after a windshield
survey, then rerun and commit the regenerated JSON). The two source fetches, from
the script's header:

```bash
# 1. OSM street geometry for the Kingston UGA bbox (Overpass):
curl -s -X POST https://overpass-api.de/api/interpreter --data-urlencode \
  'data=[out:json][timeout:90];(way["highway"~"^(primary|secondary|tertiary|residential|unclassified)$"](47.770,-122.530,47.812,-122.483););out geom;' \
  -o streets-raw.json

# 2. Census TIGERweb boundary for Kingston CDP (GEOID 5335870):
curl -s "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/5/query?where=GEOID%3D%275335870%27&outFields=NAME,GEOID&returnGeometry=true&geometryPrecision=5&f=geojson" \
  -o kingston-cdp.json

# 3. Generate (writes public/geo/street-parking.json):
python3 scripts/gen-street-parking.py streets-raw.json kingston-cdp.json
```

Rule sources are the 2015/2016 county "Kingston Complete Streets" study, Port of
Kingston policy, and KCC 46.02/.04 — see [DATA_SOURCES.md](DATA_SOURCES.md) and
[MAPS.md](MAPS.md). Signs on the pole always win.

### Ferry busyness forecast — seasonal recalibration

`src/lib/ferry-forecast.ts` is a **pure, client-safe** heuristic (no fetch/env),
calibrated (**July 2026**) against WSF's own **"Best Times to Travel"**
per-sailing vehicle-traffic grid for **Summer 2026**. It also **learns**: it
blends in empirical busyness from the logged sailing observations
(`stores/ferry-observations.jsonl`, written by `POST /api/ferry/observe`),
weighted by sample count, so estimates start heuristic and grow data-driven.

Each season, when WSF publishes a **new** Best-Times grid (schedule turnover):

1. Diff the new per-sailing "Unlikely/Sometimes/Often/Likely Full" grid against
   the hourly `CURVES` (weekday/friday/saturday/sunday × direction) in
   `ferry-forecast.ts`.
2. Re-check the season windows (`seasonTag`: peak = Jun 14–Sep 19; shoulder
   ≈ May 10–Oct 13) and holiday multipliers against the new dates.
3. Keep `boardingPassExpected()` in sync with `getBoardingPassStatus()` in
   `src/lib/wsf.ts` (they're hand-synced peak-hours/season logic).
4. Sanity-check against reality with the accuracy backtest,
   **`GET /api/ferry/accuracy`**, which scores the forecast against the logged
   `ferry_observation` snapshots. Only widen public exposure (§5 toggle) once it
   holds up.

### Content refresh without a deploy

Copy, page visibility, ferry facts, listings, itineraries, hunts, and the map are
all editable at runtime via `/admin` (§5) — no rebuild needed. Reserve code edits
for the hardcoded values called out in §6 (fares, seasonal hours strings).

---

## 8. The DB-migration path (eventual Vercel move)

Phase 2 (Vercel serverless) is a **supported alternative**, not a rewrite — the
store seam already branches on env. When/if the app moves to Vercel:

1. **Provision cloud stores** and set the env (never in git;
   `.env.production.example` documents the shape): `DATABASE_URL` (Neon Postgres
   **pooled** URL, host contains `-pooler`), `BLOB_READ_WRITE_TOKEN` (Vercel
   Blob), `UPSTASH_REDIS_REST_URL` + `_TOKEN` (shared rate limiter). Do **not**
   set `DATA_DIR` on Vercel.
2. **Create the schema:** the checked-in Drizzle migrations (`db/migrations/`,
   generated from `src/lib/db/schema.ts`) apply automatically at server boot
   (`src/instrumentation.ts`), or up front via `npm run db:migrate`. The legacy
   `overlay` + append tables are still self-created lazily by `ensureSchema()`
   until E05 completes.
3. **Move the data once:**
   `node --env-file=.env.local scripts/migrate-to-db.mjs`. It reads the on-disk
   `DATA_DIR` tree and loads it into the cloud backends:
   - `stores/*.json`, `auth/users.json` (`auth-users`), `auth/invites.json`
     (`auth-invites`), `hunts/custom-hunts.json` (`custom-hunts`),
     `hunts/submissions.jsonl` (`hunt-submissions`), and map features → the
     Neon **`overlay`** table (`_deleted` lifted into the `deleted` column).
   - `analytics/events.jsonl` → `analytics_event`; `ltac-responses.jsonl` →
     `survey_response` (append tables).
   - Hunt reference/player photos and `map/images/**` → Vercel Blob, with the
     record image fields rewritten to the returned `https` URLs.
   - **Idempotency:** overlay upserts use `ON CONFLICT DO UPDATE` (safe to
     re-run). The **append tables are INSERT-only and run-once** — the script
     skips each if it already has rows (`--force` to override, which
     **doubles** them). Blob uploads need the token; without it, image files are
     left as relative paths and a warning is printed — re-run with the token.

See [DEPLOY.md §a/§g](DEPLOY.md) for the full Vercel walkthrough and cost caveat.
Render stays the running home until there's a reason to move.

---

## 9. Consolidated human action items

Things a **person** (mostly the Chamber) must do — no code involved.

| # | Item | Contact / detail |
|---|---|---|
| 1 | **Windshield survey of posted street-parking hours** — the downtown 2-hour zones' enforcement hours aren't online; the overlay leans on the 2015 county study. Update `NAME_RULES` in `scripts/gen-street-parking.py` and regenerate (§7). | Chamber volunteer with a clipboard |
| 2 | **Call the Port about overnight parking in numbered spaces** — probable but never explicitly authorized; the app says "call first". Get a definitive answer. | Port of Kingston, 360-297-3545 |
| 3 | **Submit the GBP "Application for Basic API Access"** — needs the Chamber's verified Google Business Profile (60+ days old), filed from an owner/manager email. The GBP adapter is blocked on it. | SYNDICATION §1 |
| 4 | **Submit the Apple Business application** (third-party listing manager). Timeline unknown — submit early. | SYNDICATION §3 |
| 5 | **Send the Kitsap Transit permission email** — written OK to use GTFS/GTFS-RT in a Chamber-affiliated app; ask them to resolve the PugetPass contradiction too. | lindsayc@kitsaptransit.com |
| 6 | ~~Send the AMS API support email~~ **Retired 2026-07-10** — the Chamber is rolling off GrowthZone entirely (docs/ROLLOFF-GROWTHZONE.md; ADR-0001 closed as walk-away), so the API inquiry is moot. Items 6b/6c below remain live; `npm run ams:checks` stays the tenant-drift alarm until cancellation. | — |
| 6b | **Generate the whole-calendar iCal feed URL** in the GrowthZone back office (Events → Calendars settings → "Calendar Feed", per GrowthZone's Calendars help article) and send the URL to Mat — the free transitional events-ingest path per docs/adr/ADR-0002-app-first-events-and-manual-exports.md. ~10 minutes. | Chamber GrowthZone staff login |
| 6c | **Set up the member-export routine**: save a GrowthZone report (business name, membership status, level, drop date, categories, address — NO member emails/personal contacts) and export CSV/Excel on a cadence (recommended weekly + before board meetings — Chamber confirms what's sustainable), delivered to Mat or uploaded to the app importer when it ships. Agent-automatable later per ADR-0002. | Chamber GrowthZone staff login |
| 7 | **Confirm info@kingstonchamber.com is monitored** — the Stay/About pages use it as the public mailto. | Chamber office, 360-860-2239 |
| 8 | **Recruit hunt-reward businesses** — local perks (discount, sticker, free coffee) so finished scavenger hunts pay off; also needed before printing QR signage. | Chamber member outreach |
| 9 | **Confirm The Kingston Coffee Company details** — newly opened, hours reported but unverified. | Chamber / phone |
| 10 | **Resend email (before businesses self-serve)** — SPF + DKIM for `mail.explorekingstonwa.com` at NameHero so invite email works. Until then hand invite codes over directly. | SYNDICATION "Email" |
| 11 | **Send the GrowthZone written non-renewal notice by March 1, 2027** — the contract auto-renews each April; notice must land ≥30 days before term end and missing it costs another non-refundable ~$4k year. Confirm the exact April term-end day from the renewal invoice and complete ALL data exports first (no export rights after termination). Full plan: docs/ROLLOFF-GROWTHZONE.md §4. | Mat + Chamber office — calendar this NOW |
| 12 | **Constant Contact takeover (Mat)** — when the CC export work is set up: inventory which CC lists GrowthZone auto-fills (Contacts → Lists), gather whatever access is needed, export the GZ email/newsletter templates at the same time, and stand up the app→CC list-export runbook (docs/ROLLOFF-GROWTHZONE.md §3). | Mat, with Chamber CC login |

---

## 10. Troubleshooting

### Ferry board says schedule is "not live" / fallback

`src/lib/wsf.ts` returns the bundled fallback (`live: false`) whenever
`WSDOT_API_KEY` is unset **or any fetch fails/non-200s** — failures are silent by
design. Check, in order: the key exists in the environment the server actually
runs with (Render dashboard var in prod — a `NEXT_PUBLIC_*` change needs a
rebuild, but `WSDOT_API_KEY` is runtime and only needs a redeploy/restart;
`.env.local` locally); the WSDOT endpoints are up. Note WSDOT hasn't always
enforced the access code, so a *wrong* key may still work — don't treat "it
works" as proof the key is valid.

### Ferry busyness prediction is hidden from the public

The forecast **ships dark**. `stores/ferry-prediction.json` defaults to **OFF**,
so the public sees nothing while **signed-in admins still get a preview**. This
is intended, not a bug. Flip it on at `/admin/ferry-info` (§5) once you trust the
estimate (§7 backtest).

### Boarding-pass verdict looks wrong / stuck

The verdict is a season/hours **estimate** unless an admin pinned it today
(`stores/boarding-pass-override.json`). An override **lapses at Pacific
midnight** — if yesterday's override seems "stuck," it isn't; today's read
already reverted. To force it, set `on`/`off`/`auto` at `/admin/ferry-info`.

### Open-now badges all show "Closed" (or all open)

The hours engine (`src/lib/hours.ts`) computes everything in
**America/Los_Angeles** regardless of server/browser TZ — first check your
expectation is Kingston wall-clock, not local time. If genuinely wrong: spans are
`["HH:mm","HH:mm"]` 24-hour strings; a span whose close ≤ open crosses midnight
(17:00–01:00 shows open after midnight via *yesterday's* tail). A bad
portal-edited overlay (`stores/restaurants.json`) overrides the seed — inspect it
before blaming the seed file.

### Map overlay / street parking missing or outdated

The overlay is the generated artifact `public/geo/street-parking.json` (fetched
client-side by `town-map.tsx`). Missing/stale ⇒ regenerate and commit it (§7).
For the CMS map (`/map`), check `stores/map-views.json` / `map-features.json`
and the `/admin/maps` editor. (There is **no** ATM/cash map — that feature was
removed; cash guidance now lives in the structured ferry-info **"cash-tips"**
record, edited at `/admin/ferry-info`.)

### Portal login loops / everyone logged out after `AUTH_SECRET` change

Sessions are stateless HMAC cookies (`vk-session`) signed with `AUTH_SECRET`. If
that secret changes (rotated, or differs between local and prod), **every**
existing session fails signature verification and users bounce to sign-in. Fix:
keep `AUTH_SECRET` **stable** — on Render it's `generateValue:true` and pinned,
so don't rotate it casually. Users clear the cookie and sign in again. (This is
also the intentional global "log everyone out" lever — there's no per-session
revocation.)

### `/api/health` returns 503

The probe couldn't write to `DATA_DIR`. On Render that means the `/data` disk is
unmounted or read-only — Render will then withhold traffic (the health gate doing
its job). Check the disk is attached and `DATA_DIR=/data`. Locally, check the
`.data` directory is writable. The 503 body still reports the resolved `dataDir`,
which is the first thing to confirm.

### Abuse response: anonymous-write flood / disk full

**Symptoms:** `/api/health` starts returning 503 (see above), or the Render
dashboard shows the `/data` disk approaching its 1 GB size. Both point at the
same root cause: an anonymous write endpoint filled the disk.

**Where the limits live:** `src/lib/rate-limit.ts` is the shared seam
(`checkRateLimit`/`clientKey`). The three anonymous-write routes it protects:

- `POST /api/hunts/submit` — 5 uploads / 10 min / IP, plus a 400 MB storage
  quota on `<DATA_DIR>/hunts/photos` (`MAX_PHOTO_STORAGE_BYTES` in
  `src/lib/hunt-store.ts`); returns 507 once the quota is exceeded.
- `POST /api/track` — 120 events / 5 min / IP plus an 8 KB body cap; abuse is a
  **silent drop** (always `{ok:true}`) — telemetry never 429s a real visitor.
- `POST /api/survey` — 5 submissions / 10 min / IP, 429 + `Retry-After`.

**To clear hostile hunt uploads:** inspect and prune
`<DATA_DIR>/hunts/photos/<huntId>/<stopId>/` (e.g. `/data/hunts/photos/...` on
Render) for files that aren't legitimate player submissions, then redeploy or
wait ~60 s for the cached storage-size check to pick up the change.

**To tune the quota:** raise or lower `MAX_PHOTO_STORAGE_BYTES` in
`src/lib/hunt-store.ts` (currently 400 MB, leaving headroom on the 1 GB disk
for accounts, portal overlays, analytics, and the LTAC survey).

### Edits not showing up on public pages (stale ISR)

Content pages revalidate on a window (~60 s), so a portal/admin edit can take up
to a minute to appear — that's normal. Feed endpoints add CDN caching; upstream
adapters cache separately (WSF schedule ~15 min, terminal space ~60 s, alerts
~5 min, weather ~30 min, tides ~6 h). If a page is stuck beyond that: locally
restart `npm run dev`; in prod redeploy or wait the window out before digging.

---

## 11. Monitoring & alerts (E03)

Two free-tier services watch the live app; both alert Mat's personal email.

| Service | What it watches | Alert path |
|---|---|---|
| **Sentry** | Server-side exceptions only (`src/instrumentation.ts`). `sendDefaultPii: false`, `tracesSampleRate: 0` — no visitor IPs, cookies, request bodies, or performance traces are sent. Client-side Sentry is explicitly **not** wired. | Sentry project notification → email |
| **UptimeRobot** | Two HTTP(S) monitors, 5-min interval: `GET /api/health` and `GET /api/ferry/status` on the production host. | UptimeRobot alert contact → email |

**Sentry setup:** one project (platform: Next.js/Node), DSN stored as
`SENTRY_DSN` (a `sync: false` var in `render.yaml` — never `NEXT_PUBLIC_`,
never in git). `SENTRY_ENVIRONMENT` distinguishes `production` from `staging`
so events don't mix. Confirm it's wired by checking the Sentry project's
"waiting for events" indicator turns green after a deploy, or by forcing a
deliberate error on **staging only** (never production).

**UptimeRobot setup:** two monitors pointed at the URLs above; a read-only
API key (stored in 1Password) lets `scripts/verify-migration.sh` confirm both
monitors report status "up" without logging into the dashboard.

Both are genuinely free tier (UptimeRobot free plan, Sentry Developer/free
plan) — no new spend.

## 12. Secret rotation (E03)

| Secret | Cadence | Procedure |
|---|---|---|
| `BACKUP_TOKEN` | Quarterly (align with the §6 quarterly checklist) | `openssl rand -hex 32` → update the Render dashboard env var on **both** services → update the GitHub Actions repo secret (`gh secret set BACKUP_TOKEN`, value piped via stdin, never a CLI arg) → no redeploy required (runtime var) |
| `FERRY_OBSERVE_TOKEN` | Quarterly | Same procedure as `BACKUP_TOKEN` above — one value shared by both ferry cron workflows |
| age keypair (`BACKUP_AGE_RECIPIENT`) | Annually, or immediately on any suspicion of exposure | `age-keygen` → new **public** key becomes the repo variable `BACKUP_AGE_RECIPIENT` (`gh variable set`) → new **private** key goes to 1Password ("ExploreKingston backup age key") → **keep every old private key** — backups encrypted under a retired key can only be decrypted with it, and rotation is forward-only (old backups are never re-encrypted) |
| `AUTH_SECRET` | Never casually — rotating logs **every** signed-in user out (see §10 "Portal login loops"). Only rotate on a real compromise. | Render dashboard env var → redeploy. There is no per-session revocation, so this is the only "log everyone out" lever. |

Never echo a secret value in a terminal, script, or CI log — this repo is
public, so a logged secret is an exposed secret. `gh secret set NAME` reads
the value from stdin or a file, never a shell argument that could land in
shell history or process listings.
