# Deployment guide

The authoritative deploy guide for Explore Kingston. **July 2026.**

**Status:** Phase 1 is **LIVE on Render** at <https://explore-kingston.onrender.com>
(persistent-disk / filesystem mode). Phase 2 (Vercel serverless) is fully built
and migration-tested but **not yet the running home** — it's the documented
alternative / future move, not a pending chore.

Companion docs: [OPERATIONS.md](OPERATIONS.md) (day-2 runbook, backups, env-var
reference, troubleshooting), [ARCHITECTURE.md](ARCHITECTURE.md) (deployment
topology, the persistence seam), [DATA_SOURCES.md](DATA_SOURCES.md) (WSDOT key,
DNS facts), [SYNDICATION.md](SYNDICATION.md) (outbound feeds / any future email).

---

## 1. The persistence seam (why there are two phases)

The app writes all of its mutable state — accounts, portal edits, hunts +
photos, analytics, survey responses, ferry observations, CMS copy/visibility,
map views/features — outside the code tree. Where that state lands is chosen
**per store, at runtime, by which env vars are present.** Nothing above the
store modules (routes, components, domain types) ever branches. Three seam
files:

| Seam file | Detector | Backend when set | Fallback when unset |
|---|---|---|---|
| `src/lib/data-dir.ts` | `DATA_DIR` present | absolute path on a **persistent disk** | `<repo>/.data/` |
| `src/lib/db.ts` | `hasDb()` = `DATABASE_URL` set | **Neon Postgres** (`overlay` + append tables) | filesystem JSON via `data-dir` |
| `src/lib/blob-store.ts` | `hasBlob()` = `BLOB_READ_WRITE_TOKEN` set | **Vercel Blob** (public CDN) for images | image bytes under `DATA_DIR`, served by the app's image routes |
| `src/lib/rate-limit.ts` | `UPSTASH_REDIS_REST_URL` set | **Upstash Redis** shared sliding window | in-process `Map` (single-instance only) |

Two consequences:

- **Phase 1** sets `DATA_DIR` and *none* of the cloud vars → every store uses
  the disk. This is the current live shape on Render.
- **Phase 2** sets the cloud vars and *leaves `DATA_DIR` unset* → `hasDb()` /
  `hasBlob()` / Upstash route each store to Neon / Blob / Redis. This is the
  Vercel shape.

`npm run dev` sets none of them, so local development runs entirely on `.data/`
— the same code path Phase 1 uses in production, just at a different `DATA_DIR`.

### What maps to which backend in Phase 2

| Data | Phase 1 (disk) | Phase 2 backend |
|---|---|---|
| auth users + invites | `.data/auth/{users,invites}.json` | `overlay` rows, `store='auth-users'` / `'auth-invites'` |
| portal overlays (restaurants, events, charities, needs, lodging, webcams, parking zones, itineraries, ferry-info, boarding-pass, ferry-prediction, site copy/pages, map views/features) | `.data/stores/<name>.json` | `overlay` rows keyed `(store, id)`, `deleted` column carries `_deleted` tombstones |
| custom hunts + submissions | `.data/hunts/*` | `overlay` (`custom-hunts`, `hunt-submissions`) |
| hunt reference/player photos, map-feature images | files under `.data/` | **Vercel Blob** (public URL stored on the record) |
| analytics events | `.data/analytics/events.jsonl` | `analytics_event` append table |
| LTAC survey responses | `.data/ltac-responses.jsonl` | `survey_response` append table |
| ferry observations (busyness forecast learning log) | `.data/…` jsonl | `ferry_observation` append table |
| auth login/setup/redeem rate limiting | in-process `Map` | **Upstash Redis** shared counter |

The tables are defined in [`db/schema.sql`](../db/schema.sql). `ensureSchema()`
in `db.ts` creates `overlay`, `analytics_event`, `survey_response`, and
`ferry_observation` lazily on first use, so a fresh Neon database
self-initializes.

---

## 2. Phase 1 — persistent-disk host (the CURRENT live shape)

Ship the code exactly as it is onto a host with a real disk. Two repo pieces
make this turnkey:

- **`next.config.ts`** sets `output: "standalone"` — a self-contained server
  bundle (`.next/standalone/server.js`) that runs without `node_modules`.
- **`Dockerfile`** (multi-stage `node:22-alpine`: `deps → build → runner`)
  produces the lean runtime image. The runner copies `.next/standalone`, then
  `.next/static` and `public/` (standalone omits both), runs as non-root user
  `nextjs`, defaults `DATA_DIR=/data`, declares `VOLUME ["/data"]`, and its
  `HEALTHCHECK` hits `/api/health`.
- **`GET /api/health`** (`src/app/api/health/route.ts`) write-tests `DATA_DIR`
  (mkdir + write + unlink a probe file) and returns
  `200 {ok:true, dataDir, dataWritable:true, time}` when writable, `503`
  otherwise. This is the exact failure (unmounted / read-only volume) that must
  be caught before real users hit the box. Wire it as the host's health check.

The file store is single-writer and fine for a one-admin Chamber — Phase 1 is a
real production deployment, not demo grade (see [ARCHITECTURE.md](ARCHITECTURE.md)).

### 2a. Render (the live host) — Blueprint

Render is the running home. The repo ships [`render.yaml`](../render.yaml), a
Blueprint that declares the Docker web service, a **1 GB Disk mounted at
`/data`**, and `healthCheckPath: /api/health` in one reviewable file.

**Steps (as deployed):**

1. **New → Blueprint**, point at the GitHub repo `mat-arda-cards/visit-kingston`.
   Render reads `render.yaml`, builds the `Dockerfile`, and provisions the web
   service + Disk. (The repo is **public** — a Render↔GitHub sync issue was
   sidestepped by making it public; there are no secrets in git, so this is
   safe.)
2. **Env vars.** The blueprint pre-wires them:
   - `AUTH_SECRET` — `generateValue: true`; Render mints a strong random value
     once and keeps it stable across deploys. **Do not rotate casually** —
     rotating logs everyone out.
   - `WSDOT_API_KEY` — `sync: false`; entered in the dashboard. Set → ferry
     board is **LIVE**. Absent → bundled fallback schedule, labeled not-live.
   - `NEXT_PUBLIC_SITE_URL` — `sync: false`; entered in the dashboard.
     **Build-time var** — see the gotcha in [§2c](#2c-the-next_public-build-time-gotcha).
     The absolute production origin for share-card/canonical URLs, e.g.
     `https://explore-kingston.onrender.com`.
   - `DATA_DIR=/data` — hardcoded `value: /data` in the blueprint; equals the
     Disk mount path. This is what puts all mutable state on the volume.
   - `SETUP_TOKEN` — `generateValue: true`; Render mints a random value on a
     **fresh** blueprint deploy. Gates `POST /api/auth/setup` fail-closed —
     read the value from the dashboard to complete first-run bootstrap once
     (see [§4 First run](#4-first-run-in-production)); already-bootstrapped
     deploys never consult it (`hasAnyUsers()` is checked first).
   - **No `DATABASE_URL` / `BLOB_*` / `UPSTASH_*` are set** → every store uses
     the `/data` disk. Render runs in pure **filesystem mode**.
3. **First deploy** runs automatically on blueprint create. Render builds the
   image and boots `server.js`.
4. **Confirm the volume.** `GET https://explore-kingston.onrender.com/api/health`
   returns `200 {"ok":true,"dataWritable":true,"dataDir":"/data",...}`. A `503`
   means the Disk isn't mounted or `DATA_DIR` is wrong — fix before anything
   writes state.
5. **Bootstrap admin** — see [§4 First run](#4-first-run-in-production).

**Running config today:** Starter web service + 1 GB Disk in the `oregon`
region (~$7.25/mo total), auto-deploy on push **on**, admin account created and
persisted, WSDOT key set (ferry live). Render also takes **daily disk snapshots**
(7-day restore window) — one of two backup layers (see [§5](#5-backups)).

### 2b. Fly.io (alternative)

The repo ships [`fly.toml`](../fly.toml) for the same image. One-time setup:

```bash
fly apps create explore-kingston           # or: fly launch --no-deploy
fly volumes create data --size 1 --region sea   # 1 GB volume "data", Seattle
fly secrets set AUTH_SECRET="$(openssl rand -hex 32)" WSDOT_API_KEY="..." \
    SETUP_TOKEN="$(openssl rand -hex 16)"
fly deploy --build-arg NEXT_PUBLIC_SITE_URL="https://explore-kingston.fly.dev"
```

`fly.toml` already mounts `data` at `/data`, sets `DATA_DIR=/data` + `PORT=3000`
in `[env]`, keeps `min_machines_running = 1` (so the disk-backed app stays
warm), and health-checks `GET /api/health`. The critical difference from
runtime secrets: `NEXT_PUBLIC_SITE_URL` must reach the **build**, hence
`--build-arg` (or a build secret) rather than `fly secrets set` — a runtime-only
secret never reaches the client bundle.

**Any other persistent-disk host** (Railway, a plain VPS with PM2/systemd behind
Caddy/nginx) works the same way: mount a volume, set `DATA_DIR` to its path,
point the platform health check at `/api/health`. On a bare VPS keep `DATA_DIR`
**outside the repo** (e.g. `/srv/vk-data`) so a `git pull` never touches live
state, and copy `.next/static` + `public` next to `server.js` if not proxying
them.

### 2c. The `NEXT_PUBLIC_` build-time gotcha

`NEXT_PUBLIC_SITE_URL` (used by `src/app/layout.tsx` for `metadataBase` —
share-card/canonical URLs) is a `NEXT_PUBLIC_*` var: Next **inlines it into the
client JavaScript bundle at `npm run build`**, not at runtime. Setting it only
as a runtime env var (or forgetting it entirely) leaves production resolving
share cards against `http://localhost:3000`.

- **Render:** because the build runs *inside* the Docker build, a `sync:false`
  dashboard env var is present during `npm run build`, so it bakes in. Change it
  → you must **rebuild**, not just restart.
- **Fly:** pass it as a **`--build-arg`** (as above). `fly secrets` are
  runtime-only and won't reach the bundle.
- **Vercel (Phase 2):** set it in Project → Environment Variables **before** the
  build that ships it.

The other runtime-only vars (`AUTH_SECRET`, `WSDOT_API_KEY`, `SETUP_TOKEN`,
`DATA_DIR`) don't have this constraint — they're read on the server at request
time.

### 2d. Staging (E03)

A second Render web service, `explore-kingston-staging`, is declared in the
same `render.yaml` Blueprint alongside production. It builds the identical
`Dockerfile` — same image, same code — so there is nothing to keep in sync
manually beyond the env vars below.

**Deploy to staging:**

```bash
git push origin <local-branch>:staging
```

Render auto-deploys `explore-kingston-staging` from the `staging` branch,
exactly like production auto-deploys `main`. This is the target for risky
changes: push there first, smoke-test, then merge/push to `main`.

**What's different from production:**

- **Own disk** (`data-staging`, 1 GB, mounted at `/data`) — staging starts
  from an **empty** disk. It bootstraps its own admin account via its own
  `SETUP_TOKEN` (`generateValue: true`, same mechanism as production's
  first-run bootstrap in [§4](#4-first-run-in-production)).
- **`NOINDEX=1`** — makes `/robots.txt` disallow everything
  (`src/app/robots.ts`), so search engines never index the staging copy.
- **`SENTRY_ENVIRONMENT=staging`** — staging's Sentry events are tagged
  separately from production's, same DSN/project.
- **Do NOT restore a production backup onto staging.** Staging's disk is
  meant to hold synthetic/seed data only — a production backup bundle
  contains real password hashes and real visitor/LTAC survey PII.

**Cost:** ~$7.25/mo (Starter web instance) + ~$0.25/mo (1 GB disk) — approved
in the v2 budget; a human still clicks "Approve" on the Blueprint sync that
creates it (Render dashboard), per the new-spend sign-off rule.

---

## 3. Phase 2 — Vercel serverless (built, not yet used)

Vercel has no persistent filesystem: writes land on an ephemeral instance and
vanish. So the stores run against Neon (Postgres), Vercel Blob (images), and
Upstash Redis (shared rate limit) instead — all auto-detected from env presence
(see [§1](#1-the-persistence-seam-why-there-are-two-phases)). The DB migration is
complete and tested; this section is the one-time stand-up.

### Steps

1. **Import the repo** at [vercel.com/new](https://vercel.com/new). Vercel
   auto-detects Next.js; keep defaults (`next build`, no root-dir change).
   Don't deploy yet — provision stores + env first, or the first build ships
   with the filesystem fallback and no persistence.
2. **Install the three Marketplace integrations** from the project's **Storage**
   tab. Each **injects its env vars into the project automatically** — no
   hand-copying secrets:
   - **Neon** → injects **`DATABASE_URL`**. Use the **pooled** string (host
     contains `-pooler`); the `@neondatabase/serverless` HTTP driver wants it.
     Backs the `overlay` table + the three append tables.
   - **Vercel Blob** → create a **public** Blob store; injects
     **`BLOB_READ_WRITE_TOKEN`**. Public so image URLs serve straight from the
     CDN with no Function in the path.
   - **Upstash** (Redis) → injects **`UPSTASH_REDIS_REST_URL`** and
     **`UPSTASH_REDIS_REST_TOKEN`**. Backs the shared rate limiter (required on
     serverless — the in-memory limiter multiplies the effective limit by
     instance count).
3. **Set the remaining env vars** (Settings → Environment Variables, Production):
   - `AUTH_SECRET` — a **fresh** `openssl rand -hex 32`; never the dev secret,
     kept stable thereafter.
   - `WSDOT_API_KEY` — WSDOT Ferries access code (live ferry data).
   - `NEXT_PUBLIC_SITE_URL` — the Vercel production origin, **before the build**
     ([§2c](#2c-the-next_public-build-time-gotcha)).
   - `SETUP_TOKEN` — any string; gates first-run bootstrap fail-closed.
   - **Do NOT set `DATA_DIR`.** Leaving it unset is what routes the stores to
     Neon/Blob. Setting it on Vercel would point stores at an ephemeral disk.
4. **Deploy** (redeploy if you imported before adding stores, so the build picks
   up the injected env).
5. **Schema.** Nothing to run — `ensureSchema()` creates the tables on the first
   request that touches any store. To create them up front instead, run
   **`npm run db:setup`** (`psql "$DATABASE_URL" -f db/schema.sql`) against the
   Neon string, or paste [`db/schema.sql`](../db/schema.sql) into the Neon SQL
   editor.
6. **Migrate existing `.data/` (only if carrying over Render's state).** Pull the
   production env and run the migration once:
   ```bash
   vercel env pull .env.production.local     # writes DATABASE_URL + BLOB token
   node --env-file=.env.production.local scripts/migrate-to-db.mjs
   ```
   `scripts/migrate-to-db.mjs` upserts overlay rows (auth, portal overlays,
   custom hunts, submissions, map views/features), appends analytics/survey
   rows, and uploads images to Blob (rewriting each record's URL field to the
   blob URL). It **refuses to run without `DATABASE_URL`**. Idempotency:
   - overlay upserts use `ON CONFLICT DO UPDATE` — **safe to re-run**.
   - the append tables (`analytics_event`, `survey_response`) are **run-once**:
     the script skips each if it already has rows; pass `--force` to append
     anyway (which would double them).

   `npm run db:migrate` runs the same script but reads **`.env.local`** (not
   `.env.production.local`) — use the explicit `node --env-file=…` form when
   pointing at Vercel-pulled prod env. Without `BLOB_READ_WRITE_TOKEN` the
   script leaves image fields as relative paths and warns. A fresh Chamber
   deploy with no prior data skips this step entirely.
7. **Verify `/api/health`** returns `200 {ok:true,...}`, then smoke-test a write:
   create the admin at `/portal/setup` and confirm it survives a redeploy —
   proof that Neon, not an ephemeral disk, holds state.
8. **Add the domain** — [§6](#6-domain--dns).

### Cost caveat

Vercel **Hobby** is non-commercial only; a Chamber app promoting member
businesses is commercial use, so this needs **Vercel Pro (~$20/mo)** to be in
terms. Neon, Upstash, and Blob free tiers comfortably cover Kingston's scale —
watch their usage dashboards.

---

## 4. First run in production

Same bootstrap as local, now against the live volume/DB:

1. **Create the admin once** at `/portal/setup`. It works **only while there are
   zero users** — creates the first admin, then disables itself. Do it right
   after the first green `/api/health`, before anyone else can reach the box.
   The form also requires the **setup token** — read the `SETUP_TOKEN` value
   from the Render dashboard (or the Fly secret you set) and paste it in; the
   endpoint 403s without it, so a stranger who finds the URL first can't take
   the site.
2. **Mint invites** at `/admin/accounts`. Each code is tied to a role
   (`business` / `nonprofit` / `admin`) and the listing/org ids it may edit
   (`linkedIds`). Login/setup/redeem are rate-limited (`src/lib/rate-limit.ts`).
3. **Hand codes to businesses.** They redeem at `/portal/join`, then edit
   hours/listings/events/volunteer needs, which appear on public pages within
   ~60 s (ISR). Codes are delivered by hand for the first cohort (no email
   wired).

---

## 5. Backups

**Two layers, both in place:**

1. **Render daily disk snapshots** — automatic, 7-day restore window
   (Dashboard → service → Disk → Snapshots). Zero config.
2. **Off-site JSON bundle** — `GET /api/admin/backup` (admin-gated; the
   "⤓ Download backup" button on `/admin`) walks the entire `DATA_DIR` and
   returns one downloadable JSON: text files (`.json/.jsonl/.txt/.md/.csv`)
   inlined UTF-8, everything else (photos) base64. **The bundle contains
   password hashes — treat it as sensitive.** Restore it onto any host or local
   `.data/` with:
   ```bash
   node scripts/restore-backup.mjs <bundle.json> <targetDataDir>
   ```
   (guards against path traversal; reports how many files were written).

For a scheduled tarball instead of the on-demand bundle, `scripts/backup-data.sh`
tars `DATA_DIR` to a timestamped `.tar.gz` and prunes past a retention window
(default 14 days). Run it from cron / a Render Cron Job / a Fly scheduled
machine, writing **off the primary disk** (S3/B2) — a backup on the same volume
it backs up is not a backup:

```cron
15 3 * * * DATA_DIR=/data BACKUP_DIR=/data/backups /app/scripts/backup-data.sh >> /var/log/kingston-backup.log 2>&1
```

**`DATA_DIR` is the entire backup surface** in Phase 1 — everything else (code,
seed content, brand assets, generated parking overlay) rebuilds from git +
`npm install`. `.data/` is gitignored on purpose (password hashes, photos) — do
not commit it. In **Phase 2** the backup surface moves to Neon (use its
branch/PITR features) + Blob (versioned object store); the JSON-bundle route and
`backup-data.sh` are Phase-1 filesystem tools.

---

## 6. Domain & DNS

Add **one** record, nothing else. In **NameHero cPanel → Zone Editor**, a
**CNAME**:

```
app.explorekingstonwa.com   CNAME   <the host's target>
```

- **Render** custom domain → the `onrender.com` CNAME target Render shows.
- **Vercel** → `cname.vercel-dns.com` (the target Vercel shows in Settings →
  Domains).
- **Fly** → the `<app>.fly.dev` hostname, or an `A`/`AAAA` to a dedicated IP as
  Fly instructs.

**Do NOT move nameservers.** The NameHero box serves three things off one host:
the **WordPress site**, the **domain's DNS**, and **Chamber email** (MX/SPF). A
single CNAME added to the existing zone leaves all three untouched — mail rides
those nameservers, so moving them would break DNS and email. Swap the **apex**
(`explorekingstonwa.com` → an `A` record) **only at a full cutover** when the app
actually replaces WordPress — not before. The custom domain is **deferred until
launch**; the app currently lives at the raw `explore-kingston.onrender.com`.

---

## 7. Render vs Vercel — decision table

| | **Render (Phase 1, LIVE)** | **Vercel (Phase 2, ready)** |
|---|---|---|
| Persistence | 1 GB disk at `/data`, filesystem stores | Neon + Blob + Upstash |
| Env shape | `DATA_DIR=/data`, no cloud vars | cloud vars set, `DATA_DIR` unset |
| Schema/migration | none — files on disk | `ensureSchema()` / `db:setup`; migrate via `migrate-to-db.mjs` |
| Rate limit | in-process `Map` (single instance, correct) | Upstash shared window (required) |
| Cost | ~$7.25/mo (Starter + 1 GB disk) | ~$20/mo Pro + free-tier stores |
| Backups | daily disk snapshots + off-site JSON bundle | Neon PITR + Blob versioning |
| Scaling | single warm instance | serverless, multi-instance |
| Ops burden | one box, one disk, snapshots | three managed services |
| Status | **running the app today** | supported alternative / future move |

**Pick Render** while the Chamber is one admin at Kingston's scale — cheaper,
simpler, single-writer file store, and already live. **Move to Vercel** only if
scale or a serverless mandate demands it; the seam makes it a config change, not
a rewrite.

Day-2 operations (env-var reference, rotating secrets, restoring from a snapshot,
troubleshooting) live in [OPERATIONS.md](OPERATIONS.md).
