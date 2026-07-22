# Deployment guide

The authoritative deploy guide for Explore Kingston. **July 2026.**

**Status:** Phase 1 is **LIVE on Render** at <https://explore-kingston.onrender.com>
— since E05, Neon Postgres holds all structured data (`DATABASE_URL` is
required) and a private Cloudflare R2 bucket holds uploaded images (E15 —
the persistent disk was removed, so deploys are zero-downtime). Phase 2 (Vercel
serverless) is fully built but **not yet the running home** — it's the
documented alternative / future move, not a pending chore.

Companion docs: [OPERATIONS.md](OPERATIONS.md) (day-2 runbook, backups, env-var
reference, troubleshooting), [ARCHITECTURE.md](ARCHITECTURE.md) (deployment
topology, the persistence seam), [DATA_SOURCES.md](DATA_SOURCES.md) (WSDOT key,
DNS facts), [SYNDICATION.md](SYNDICATION.md) (outbound feeds / any future email).

---

## 1. The persistence seam (why there are two phases)

The app writes all of its mutable state — accounts, portal edits, hunts +
photos, analytics, survey responses, ferry observations, CMS copy/visibility,
map views/features — outside the code tree. Since E05, **structured data has
exactly one home: Neon Postgres** (`record` + append tables; every write goes
through the audited zod choke point `src/lib/db/records.ts`), and
`DATABASE_URL` is required on every deploy — `/api/health` reports
`db:false` and 503s without it. Since E15 removed the persistent disk, an
unhealthy release is **held back** and the previous release keeps serving.
Only images and rate limiting still pick a backend by env presence; nothing
above the store modules (routes, components, domain types) ever branches:

| Seam file | Detector | Backend when set | Fallback when unset |
|---|---|---|---|
| `src/lib/data-dir.ts` | `DATA_DIR` present | **unset in production since E15** — no disk; images live in R2. Local dev only | `<repo>/.data/` |
| `src/lib/blob-store.ts` | `hasR2()` = all four `R2_IMAGES_*` set | **Cloudflare R2** — a PRIVATE bucket; the app proxies reads through its own image routes (never `r2.dev`, no R2 custom domain) | falls back to `hasBlob()` = `BLOB_READ_WRITE_TOKEN` (legacy Vercel Blob), then to image bytes under `DATA_DIR` |
| `src/lib/rate-limit.ts` | `UPSTASH_REDIS_REST_URL` set | **Upstash Redis** shared sliding window | in-process `Map` (single-instance only) |

Two consequences:

- **Phase 1** sets `DATABASE_URL` **and `R2_IMAGES_*`**, and since E15 leaves
  `DATA_DIR` unset → Neon holds structured data, the private R2 bucket holds
  images, and there is no disk. This is the current live shape on Render.
- **Phase 2** additionally sets Blob/Upstash → images go to Blob and rate
  limiting to Redis; the DB is the same Neon either way. This is the Vercel
  shape.

`npm run dev` needs a `DATABASE_URL` too (a throwaway local Postgres container
or a personal Neon dev branch — see [OPERATIONS.md §1](OPERATIONS.md)); images
land under `.data/` — the same code path Phase 1 uses in production, just at a
different `DATA_DIR`.

### Where each kind of data lives (since E05)

| Data | Home (every deploy) | Phase-2 delta |
|---|---|---|
| auth users, orgs + invites | dedicated `users` / `orgs` / `invites` tables (E06 — no longer `record` rows under `store='auth-users'`) | — |
| portal overlays (restaurants, events, charities, needs, lodging, webcams, parking zones, itineraries, ferry-info, boarding-pass, ferry-prediction, site copy/pages, map views/features) | `record` rows keyed `(store, id)`, `deleted` column carries `_deleted` tombstones | — |
| custom hunts + submissions | `record` (`custom-hunts`, `hunt-submissions`) | — |
| hunt reference/player photos, map-feature images, event attachments | **private Cloudflare R2** since E15 (`R2_IMAGES_*`); the app proxies reads | **Vercel Blob** (public URL stored on the record) |
| analytics events | `analytics_event` append table | — |
| LTAC survey responses | `survey_response` append table | — |
| ferry observations (busyness forecast learning log) | `ferry_observation` append table | — |
| auth login/setup/redeem rate limiting | in-process `Map` (single instance) | **Upstash Redis** shared counter |

The schema's source of truth is `src/lib/db/schema.ts` (Drizzle, E05): DDL is
generated into checked-in migrations under `db/migrations/` (`npm run
db:generate`) and applied at server boot by `src/instrumentation.ts` (or
manually via `npm run db:migrate`). The legacy `ensureSchema()` / `overlay`
path in `src/lib/db.ts` is retired by E05's store-layer cutover — migrations
are the only schema mechanism.

---

## 2. Phase 1 — single container, no disk (the CURRENT live shape)

Ship the code exactly as it is onto a host with a real disk. Two repo pieces
make this turnkey:

- **`next.config.ts`** sets `output: "standalone"` — a self-contained server
  bundle (`.next/standalone/server.js`) that runs without `node_modules`.
- **`Dockerfile`** (multi-stage `node:22-alpine`: `deps → build → runner`)
  produces the lean runtime image. The runner copies `.next/standalone`, then
  `.next/static` and `public/` (standalone omits both), runs as non-root user
  `nextjs`, and its `HEALTHCHECK` hits `/api/health`. Since E15 it sets **no**
  `DATA_DIR` and declares **no** `VOLUME` — there is no disk.
- **`GET /api/health`** (`src/app/api/health/route.ts`) pings Postgres and
  nothing else — **no filesystem access at all** since E15, which is what let
  the disk be removed. Returns `200 {ok:true, db:true, storage, time}`, `503`
  otherwise. `storage` (`"r2"`/`"fs"`/`"unconfigured"`) is reported but never
  gates. This catches the failure (a boot without a reachable `DATABASE_URL`)
  that must be caught before
  real users hit the box. Wire it as the host's health check.

The single-instance shape is fine for a one-admin Chamber — Phase 1 is a
real production deployment, not demo grade (see [ARCHITECTURE.md](ARCHITECTURE.md)).

### 2a. Render (the live host) — Blueprint

Render is the running home. The repo ships [`render.yaml`](../render.yaml), a
Blueprint that declares the Docker web service and
`healthCheckPath: /api/health` in one reviewable file. **No disk since E15** —
that is what makes deploys zero-downtime.

**Steps (as deployed):**

1. **New → Blueprint**, point at the GitHub repo `matthager12-collab/ExploreKingstonChamberApp`.
   Render reads `render.yaml`, builds the `Dockerfile`, and provisions the web
   service. (The repo is **public** — a Render↔GitHub sync issue was
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
   - `R2_IMAGES_ENDPOINT` / `R2_IMAGES_BUCKET` / `R2_IMAGES_ACCESS_KEY_ID` /
     `R2_IMAGES_SECRET_ACCESS_KEY` — `sync: false` (E15); the private R2 bucket
     for uploaded images. All four or none: `hasR2()` treats partial config as
     unconfigured. There is no `DATA_DIR` — the disk was removed.
   - `SETUP_TOKEN` — `generateValue: true`; Render mints a random value on a
     **fresh** blueprint deploy. Gates `POST /api/auth/setup` fail-closed —
     read the value from the dashboard to complete first-run bootstrap once
     (see [§4 First run](#4-first-run-in-production)); already-bootstrapped
     deploys never consult it (`hasAnyUsers()` is checked first).
   - `DATABASE_URL` — `sync: false` (E05); the Neon **pooled** connection
     string, entered in the dashboard, never in `render.yaml`. Must end
     `?sslmode=verify-full` — see [§2e](#2e-tls-mode-sslmodeverify-full);
     Neon's copy button gives you `sslmode=require`, which is the wrong thing
     to paste. **Required**: a
     release booted without it fails `/api/health` (`db:false`) and Render
     503s. **Since E15 removed the disk this now DOES keep the previous
     release serving** — with no volume to hand over the instances overlap, so
     an unhealthy release is held back instead of taking the site down. (While
     a disk was attached the opposite was true, verified on staging
     2026-07-19.) Validate the URL from your laptop first — `psql` is **not**
     installed on the operator Mac, so use the repo's own `pg` driver, run from
     the repo root with the exact string you are about to paste on the
     clipboard:

     ```bash
     node -e 'const {Client}=require("pg");
     const u=require("child_process").execSync("pbpaste").toString().trim();
     if(u.length===0){console.log("❌ clipboard is EMPTY");process.exit(1)}
     new Client({connectionString:u}).connect().then(async function(){
       const r=await this.query("select current_database() db, (select count(*) from record) records");
       console.log("✅",r.rows[0]); await this.end();
     }).catch(e=>console.log("❌ FAILS:",e.message));' 2>&1 | grep -v Warning
     ```

     A truncated paste, a stale password, or the wrong Neon branch all surface
     here, while the site is still up. The fuller three-line pre-flight (plus
     the `psql` variant, if you happen to have it) is in
     [RUNBOOK-CUTOVER.md](RUNBOOK-CUTOVER.md) under "PRE-FLIGHT".
   - `WORKLIST_SWEEP_TOKEN` — `sync: false` (E08); Bearer token that lets a
     scheduler call `POST /api/admin/worklist/sweep` (the staleness sweep)
     without an admin session. Optional and **fail-closed**: unset disables
     only the token path, never opens the route. Set it when registering the
     sweep cron (docs/OPERATIONS.md §5 "Worklist & moderation").
   - `RETENTION_TOKEN` — `sync: false` (E11); Bearer token for
     `POST /api/admin/privacy/retention` (the retention purge). Same
     fail-closed semantics. Set it on **both** services (the staging
     rehearsal needs the staging one) + a GitHub repo secret of the same
     name + 1Password. The workflow
     (`.github/workflows/privacy-retention.yml`) is **workflow_dispatch-only
     until the E11 §4-e go** — do not add its `schedule:` block early.
   - **`BLOB_*` / `UPSTASH_*` stay unset on Render** — images live on the
     `/data` disk and the single instance uses the in-process rate limiter.
3. **First deploy** runs automatically on blueprint create. Render builds the
   image and boots `server.js`.
4. **Confirm the DB.** `GET https://explore-kingston.onrender.com/api/health`
   returns `200 {"ok":true,"db":true,"storage":"r2",...}`. A `503` means
   Postgres is unreachable / `DATABASE_URL` missing; a `500` means it is set
   but unreachable (the boot migrator fails first) — fix before anything
   writes state. `storage` should read `"r2"` in production.
5. **Bootstrap admin** — see [§4 First run](#4-first-run-in-production).

**Running config today:** Starter web service in the `oregon` region, **no
disk** since E15 (~$7/mo), auto-deploy on push **on**, admin account created
and persisted, WSDOT key set (ferry live). Note the disk removal also retired
Render's daily disk snapshots as a backup layer — that cost nothing, because
the disk held no durable data by then; Neon PITR and the encrypted off-site
bundle are the live layers (see [§5](#5-backups)).

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

**Cost:** ~$7/mo (Starter web instance; the 1 GB disk was removed in E15) — approved
in the v2 budget; a human still clicks "Approve" on the Blueprint sync that
creates it (Render dashboard), per the new-spend sign-off rule.

---

### 2e. TLS mode (`sslmode=verify-full`)

Every `DATABASE_URL` — production, staging, and any local pointed at Neon —
ends `?sslmode=verify-full`. Neon's dashboard copy button hands you
`sslmode=require` instead; that string is **not** safe to paste forward.

The reason is a rename, not a behaviour change. node-postgres has always been
stricter than libpq: `require`, `prefer`, and `verify-ca` were all treated as
aliases for `verify-full`, so the CA chain *and* the hostname were verified.
libpq's `require` means only "encrypt" — it authenticates nothing. pg v9 /
pg-connection-string v3 drop the divergence and adopt the libpq meaning, at
which point a URL still saying `require` silently becomes MITM-able. Until
then, pg 8.22 nags about it on every boot (the `| grep -v Warning` in the
pre-flight snippet above exists to mute exactly that line).

The two ways out are not equivalent, and the parser makes the difference
visible — `require('pg-connection-string').parse(url).ssl` returns:

| URL | parsed `ssl` | meaning |
| --- | --- | --- |
| `sslmode=require` (today) | `{}` | Node TLS defaults → CA + hostname verified |
| `sslmode=verify-full` | `{}` | **identical to today**, and stable across pg v9 |
| `uselibpqcompat=true&sslmode=require` | `{"rejectUnauthorized":false}` | encrypted, **unauthenticated** |

So `verify-full` is a pure rename of what already happens; the `uselibpqcompat`
form is a real downgrade and is not used here. Neon's certificate chains to a
root Node already ships, so no `sslrootcert` is required — verified against
both endpoints on 2026-07-21.

One inert leftover: the URLs also carry `channel_binding=require`, copied from
Neon. That is a libpq parameter; node-postgres reads `enableChannelBinding`
from *client config* and nothing maps the URL param onto it, so it has no
effect. Harmless, but do not read it as an assurance that channel binding is on.

Dropping `sslmode` entirely is not an option — Neon refuses the connection
outright (`28000 connection is insecure`), which is a useful sanity check that
TLS is genuinely being negotiated.

---

## 3. Phase 2 — Vercel serverless (built, not yet used)

Vercel has no persistent filesystem: writes land on an ephemeral instance and
vanish. Structured data already lives in Neon on every deploy (E05); the
Vercel deltas are Vercel Blob (images) and Upstash Redis (shared rate limit),
auto-detected from env presence
(see [§1](#1-the-persistence-seam-why-there-are-two-phases)), with `DATA_DIR`
left unset. This section is the one-time stand-up.

### Steps

1. **Import the repo** at [vercel.com/new](https://vercel.com/new). Vercel
   auto-detects Next.js; keep defaults (`next build`, no root-dir change).
   Don't deploy yet — provision stores + env first: without `DATABASE_URL` the
   first deploy fails its health check (`dbOk:false`, by design — E05), and
   without the Blob token image uploads land on an ephemeral disk.
2. **Install the three Marketplace integrations** from the project's **Storage**
   tab. Each **injects its env vars into the project automatically** — no
   hand-copying secrets:
   - **Neon** → injects **`DATABASE_URL`**. Use the **pooled** string (host
     contains `-pooler`); the `@neondatabase/serverless` HTTP driver wants it.
     Backs the `record`/`audit`/`quarantine` tables + the three append tables
     — the app's entire structured-data home (E05). The integration injects
     `sslmode=require`; edit it to `sslmode=verify-full` after install, same as
     Render ([§2e](#2e-tls-mode-sslmodeverify-full)).
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
5. **Schema.** The E05 substrate tables come from the checked-in Drizzle
   migrations: they apply automatically at server boot
   (`src/instrumentation.ts`), or up front with **`npm run db:migrate`**
   (drizzle-kit; reads `DATABASE_URL` from the environment). The legacy
   self-creating `overlay` path is gone — migrations are the only schema
   mechanism.
6. **Import existing file-era data (only if carrying over pre-E05 state).**
   Point the E05 importer at a `DATA_DIR`-shaped tree — a live `.data/` copy,
   or a backup bundle unpacked with `scripts/restore-backup.mjs` — with the
   production `DATABASE_URL` in the environment:
   ```bash
   vercel env pull .env.production.local          # writes DATABASE_URL
   set -a; source .env.production.local; set +a
   npm run import:data-dir -- --data-dir ./restored-data           # dry run (default)
   npm run import:data-dir -- --data-dir ./restored-data --apply   # write for real
   ```
   The importer reads the tree **read-only**, validates every record against
   the store schemas, and writes through the app's own choke point (each write
   audited as `import`). It **refuses to run without `DATABASE_URL`**.
   Semantics:
   - **Dry-run by default** — prints a per-store diff
     (new/changed/unchanged/tombstones/quarantined) with no writes. `--apply`
     asks you to type the target DB host before writing; `--yes` skips the
     prompt for scripted runs.
   - **Quarantine, not silent drops** — records failing validation land in the
     `quarantine` table + the printed QUARANTINE report, never in `record`;
     corrupt JSONL lines are reported per-line. Exit codes: 0 clean · 1 halt
     (unparseable file / aborted) · 2 quarantines exist — cut over only on 0,
     or after reviewing every quarantined row.
   - **Idempotent for records** — unchanged rows are skipped; re-running is
     safe. The append tables (`analytics_event`, `survey_response`,
     `ferry_observation`) are **run-once**: skipped if the target already has
     rows; `--force-append` overrides (which would double them).
   - **Images are not moved** — the importer does no Blob uploads or path
     rewriting; hunt photos and map images need a separate copy step onto Blob
     when leaving a disk host.

   (`npm run db:migrate` is drizzle-kit's **schema** migrator — step 5 — not
   this data move.) A fresh Chamber deploy with no prior data skips this step
   entirely.
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
2. **Mint invites** at `/admin/accounts`. Each code is tied to one of the five
   roles (`admin` / `moderator` / `org-editor` / `member-business` / `viewer` —
   defined once in `src/lib/auth/roles.ts`); the two org roles are tied to an
   org, whose `linked_ids` scope which listings it may edit. (E06 moved
   `linked_ids` off the user and onto the org.) Login/setup/redeem are
   rate-limited (`src/lib/rate-limit.ts`).
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

**Since E05 the backup surface is split: Neon holds structured data** (use its
PITR/branching) **and `DATA_DIR` holds images/hunt photos** — everything else
(code, seed content, brand assets, generated parking overlay) rebuilds from
git + `npm install`. The JSON-bundle route and `backup-data.sh` still walk the
whole `DATA_DIR`. `.data/` is gitignored on purpose (photos; pre-E05 disks
also carry password hashes) — do not commit it. In **Phase 2** the image half
moves to Blob (versioned object store).

---

## 6. Domain & DNS

**This section is the authoritative custom-domain procedure.** Measured
2026-07-22; earlier notes elsewhere that say "at NameHero" name the IP's owner,
not the control panel.

### Who controls what (get this right or the change silently does nothing)

| Layer | Reality |
|---|---|
| **Registrar** | **NameCheap** — renewals and the nameserver setting. **Records are NOT edited here.** |
| **Registry delegation (parent)** | `ns1/ns2.enticemedia.com` — what NameCheap's panel displays |
| **In-zone NS (child)** | `ns1/ns2.vps42664.nodevm.com` — the cPanel default from the VPS hostname |
| **All four resolve to** | `165.140.69.20` — one box, one zone file |
| **That IP belongs to** | Name Hero, LLC (infrastructure vendor) |
| **Administered by** | Most likely **Entice Media** — the delegation uses their vanity nameservers and their own site is on the same box |
| **Panel** | cPanel (`:2083`) and WHM (`:2087`) both confirmed live |

Because the domain uses **custom nameservers**, NameCheap's "Advanced DNS" tab
is **inert**: a record typed there saves, looks correct, and is never published,
because nothing on the internet asks NameCheap for this zone.

> ⚠️ **Parent/child nameserver mismatch — expected and correct.** NameCheap
> shows `enticemedia.com`; `dig NS` shows `vps42664.nodevm.com`. Both point at
> the same box. **Do not "fix" it.** The nameserver control is the most
> prominent thing on that NameCheap screen, and changing it takes the WordPress
> site and Chamber email down together.

### The record

Add **one** record in **cPanel → Zone Editor** for `explorekingstonwa.com`
(or WHM → DNS Functions → DNS Zone Manager):

```
app.explorekingstonwa.com.   14400   IN   CNAME   explore-kingston.onrender.com.
```

| Field | Value |
|---|---|
| Type | **CNAME** |
| Name / Host | `app` — just `app`; cPanel appends the origin |
| TTL | default (14400) |
| Record / Target | `explore-kingston.onrender.com.` — **with the trailing dot** |

Then add the custom domain in the **Render dashboard** (Settings → Custom
Domains) and click Verify. Render issues TLS automatically.

### Ways this silently fails

- **Adding it at NameCheap.** Looks saved; `app.` stays NXDOMAIN forever.
- **Switching to NameCheap BasicDNS** to un-grey that tab — catastrophic: the
  apex A, `www`, MX and SPF all vanish. Site dark, email dead.
- **cPanel → Domains / Subdomains instead of Zone Editor.** Writes an **A**
  record for `app`. The worst failure mode: the name *does* resolve, to a parked
  page, so it reads as success — but a CNAME cannot coexist with an A record at
  the same name, so TLS never issues. Delete the A record first.
- **Typing the full `app.explorekingstonwa.com` in the Name field** — cPanel
  appends the origin, giving `app.explorekingstonwa.com.explorekingstonwa.com`.
- **Omitting the trailing dot on the target** — same double-suffix result.
  Highest risk in WHM's raw editor, which does not normalise.
- **A URL redirect / web forwarding record, or an A record, or ALIAS.** Render's
  edge is Cloudflare-fronted with **rotating** IPs, and a redirect fails the
  ACME challenge, so the certificate never issues.
- **Adding a CAA or AAAA record.** There are none today — that is *why*
  Let's Encrypt works, and Render is IPv4-only.

### Do not touch

The VPS at `165.140.69.20` serves three things off one host: the **WordPress
site**, the **domain's DNS**, and **Chamber email**. Leave alone: the
nameservers, `MX 0 explorekingstonwa.com`, the SPF TXT
(`v=spf1 +a +mx +ip4:165.140.69.20 ~all`), the apex `A`, and the `www` CNAME.
Adding a new subdomain record is purely additive.

Swap the **apex** to the app **only at a full WordPress cutover** — nobody's
current plan.

### Verify (and capture as the attestation)

```bash
# immediate truth, skips negative caching:
dig @ns1.vps42664.nodevm.com app.explorekingstonwa.com CNAME +short
dig +short CNAME app.explorekingstonwa.com @8.8.8.8   # once caches expire
# these four must be IDENTICAL before and after — a zero diff is the proof
dig +short NS explorekingstonwa.com
dig +short MX explorekingstonwa.com
dig +short A  explorekingstonwa.com
dig +short CNAME www.explorekingstonwa.com
curl -sI https://app.explorekingstonwa.com/api/health   # 200 + valid cert
```

**After DNS resolves, the cutover is not done:** set
`NEXT_PUBLIC_SITE_URL=https://app.explorekingstonwa.com` and **redeploy**. It is
build-time inlined, so a dashboard-only change does nothing and canonical/OG
URLs keep pointing at `onrender.com`.

*Other hosts, reference only — Render is the live deployment:* Vercel would use
`cname.vercel-dns.com`; Fly the `<app>.fly.dev` hostname. **Do not use these.**

---

## 7. Render vs Vercel — decision table

| | **Render (Phase 1, LIVE)** | **Vercel (Phase 2, ready)** |
|---|---|---|
| Persistence | Neon Postgres (structured data, E05) + private R2 bucket for images (E15, no disk) | Neon + Blob + Upstash |
| Env shape | `DATA_DIR=/data` + `DATABASE_URL`, no Blob/Upstash vars | all cloud vars set, `DATA_DIR` unset |
| Schema/migration | Drizzle migrations (`db/migrations/`, applied at boot — E05) | same migrations; image move to Blob |
| Rate limit | in-process `Map` (single instance, correct) | Upstash shared window (required) |
| Cost | ~$7/mo (Starter, no disk) + Neon free tier + R2 ~$0–1 | ~$20/mo Pro + free-tier stores |
| Backups | Neon PITR + daily disk snapshots + off-site JSON bundle | Neon PITR + Blob versioning |
| Scaling | single warm instance | serverless, multi-instance |
| Ops burden | one box, one disk, snapshots | three managed services |
| Status | **running the app today** | supported alternative / future move |

**Pick Render** while the Chamber is one admin at Kingston's scale — cheaper,
simpler, one warm instance, and already live. **Move to Vercel** only if
scale or a serverless mandate demands it; the seam makes it a config change, not
a rewrite.

Day-2 operations (env-var reference, rotating secrets, restoring from a snapshot,
troubleshooting) live in [OPERATIONS.md](OPERATIONS.md).
