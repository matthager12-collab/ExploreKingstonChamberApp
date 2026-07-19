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

1. **Postgres is the structured-data home; `DATA_DIR` keeps the images**
   (since E05). Every account, portal edit, ferry override, analytics and
   survey row lives in Neon Postgres (`record` + append tables; writes go
   through the audited choke point `src/lib/db/records.ts`). The `DATA_DIR`
   directory (resolved by `src/lib/data-dir.ts`) holds hunt photos and map
   images (until E15). Code, seed content, brand assets, and the generated
   parking overlay are all reproducible from git + `npm install`. Back up
   **both** Neon (PITR/branching) and `DATA_DIR`.
2. **`DATABASE_URL` is required on every deploy** — `/api/health` reports
   `dbOk:false` and 503s without it, so a mis-configured release fails closed.
   The remaining env-detected seams cover only images (Vercel Blob when
   `BLOB_READ_WRITE_TOKEN` is set, else the disk) and rate limiting (Upstash
   when set, else in-process). On Render only `DATABASE_URL` + `DATA_DIR` are
   set; the Vercel move is now a Blob/Upstash config change plus the image
   move (§8), not a rewrite.

---

## 1. Local development

**Prereqs:** **Node 22+** (the production image is `node:22-alpine`; Next 16
needs ≥ 20.9), npm, and — since E05 — a **Postgres** to point `DATABASE_URL`
at (a throwaway Docker container or a personal Neon dev branch; see the table
below). No paid service required.

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
| `AUTH_SECRET` | **Yes** for the portals — `src/lib/auth/session.ts` `secret()` throws `AUTH_SECRET missing` without it (and `src/proxy.ts` fails CLOSED, redirecting every gated route to the login page) | Any long random string, e.g. `openssl rand -hex 32`. Signs the stateless `vk-session` HMAC cookie. **Changing it logs everyone out** (see §8). |
| `WSDOT_API_KEY` | No — app falls back to the bundled schedule, labeled not-live | Free access code from <https://wsdot.wa.gov/traffic/api/> (enter an email, code issued instantly). Current code registered under matt.hager12@gmail.com; already in `.env.local`. Rotating = registering again. |
| `NEXT_PUBLIC_SITE_URL` | No locally (defaults to `http://localhost:3000`); **set in production** | Absolute production origin for share-card/canonical URLs (`src/app/layout.tsx` `metadataBase` — the app spreads by visitors texting links). **Build-time var** — inlined into the client bundle at `npm run build`; a dashboard-only change needs a rebuild. |
| `DATA_DIR` | No locally (defaults to `<repo>/.data`); **set in production** | Absolute path to the mutable-state root, resolved via `src/lib/data-dir.ts`. Leave unset locally. In production it **must** be an absolute path on a mounted persistent volume (`/data` on Render/Fly) or redeploys wipe accounts, portal edits, and photos. |
| `SETUP_TOKEN` | Only to bootstrap the first admin (locally or in production) — `POST /api/auth/setup` 403s fail-closed without it | Any string you choose, e.g. `openssl rand -hex 16`. Only consulted while zero users exist (`hasAnyUsers()` is checked first) — once an admin exists, it's never read again. Set it in `.env.local` before running `/portal/setup` on a fresh `.data/`; on Render it's `generateValue: true`. |
| `DATABASE_URL` | **Yes since E05** — structured data (listings, events, auth, …) lives in Postgres; `next dev` pages fail without it. Images/photos stay on disk under `DATA_DIR`. | A throwaway local Postgres (`docker run -e POSTGRES_PASSWORD=ci -p 5432:5432 postgres:16` → `postgres://postgres:ci@127.0.0.1:5432/postgres`) or a personal Neon dev branch. Migrations under `db/migrations/` apply automatically at server start. **Never point local dev at the production database.** |

**Remaining Phase-2 (Vercel) vars** — `BLOB_READ_WRITE_TOKEN`,
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — are **not** set locally or
on Render; they belong only to a Vercel deployment (§7, `.env.production.example`).

### First run — bootstrap the admin and mint invites

1. `npm run dev`, open <http://localhost:3000>.
2. **Bootstrap the first admin:** set `SETUP_TOKEN` in `.env.local` (any string;
   the endpoint 403s fail-closed without it), then visit `/portal/setup` and
   enter that same value in the "Setup token" field. It works **only while
   zero users exist** (the `auth-users` records) — it creates the first admin
   account (role `admin`, empty `linkedIds`), signs you in, then locks itself
   forever (`/api/auth/setup` returns 403 once any user exists; the endpoint is
   also rate-limited to 5 attempts). Until the first admin exists, `/admin` is
   open with a loud amber banner so bootstrap can't lock itself out
   (`src/app/admin/layout.tsx`).
3. **Mint invites:** as admin go to `/admin/accounts`. Each invite code is tied
   to a role (`business` / `nonprofit` / `admin`) and the listing/org ids that
   account may edit (`linkedIds`). Hand the code to the business; they redeem it
   at `/portal/join`. (`/api/auth/login`, `/setup`, `/redeem` are rate-limited.)
4. Portal edits (hours, listings, events, volunteer needs) land in the
   `record` table and appear on public pages within ~60 s (ISR).

---

## 2. State layout — Postgres, plus images under `DATA_DIR`

**Since E05 the JSON/JSONL files below are NOT the live data** — every
structured store shown as a `.json`/`.jsonl` entry lives in Postgres
(`record` rows keyed `(store, id)`; `analytics_event` / `survey_response` /
`ferry_observation` append tables). What's still live on disk: `map/images/`,
`hunts/refs/`, `hunts/photos/` (until E15). The tree is kept as the map of the
on-disk layout — pre-E05 disks still carry the legacy files, and the store
names below are the `record.store` keys.

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

Since E05 the structured rows live in Postgres: reset one domain against your
**local dev database** with `DELETE FROM record WHERE store = '<name>'` (and
`TRUNCATE` the matching append table for analytics/survey/observations) — the
domain reverts to its git seed on the next read. The file deletions below now
apply only to the image directories and to pre-E05 disks. Stop the dev server
first so a write doesn't race the delete.

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
| Persistence | **Neon Postgres** for all structured data (E05 — `DATABASE_URL` is `sync: false` in `render.yaml`, set in the dashboard) + a 1 GB disk named `data` mounted at **`/data`** (`DATA_DIR=/data`) for hunt photos / map images. The disk survives deploys and restarts |
| Health gate | `healthCheckPath: /api/health` — Render routes traffic only after 200. `/api/health` returns `{ ok, dataDir, dataWritable, dbOk, time }`, **200 only when `/data` is writable AND Postgres answers, 503 otherwise** (write-probes `/data/.health-probe`, pings the DB). This catches an unmounted/read-only volume — or a release booted without `DATABASE_URL` — before users do |
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

Since E05 the backup surface is split: **Neon holds structured data** (its
PITR/branching is the recovery path for records) and **`DATA_DIR`** (`/data`
on Render) holds images/hunt photos. The bundle layers below still walk the
whole `DATA_DIR`. There are **three backup layers**, deliberately independent:

> **The nightly export.** The off-site job (Layer 3,
> `.github/workflows/backup-offsite.yml`, daily 09:23 UTC) pulls
> `GET /api/admin/backup` with the scoped `BACKUP_TOKEN` — since E05 that
> endpoint returns the **v2 bundle**: the old disk-file walk PLUS a `db`
> section (every `record` row with its governance metadata, the append-only
> audit trail, quarantine, and the three telemetry tables), `"version": 2`,
> pretty-printed so a volunteer can open it in a text editor (the
> human-readable export / vendor-exit path, M-20-07). **Checking
> "last backup" age:** the workflow run list IS the check — a red X on
> `Off-site encrypted backup` means the nightly bundle did NOT land that day
> (there is no separate alert channel); the encrypted `.age` files in the R2
> bucket carry date-stamped names for a second opinion. Restore paths:
> disk files via `scripts/restore-backup.mjs`, the `db` section via
> `npm run restore:db` (see [RUNBOOK-CUTOVER.md](RUNBOOK-CUTOVER.md) §Restore
> drill — rehearsed quarterly).

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

This is the *off-Render* copy of the disk. Pull one before risky changes and
on a regular cadence. (Since E05 LTAC/survey records live in Postgres, not
`DATA_DIR` — cover them with Neon PITR/branching or a SQL dump.)

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

Everything under `/admin` is gated in three places (E06): `src/proxy.ts` turns
away requests with no valid session cookie at the request boundary,
`src/app/admin/layout.tsx` re-checks `role === "admin"`, and every
`/api/admin/*` route calls the shared gate itself (route handlers bypass
layouts). The old "open with an amber banner before bootstrap" grace is GONE —
`/admin` is never public, and a fresh install bootstraps through `/portal`,
which redirects to `/portal/setup`. Editors write records into Postgres
(audited, E05) and public pages pick them up on the next ISR revalidate (~60 s).

| Admin page | What it does |
|---|---|
| `/admin` | Visitor insights (analytics + survey rollups for LTAC reporting) **and** the "⤓ Download backup" button |
| `/admin/accounts` | Mint invite codes (five roles, optional **email binding**, 14-day expiry, org join-or-create), **revoke** un-redeemed invites, see users with role / last login / disabled state, **disable / enable / change role / delete** accounts, and admin **password reset** (temp password shown **once** — `adminResetPassword`) |
| `/admin/content` | Content CMS: edit the 77 copy blocks (`src/lib/site-copy-registry.ts`, reaching client components via `copy-context.tsx`) and **show/hide pages** (page-visibility) |
| `/admin/ferry-info` | Structured ferry **facts** (payment / boarding-pass / cash-tips / sources), the **prediction on/off** toggle, and the **SR-104 boarding-pass override** |
| `/admin/listings` | Restaurants (add / edit / hide via tombstone), lodging, and webcams |
| `/admin/itineraries` | Build/edit itineraries |
| `/admin/hunts` | Build/edit scavenger hunts; review player submissions |
| `/admin/map` | Parking-zone **polygon editor** (MapZone, Geoman) |
| `/admin/maps` | General map builder — named public views + drawable markers/lines/trails/areas + built-in data layers (output at `/map`) |

**Ferry prediction toggle** (`/admin/ferry-info` → `POST /api/admin/ferry-prediction {enabled:boolean}`): the busyness forecast (`/ferry/plan`, the "how busy today" panel on `/ferry`, the home callout) ships **dark**. The flag
(the `ferry-prediction` record) defaults to **OFF**: the public sees nothing,
but **signed-in admins get a preview** so they can validate before flipping it
on. Flip it on only once you trust the estimate against reality.

### Off-board a volunteer the same day (E06)

The common case: someone leaves the Chamber, or a laptop with a live session
goes missing. Sessions are 30-day cookies, so "wait for it to expire" is not an
answer.

1. `/admin/accounts` → find the person → **Disable**.
2. That bumps their `session_version`, which invalidates **every outstanding
   cookie for that account immediately** — not on next login, not in 30 days.
   Their very next request is a 401.
3. Verify: ask them to reload `/portal`, or `curl` any `/api/portal/*` route
   with their cookie — it must return `401`.
4. Optional: **Delete** removes the account row entirely. Their audit history
   SURVIVES (the actor id stays as a dangling reference by design) — the trail
   must outlive the account.

**If they were the only admin,** the last-admin guard refuses the change with an
explanation. Promote or invite another admin first; this is deliberate, and it
is the one case where you cannot lock the Chamber out of its own site.

Related: an admin **password reset** and a user's own **password change** also
bump `session_version`, so either one kills a stolen cookie too.

### Revoke an invite

An invite that has been emailed but not yet redeemed is still a live grant.
`/admin/accounts` → the invite row → **Revoke**. The code stops working at
once; redeeming it returns the same "invalid or expired" message as a code that
never existed.

Invites now expire on their own after **14 days**, and an invite bound to an
email address only works for that address. An **admin** invite cannot be minted
without an email binding at all — a forwarded admin code would otherwise be a
bearer grant on the whole site.

### Deploy day: everyone signs in again (one time)

The auth-v2 release changes the session-token format (it adds the `sv`
revocation claim). Tokens without it cannot be revoked, so they are not
honored.

**Every signed-in user is logged out once when this release deploys.** There
are roughly 20 accounts and they are all known to the Chamber — announce it
first. Nobody loses data, nobody needs a new password: they sign in again with
the credentials they already have.

Order of operations (staging first, then production in a quiet window):

1. Apply the Drizzle migration (`npm run db:migrate`).
2. Dry-run, and **point `--data-dir` at an empty directory**:

   ```bash
   node scripts/migrate-auth-v2.mjs --data-dir "$(mktemp -d)" --dry-run
   ```

   Read the diff. It exits **2** and writes nothing if anything is ambiguous
   (two accounts sharing a listing id, colliding emails, an unmappable role).
   Resolve those by hand and re-run; do not "just apply".

   **Why the empty `--data-dir`** (found during the 2026-07-19 staging
   rehearsal): the script reads BOTH legacy homes — `<data-dir>/auth/*.json`
   and the `record` table — and HALTS if both hold users, because merging them
   could silently drop or resurrect accounts. When you run this from a local
   checkout against a REMOTE database, your own stale `.data/auth/users.json`
   (a dev leftover) counts as the second source and trips that guard:

   ```
   HALTED: CONFLICT: both legacy sources hold users — 1 in
   <data-dir>/auth/users.json and 2 in the record table
   ```

   That is the guard working, not a bug — but here the "conflict" is just your
   laptop. An empty `--data-dir` makes the database the only source, which is
   what you want for staging and production. Omit it **only** when migrating a
   host whose accounts really do live on disk (a pre-E05 release).

3. `node scripts/migrate-auth-v2.mjs --data-dir "$(mktemp -d)" --apply`.
   Safe to re-run — orgs and users upsert by id, and the `owner_org_id`
   backfill only touches rows where it is still NULL.
4. Deploy the code. **The auth tables must exist before the new code serves
   traffic** — apply step 1's migration first, or the app boots against tables
   it cannot see.
5. Sign in yourself and confirm: an admin sees `/admin`, a business account can
   still edit its own listing and nothing else.

**Rollback window:** redeploy the previous release. The legacy accounts are
left untouched in place for one release (ADR-D1) — the migration never deletes
its source. After that release, they can be cleaned up.

### `AUTH_SECRET` rotation — now the blunt instrument, not the only tool

Before E06 the only way to end a session was to rotate `AUTH_SECRET`, which
logs out **every** user at once. That is still the break-glass move for a
suspected secret compromise, but it is no longer how you off-board one person —
use **Disable** above. See §10 "Portal login loops" and §11.

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

Phase 2 (Vercel serverless) is a **supported alternative**, not a rewrite —
since E05 the structured data already lives in Neon Postgres on **every** host
(`DATABASE_URL` is required everywhere; `/api/health` 503s without it), so a
Vercel move is a hosting change, not a data-model change. When/if the app moves
to Vercel:

1. **Provision cloud stores** and set the env (never in git;
   `.env.production.example` documents the shape): `DATABASE_URL` (Neon Postgres
   **pooled** URL, host contains `-pooler` — already required on any host),
   `BLOB_READ_WRITE_TOKEN` (Vercel Blob, for images), `UPSTASH_REDIS_REST_URL`
   + `_TOKEN` (shared rate limiter). Do **not** set `DATA_DIR` on Vercel.
2. **Create the schema:** the checked-in Drizzle migrations (`db/migrations/`,
   generated from `src/lib/db/schema.ts`) apply automatically at server boot
   (`src/instrumentation.ts`), or up front via `npm run db:migrate`. Migrations
   are the **only** schema mechanism — the legacy lazy `ensureSchema()` path
   was removed by E05.
3. **Move the data once (only if importing pre-E05 file-era state):**
   `npm run import:data-dir -- --data-dir <dir>`. The importer reads a
   `DATA_DIR`-shaped tree — either a live `.data/` copy or a backup bundle
   restored with `scripts/restore-backup.mjs` — strictly read-only:
   - `stores/*.json`, `auth/users.json` (`auth-users`), `auth/invites.json`
     (`auth-invites`), `hunts/custom-hunts.json` (`custom-hunts`), and
     `hunts/submissions.jsonl` (`hunt-submissions`, legacy id-less rows get
     deterministic synthetic ids) → the **`record`** table, written through
     the app's write choke point (each write audited as `import`).
   - `analytics/events.jsonl` → `analytics_event`; `ltac-responses.jsonl` →
     `survey_response`; `ferry/observations.jsonl` → `ferry_observation`
     (append tables).
   - **Dry-run by default:** the bare command only prints a per-store diff
     (new/changed/unchanged/tombstones/quarantined). Add `--apply` to write —
     it asks you to type the target DB host to confirm (`--yes` skips the
     prompt for scripted runs).
   - **Quarantine workflow:** records that fail the store schemas land in the
     `quarantine` table + the QUARANTINE report, never in `record`; corrupt
     JSONL lines are reported per-line. Exit codes: 0 clean · 1 halt
     (unparseable file / aborted) · 2 completed with quarantines — cut over
     only on 0, or after acknowledging every quarantined row.
   - **Idempotency:** record upserts are safe to re-run (unchanged rows are
     skipped). The **append tables are INSERT-only and run-once** — each is
     skipped if the target already has rows (`--force-append` to override,
     which **doubles** them).
   - **Images are not moved:** the importer does no Blob uploads or path
     rewriting (hunt photos and `map/images/**` stay on disk this epic) —
     carrying image files to Vercel Blob is a separate, still-unscripted step.

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

Two probes can fail (the body says which): `dataWritable:false` means the
probe couldn't write to `DATA_DIR` — on Render the `/data` disk is unmounted
or read-only; check the disk is attached and `DATA_DIR=/data` (locally, that
`.data` is writable). `dbOk:false` (E05) means Postgres didn't answer —
`DATABASE_URL` missing/wrong or Neon unreachable. Either way Render withholds
traffic (the health gate doing its job, keeping the previous release serving).
The 503 body still reports the resolved `dataDir`, which is the first thing to
confirm.

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
for map images and hunt reference photos — the disk's remaining tenants
since E05).

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
| `AUTH_SECRET` | Never casually — rotating logs **every** signed-in user out (see §10 "Portal login loops"). Only rotate on a real compromise. | Render dashboard env var → redeploy. Since E06 there IS per-user revocation (disable / reset / role change bump `session_version`), so rotating this is only for a compromise of the SECRET itself — to remove one person, use §5 "Off-board a volunteer". |

Never echo a secret value in a terminal, script, or CI log — this repo is
public, so a logged secret is an exposed secret. `gh secret set NAME` reads
the value from stdin or a file, never a shell argument that could land in
shell history or process listings.
