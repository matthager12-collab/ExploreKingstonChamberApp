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
   survey row lives in Neon Postgres (accounts in the dedicated
   `users`/`orgs`/`invites` tables since E06, everything else in `record` +
   the append tables; writes go through the audited choke point
   `src/lib/db/records.ts`). The `DATA_DIR` directory
   (resolved by `src/lib/data-dir.ts`) holds hunt photos and map
   images (until E15). Code, seed content, brand assets, and the generated
   parking overlay are all reproducible from git + `npm install`. Back up
   **both** Neon (PITR/branching) and `DATA_DIR`.
2. **`DATABASE_URL` is required on every deploy** — `/api/health` reports
   `db:false` and 503s without it. **Since E15 removed the persistent disk that
   gate finally holds a bad release back** instead of taking the site down:
   with no volume to hand over, the old instance keeps serving until the new
   one reports healthy. (While a disk was attached, only one instance could
   mount it, so the old container had to stop first and a broken release meant
   a full outage — observed on staging 2026-07-19.)
   Always validate the URL before setting it — see the pre-flight in
   [RUNBOOK-CUTOVER.md](RUNBOOK-CUTOVER.md), which has a node path because
   `psql` is not installed on the operator's Mac.
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
| `WORKLIST_SWEEP_TOKEN` | No — only for the E08 staleness-sweep cron; the sweep also runs from any admin session, and unset simply disables the token path (fail-closed, never open) | `openssl rand -hex 32`, set on Render (both services) and in whatever scheduler calls `POST /api/admin/worklist/sweep` with `Authorization: Bearer …` — see §5 "Worklist & moderation". |
| `EVENTS_INGEST_TOKEN` | No — only for the E12 hourly events-ingest cron (`render.yaml` `events-ingest`); ingest also runs from any admin session ("Sync now" on `/admin/events-sources`). Fail-closed like the sweep token: production token callers get 503 while it's unset; `next dev` is open without it. | `openssl rand -hex 32`, set on Render (web service + the `events-ingest` cron; same value) — see §5 "Unified events calendar & ingest". |
| `AMS_CALENDAR_FEED_URL` | No — optional staff-generated GrowthZone whole-calendar iCal URL (§9 item 6b). While unset the ingest scrapes per-event `.ics` files instead. Transitional: the whole GrowthZone source ends ~April 2027 (docs/adr/ADR-0005-events-canonical-source.md). | Chamber staff mint it in the GrowthZone back office (Events → Calendars settings → "Calendar Feed"); paste into Render (both services) or the `calendar-sources` record. |

**Remaining Phase-2 (Vercel) vars** — `BLOB_READ_WRITE_TOKEN`,
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — are **not** set locally or
on Render; they belong only to a Vercel deployment (§7, `.env.production.example`).

### First run — bootstrap the admin and mint invites

1. `npm run dev`, open <http://localhost:3000>.
2. **Bootstrap the first admin:** set `SETUP_TOKEN` in `.env.local` (any string;
   the endpoint 403s fail-closed without it), then visit `/portal/setup` and
   enter that same value in the "Setup token" field. It works **only while
   zero users exist** (the `users` table) — it creates the first admin
   account (role `admin`, no org scoping), signs you in, then locks itself
   forever (`/api/auth/setup` returns 403 once any user exists; the endpoint is
   also rate-limited to 5 attempts). **E06 removed the old "/admin is open with
   an amber banner until the first admin exists" grace** — `/admin` now always
   redirects to `/portal`, and `/portal` redirects to `/portal/setup` while
   zero users exist, so bootstrap still works without ever exposing `/admin`
   (`src/app/(site)/admin/layout.tsx`, `src/proxy.ts`).
3. **Mint invites:** as admin go to `/admin/accounts`. Since E06 an invite is
   tied to one of **five** roles (`admin` / `moderator` / `org-editor` /
   `member-business` / `viewer`), carries a **14-day expiry**, and may be bound
   to a specific email — binding is **required** for an `admin` invite, so a
   forwarded code can never be a bearer admin grant. Org roles attach to an
   organization (join an existing one or create it on redemption); the listing
   ids an account may edit live on that org as `linked_ids`, not on the user.
   Hand the code over; they redeem it at `/portal/join`, and you can revoke an
   un-redeemed code from the same page. (`/api/auth/login`, `/setup`, `/redeem`
   are rate-limited.)
4. Portal edits (hours, listings, events, volunteer needs) land in the
   `record` table and appear on public pages within ~60 s (ISR).

---

## 2. State layout — Postgres, plus images under `DATA_DIR`

**Since E05 the JSON/JSONL files below are NOT the live data** — every
structured store shown as a `.json`/`.jsonl` entry lives in Postgres
(`record` rows keyed `(store, id)`; `analytics_event` / `survey_response` /
`ferry_observation` append tables). What's still live on disk: `map/images/`,
`hunts/refs/`, `hunts/photos/`, `events/` (until the E15 disk cutover). The
tree is kept as the map of the on-disk layout — pre-E05 disks still carry the
legacy files, and the store names below are the `record.store` keys.

### Uploaded images — Cloudflare R2 (E15)

Uploaded image bytes now go to a **private** Cloudflare R2 bucket
(`explore-kingston-images`) when all four `R2_IMAGES_*` env vars are set;
otherwise writers fall back to the legacy Vercel Blob path, then to the disk.
Reads still prefer the disk while it exists and fall back to R2, so during the
migration window the disk stays authoritative and R2 is proven as the fallback
before it becomes the only copy.

**The bucket is private and the app proxies every read** through
`/api/hunts/photo`, `/api/map/image` and `/api/events/attachment`. Nothing is
served from `r2.dev`, and there is no R2 custom domain — that would require
moving the DNS zone to Cloudflare, which is rejected (Chamber DNS and *email*
and email are served from the same VPS as its WordPress site). Proxying is
also a privacy upgrade: hunt player submissions
used to be stored as public URLs that bypassed the admin gate entirely, and are
now genuinely admin-only on every read.

**R2 keys mirror the disk layout exactly**, which is what makes the migration a
pure byte copy with zero record rewrites:

| On disk under `DATA_DIR` | R2 object key | Stored on the record |
|---|---|---|
| `hunts/refs/<hunt>-<stop>.<ext>` | `hunts/refs/<hunt>-<stop>.<ext>` | `refs/<hunt>-<stop>.<ext>` |
| `hunts/photos/<hunt>/<stop>/<f>` | `hunts/photos/<hunt>/<stop>/<f>` | `photos/<hunt>/<stop>/<f>` |
| `map/images/<sha1>.<ext>` | `map/images/<sha1>.<ext>` | `<sha1>.<ext>` |
| `events/<eventId>/<file>` | `events/<eventId>/<file>` | `<eventId>/<file>` |

`R2_IMAGES_*` is deliberately a different prefix from the `R2_*` GitHub Actions
secrets used by the off-site backup job: those point at the separate encrypted
**backup** bucket. Do not cross-wire them — the two buckets have opposite
lifecycles (backups are write-once and retained; images are read-hot).

### Migrating the disk's images into R2 (E15 slice 2)

**Run this INSIDE the running Render container, over `render ssh`. Nowhere else.**

`DATA_DIR` is a disk mounted only in the live web-service instance, so a local
checkout cannot see it and a Render one-off job gets a fresh instance *without*
it. The dangerous variant is running `--verify` against a **restored backup
copy** of the disk: a stale copy passes a naive count check while silently
missing every image uploaded after the backup was taken — immediately before an
irreversible deletion. If `render ssh` is unavailable, STOP and ask; do not
substitute a backup-based check.

Rehearse the identical sequence on **staging** first (staging points at a
scratch bucket), then production.

```bash
render ssh explore-kingston          # or the dashboard SSH panel
cd /app
env | grep R2_IMAGES_                # all four present?
ls /data                             # the live mount, not an empty dir

node scripts/migrate-images-to-r2.mjs --dry-run   # manifest + per-subtree counts
node scripts/migrate-images-to-r2.mjs             # copy
node scripts/migrate-images-to-r2.mjs             # AGAIN — must report uploaded=0
node scripts/migrate-images-to-r2.mjs --verify    # must exit 0
```

Uploads can land mid-migration, so agree a short upload-freeze window with the
operator (or pick low-traffic hours). The second pass reporting `uploaded=0` is
what proves nothing arrived during the first. **Capture the whole SSH session's
output** — it is the evidence for acceptance criterion 5 and for the
pre-deletion gate.

What `--verify` actually checks, and what each failure means:

| Output | Meaning |
|---|---|
| `MISSING in R2` | A file on disk never uploaded — re-run the migration |
| `SIZE MISMATCH` | Partial or clobbered upload — re-run |
| `CHECKSUM MISMATCH` | Same size, different bytes (R2 returns the MD5 as the ETag for single-part PUTs, so this is a real content check, not a count) |
| `note: N object(s) in R2 with no file on disk` | Not fatal — launch-forward uploads go to R2 only. But if N is large, check you are pointed at the right bucket |
| `Record-value check` | Warns if any record already holds a Vercel Blob URL: those images are NOT on this disk, so copying bytes will not move them |

`--verify` exits non-zero on any of the first three. **It must exit 0 before the
disk is deleted** — that gate is the whole point of the script.

Verified end-to-end before first use: the script was run inside the real
production Docker image against a mounted disk and a live R2 bucket (scratch
prefix, since deleted) — 5 files copied, second pass `uploaded=0`, `--verify`
exit 0 with 5/5 checksums matched. All three failure modes above were induced
deliberately and each exited 1.

### EXIF/GPS stripping on upload (M-16-02)

Every uploaded image has **all** EXIF/XMP/IPTC metadata removed before it
reaches any storage backend. This is a child-safety floor, not a nicety: a
phone photo carries the coordinates of where it was taken, hunt players are
often kids, and approved event flyers are public.

Stripping happens in `src/lib/image-sanitize.ts`, called at the four save choke
points (`saveReferencePhoto`, `saveSubmission`, `saveFeatureImage`,
`saveAttachment`), so every backend and every future caller inherits it.
JPEG, PNG, WebP, GIF and HEIC are handled. **It is fail-closed:** an image whose
container cannot be parsed is REJECTED with a 4xx rather than stored
unverified. If an operator reports "my image won't upload", that is this — ask
them to re-save or export it.

Two documented gaps, both deliberate:
- **PDF** event attachments pass through untouched. PDFs carry document
  metadata (author, producer) but are authored artwork rather than camera
  output, so they are not a GPS vector.
- **Images stored before the E15 cutover** were not re-processed: the migration
  copies bytes verbatim so the parity check can compare by byte equality. A
  one-off sweep of pre-existing images is a backlog item.

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
| All accounts + invites | `DELETE FROM invites; DELETE FROM users; DELETE FROM orgs;` against your **local dev database** — since E06 accounts live in those tables, not in `record` or `auth/*.json` (those files are pre-E05 only) | `/portal/setup` bootstrap becomes available again |
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
| Persistence | **Neon Postgres** for all structured data (E05 — `DATABASE_URL` is `sync: false` in `render.yaml`, set in the dashboard) + **private Cloudflare R2** for uploaded images (E15 — `R2_IMAGES_*`). **No persistent disk since E15 slice 3**: nothing durable is written to the container filesystem, which is what makes deploys zero-downtime |
| Health gate | `healthCheckPath: /api/health` — Render routes traffic only after 200. `/api/health` returns `{ ok, db, storage, time }`, **200 only when Postgres answers, 503 otherwise** (E15: gates on the DB alone). It does NOT touch the filesystem — the earlier `/data` write-probe was removed so the disk can be dropped without bricking the health check. `storage` (`"r2"` \| `"fs"` \| `"unconfigured"`) reports where images are configured to live but **never gates** — an R2 outage must 404 an image, not 503 the site. This catches a release booted without a reachable `DATABASE_URL` before users do |
| SEO | `/robots.txt` and `/sitemap.xml` are runtime routes (`force-dynamic`), so hiding a page in Admin → Site content removes it from the sitemap on the next fetch. **Staging sets `NOINDEX=1`**, which disallows everything and omits the sitemap line. `NEXT_PUBLIC_SITE_URL` is the single origin for `metadataBase`, the sitemap and the robots sitemap directive (`src/lib/site-url.ts`) — it is **build-time inlined**, so changing it needs a redeploy, not a restart |
| Secrets | `AUTH_SECRET` and `SETUP_TOKEN` = `generateValue: true` (Render mints them once; **do not rotate `AUTH_SECRET` casually**); `WSDOT_API_KEY` and `NEXT_PUBLIC_SITE_URL` are `sync: false`, entered in the dashboard. `NEXT_PUBLIC_*` is inlined at **build** time — Render bakes it during the Docker build |
| Deploys | **Auto-deploy on push** to the tracked branch. The repo was made **public** to bypass a Render↔GitHub sync issue (no secrets live in git — `.env*`, `.data/` are gitignored; `.env.production.example` is documentation only) |
| Cost | **≈ $7 / mo** (Starter web instance; the 1 GB disk was removed in E15) + R2 at ~$0–1/mo |
| State today | Admin account created and persisted; `WSDOT_API_KEY` set → ferry board is **LIVE**; disk snapshots on |

**`fly.toml` is a maintained alternative** (Fly, Seattle region, volume `data`
at `/data`, same `/api/health` check) but Render is the running home. Other
persistent-disk hosts (Railway, a VPS) work identically — the only requirement
is a writable disk at `DATA_DIR`.

**Custom domain** `app.explorekingstonwa.com` — a single **CNAME** →
`explore-kingston.onrender.com`, added in the **cPanel Zone Editor on the
Chamber's WordPress VPS**. The registrar (NameCheap) is **not** where records
are edited; a record added there is never published. **Do not move
nameservers** — that would break Chamber email. Deferred until launch; the
`onrender.com` URL is the live address until then. See
[DEPLOY.md §6](DEPLOY.md#6-domain--dns).

### Redeploy / rollback

- **Redeploy:** merge to `main` → Render rebuilds the Docker image and starts
  the new container. **Since E15 removed the disk the swap is hot**: with no
  volume that only one instance can hold, the old container keeps serving until
  the new one passes its health check, so deploys are zero-downtime and a
  release that never goes healthy is held back rather than taking the site
  down. There is still no human step — every merge to `main` auto-deploys
  production. See [RUNBOOK-CUTOVER.md](RUNBOOK-CUTOVER.md) "Migrations under
  auto-deploy"; migrations remain the reason to look before merging.
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

### Disk deletion record (E15 slice 3, criterion 8)

| Field | Value |
|---|---|
| Production disk | `data` — `dsk-d941o1cvikkc73bbfr30`, 1 GB, mounted `/data` |
| Staging disk | `data-staging` — `dsk-d98herdaeets73fvpmcg`, 1 GB, mounted `/data` |
| Status | **DONE** |
| Deleted | **2026-07-21**, by **Mat** (Render dashboard → service → Disk → Delete Disk), BOTH production and staging |
| Note | Deletion also destroyed each disk's daily snapshots (prod had 7: 2026-07-14 … 2026-07-20) |

**Deploys are now zero-downtime — measured, not assumed.** Removing `disk:`
from `render.yaml` does NOT detach an existing disk; the dashboard click is
required, and until it happened deploys still had the stop-start window. The
before/after across two consecutive production deploys, sampling
`/api/health` every 2 s:

| | Disk attached | Disk deleted |
|---|---|---|
| Non-200 responses during the deploy windows | **35 of 53** (sustained 502, ~97 s) | **0 of 29** |

Bound the analysis to the deploy windows from Render's own API
(`/v1/services/{id}/deploys` → `createdAt`/`finishedAt`). A blanket "any
non-200 in the log" will trip on an unrelated network blip and tell you
something false about your deploys — one `000` (curl connection failure, not an
HTTP status) landed 30 s after the last deploy finished and is not a deploy
event.

Verify disk state with the API rather than the blueprint, and note the
response shape:

```bash
curl -s -H "Authorization: Bearer $RENDER_KEY" \
  https://api.render.com/v1/services/srv-d941o1cvikkc73bbfqp0 |
  python3 -c "import json,sys; d=json.load(sys.stdin); \
    s=d.get('service') if isinstance(d.get('service'),dict) else d; \
    print(s['serviceDetails'].get('disk') or 'none')"
```

The service object is at the **top level** of that response, not nested under
`service`. A naive `.get('service',{})` silently yields `{}` and reports the
disk as absent when it is still attached — a false "all clear" on the exact
question that gates a destructive step.

Gates satisfied **before** deletion, in this order:

1. **Health stopped depending on the disk** (PR #64) — deployed and verified
   live returning `{"ok":true,"db":true,"storage":"r2"}` before any disk change.
2. **Migration parity** — `scripts/migrate-images-to-r2.mjs --verify` exited 0
   inside the production container against the live `/data` mount: **0 files**
   across all four image subtrees, and a full-disk `find` for every image/PDF
   type also returned 0. The disk held 456 KB of vestigial pre-E05 directories
   (`analytics/ auth/ ferry/ stores/`), all already in Postgres.
3. **Record-value check** — no record in the live database referenced an
   off-disk image URL, so nothing pointed at bytes the disk didn't have.
4. **Dated off-site backup** — `explore-kingston-backup-2026-07-21.json.age`
   (2,023,894 B, encrypted, in the R2 backups bucket) taken while the running
   container still had `DATA_DIR=/data`, so it captured the legacy files one
   final time. Re-take one if the deletion happens on a later date.
5. **Diskless image proven** — built and booted with no disk: no `VOLUME`, no
   `/data`, `DATA_DIR` unset, Docker `HEALTHCHECK` healthy, `/api/health` 200,
   and `/`, `/ferry`, `/events` all 200.

`DATA_DIR` has already been removed from both Render services, so the app is
running diskless regardless of whether the volume is still attached.

If a future incident makes you wish the disk were back: it held nothing that
is not in Neon Postgres or the R2 buckets. Restoring it would restore 456 KB of
pre-E05 files that the app no longer reads.

### Layer 1 — Neon Postgres PITR (off-host, automatic)

**Superseded E15.** This layer used to be Render's daily snapshots of the
`/data` disk (7-day restore window). **The disk was removed**, so that layer is
gone — and it lost nothing: by the time it was deleted the disk held 456 KB of
vestigial pre-E05 directories and **zero** images (verified in the container,
2026-07-21). Everything durable had already moved off it.

The zero-effort automatic baseline is now **Neon's own point-in-time recovery /
branching** on the Postgres database, which is where all structured data lives.
Uploaded images live in the private R2 bucket, which is separately covered by
Layer 3. Nothing depends on a host-local disk any more.

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

> **Privacy pairing (E11):** bundles exported **before** the E11 privacy
> backfill ran still contain data the public privacy page says is gone
> (geo-ping coordinates, sensitive-destination outbound events, survey
> zip/state fields). After restoring any pre-backfill bundle, immediately
> re-run `npm run privacy:backfill -- --apply` against the restored database
> and confirm the re-run `--dry-run` reports three zeros.

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
`src/app/(site)/admin/layout.tsx` re-checks `role === "admin"`, and every
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
| `/admin/worklist` | The one review queue (E08): member submissions, visitor reports, re-verify checks — see "Worklist & moderation" below |
| `/admin/itineraries` | Build/edit itineraries |
| `/admin/hunts` | Build/edit scavenger hunts; review player submissions |
| `/admin/map` | Parking-zone **polygon editor** (MapZone, Geoman) |
| `/admin/maps` | General map builder — named public views + drawable markers/lines/trails/areas + built-in data layers (output at `/map`) |
| `/admin/audit` | **Change history** for everything (E09): who changed what, when, field-by-field — filterable, CSV-exportable, and the home of **restore** — see "History & restore" below |

**Ferry prediction toggle** (`/admin/ferry-info` → `POST /api/admin/ferry-prediction {enabled:boolean}`): the busyness forecast (`/ferry/plan`, the "how busy today" panel on `/ferry`, the home callout) ships **dark**. The flag
(the `ferry-prediction` record) defaults to **OFF**: the public sees nothing,
but **signed-in admins get a preview** so they can validate before flipping it
on. Flip it on only once you trust the estimate against reality.

### Worklist & moderation (E08)

`/admin/worklist` is the one review queue. Since E08, **nothing a member or
the public submits appears on the site until it's approved there** — member
writes land as `status='pending'` (invisible on every public page, feed, and
embed), and member *edits* of live content never touch the live record at
all: the full proposed revision rides inside the queue item until you approve
it. Admin edits through the normal editors still publish instantly — admins
are the moderators.

**One documented exception** (operator decision, 2026-07-20): the nonprofit
portal's **signup-count stepper** (±1 on a shift's "already signed up"
number) writes live directly for members — it's a clamped integer on a shift
the Chamber already approved, so holding every phone-signup tick for review
was pure queue toil. Everything else about a shift (title, date,
description, deletion) still holds for review, and a tick on a pending or
admin-hidden shift never publishes anything.

The queue holds five kinds of work (one item per record per kind — repeat
reports merge into the open item):

| Type | What it is | Actions |
|---|---|---|
| Moderation | A member's new record, proposed edit, or removal request; also scavenger-hunt photos | **Approve** (publishes / executes), **Reject** (needs a note — tell the submitter why), **Take down** |
| Reports | A visitor tapped "Report an issue" on /eat or /events | **Fixed it** after correcting the record, or Dismiss |
| Re-verify | A record passed its verify-by window (see intervals below) | **Still accurate** (stamps it verified), or Archive |
| Sync conflicts | Arrives with E16 (AMS sync) — shape ready, no producer yet | Resolve/Dismiss |
| Privacy | Arrives with E11 — shape ready, no producer yet | Resolve/Dismiss |

**Phone flow (~10 s per item):** open the queue → tap an item → read the
before/after (edits show only the changed fields) → one tap + confirm.
Destructive actions always confirm first. Use the **Overdue** chip to see
breaches; the working SLA is **review within 48 hours** — set a due date on
anything you're deferring so it surfaces there instead of getting lost.

**Approve semantics worth knowing:** approval re-validates the proposal
against the current schema — if the rules tightened since submission it is
auto-rejected with the validation message in the note, never force-written.
**Takedown** (from the queue or a report) flips the record to `pending` right
now; public pages drop it on the next ISR pass (~60 s) and the events feed
within its cache window (up to ~15 min for third-party pollers — that lag is
the documented cost of feed caching, don't disable it).

**Staleness sweep:** `POST /api/admin/worklist/sweep` files a Re-verify item
for every live record past its window — restaurants 90 days,
lodging/webcams/charities 180, itineraries 365 (a record-level
`verify_interval_days` overrides; events and volunteer shifts expire on their
own and are exempt). The sweep is idempotent — run it as often as you like.
Schedule it either as a **Render Cron Job** (dashboard → New → Cron Job,
`curl -fsS -X POST -H "Authorization: Bearer $WORKLIST_SWEEP_TOKEN"
https://<production-host>/api/admin/worklist/sweep`, weekly is plenty) or as
a GitHub Actions cron following the ferry-observe pattern
(`.github/workflows/ferry-observe.yml`). The token is env-only
(`WORKLIST_SWEEP_TOKEN`, §1 and §12); with it unset the sweep still works
from any signed-in admin session — the button-free fallback is hitting the
URL while signed in. Note: **seed records** (content that ships in git and
has never been edited) carry no database row yet, so the sweep skips them
until their first edit/verify overlays them — the §6 quarterly hand-check
still owns those.

### Unified events calendar & ingest (E12)

**What runs:** an hourly Render cron (`render.yaml`, service `events-ingest`) POSTs the
token-gated `/api/events/ingest`, which fetches every **enabled** calendar source
sequentially (politely: ≥300 ms spacing, ≤60 iCal fetches/run), mirrors the results into
the `external-events` store (idempotent — an unchanged feed writes nothing; events that
left the feed tombstone), and stamps a last-run report per source. Ingest runs whether or
not the unified-calendar flag is on — data flows dark; only render paths are flag-gated.

**The control room is `/admin/events-sources`:** per-source enable/disable toggles (no
deploy needed), last-run reports, "Sync now", the dedupe review ("not a duplicate"
verdicts), the trusted-org auto-publish flags, and the unified-calendar go-live switch
(E15's launch-cutover call — coordinate before flipping it in production).

**Reading a last-run report:** `fetched/parsed/skipped` count HTTP requests, usable
events, and deliberately-excluded ones (unpublished, hidden, soft-404s); `+/~/−` are
store creates/updates/tombstones. Errors listed there are fail-soft records, not crashes
— a dead subdomain or a soft-404 shows up here and the other sources still sync.

**When the explorekingstonwa Tribe feed wakes up** (it has returned `total: 0` on every
probe through 2026-07-20): nothing to deploy — the source is enabled-but-empty-tolerant,
so events flow in on the next hourly run. Check the dedupe review afterward.

**GrowthZone end-of-life (~April 2027, R3 freeze / cancellation —
docs/adr/ADR-0005-events-canonical-source.md):** disabling the `ams-ical` source on
`/admin/events-sources` is the whole procedure — its events drop from the merged calendar
on the next read, no deploy. Actually flipping it off is an **R4 migration-completeness
gate item** (roll-off plan §4), not something to do early. If the subdomain dies first,
ingest fails soft (truth-triple rejections in the report) — disable the source to quiet it.
At R4 the entire business.kingstonchamber.com subdomain retires and the kingstonchamber.com
WordPress site repoints its events links/widgets at this app's `/api/feeds/events` and
`public/embed/kingston-events.js` — those surfaces are cutover-critical (feed contract is
additive-only).

**Quarterly:** `npm run events:probe` re-checks all three sources (truth-triple, soft-404,
whole-calendar candidates) and rewrites `docs/adr/events-source-probe.json`; a changed
answer is a `calendar-sources` config change, not a code change.

**Public suggest intake:** `/events/suggest` (flag-gated) → always `status: pending` in
the moderation queue — the anonymous path has no bypass. Trusted-org auto-publish (the
one bypass, both portal event routes) is set per-org on `/admin/events-sources`; every
bypassed write is still audit-rowed.

### Service worker & offline (E13)

The site is an installable PWA. A hand-written `public/sw.js` (no library, no
build step) caches the six public pages people actually need in the ferry line
— plus an offline fallback page and one ferry-status snapshot — in three
entry-capped, version-keyed caches. Nothing under `/admin` or `/portal` is ever
cached, and nothing under `/api` **except one exact path** — `GET
/api/ferry/status`, the snapshot named above: one entry, stamped
`X-SW-Fetched-At` so the boards can label it on screen as a saved copy. Shared
devices are normal here, which is why that carve-out is exact-match and not a
prefix. **Full detail, including the strategy table and the cache caps, is in
[docs/PWA.md](PWA.md).**

If a visitor reports ferry times that are hours old on a phone that has signal,
`vk-data-*` and that `X-SW-Fetched-At` stamp are the first place to look — a
flaky one-bar connection makes `fetch` throw, and the worker then answers with
the saved snapshot, which resolves exactly like a live poll.

**Nothing to operate day to day.** There is no admin toggle, no env var, and
no dashboard button — the worker ships with the build, deliberately.

**When something goes wrong with it** — visitors stuck on stale pages, or any
"turn it off now" call — go to PWA.md §3: step 1 bumps `VERSION` in
`public/sw.js` (the only supported cache invalidation); step 2 is the nuclear
**kill switch**, a self-unregistering worker that wipes every cache and
unregisters itself. Both need a **rebuild + redeploy**, never a Render restart
— the `/sw.js` cache header resolves at build time into `routes-manifest.json`
(same trap as "restart ≠ env inject", §3).

**Two things that will otherwise waste your afternoon:** the worker does not
register in development at all (`NODE_ENV === "production"` only), so offline
behaviour can only be exercised against a production build; and a page hidden
via `/admin/content` is never cached **as a 404**, because the worker caches
only `200` responses — but an admin's own preview of that hidden page *is* a
200, and the residual exposure there is written up in PWA.md §7 under "Known
limitations / deferred".

The offline survey path writes through an idempotency-keyed intake
(`idempotency_keys`, swept after 30 days by an opportunistic prune — PWA.md §5,
deliberately outside `RETENTION_POLICY`). The device walkthrough Mat runs on
staging after a deploy is PWA.md §8.

### History & restore (E09)

Nothing an admin does in the editors can be lost. Every save, delete, and
import writes a snapshot to an **append-only** audit trail (Postgres rejects
edits to it at the database level), and any full snapshot can be put back
with one tap. So the promise to volunteers is: **edit freely — the worst
mistake costs one restore, not an afternoon.**

**Fix a bad edit (phone flow, ~15 s):** open the record in its editor → tap
**View change history** → find the version from before the mistake → expand
it to read the field-by-field diff → **Restore this version** → confirm.
The confirm dialog says exactly what happens: the old version is saved as a
**new** change — nothing is deleted, and you can undo the undo the same way.
After a restore, reload the page to see the values back in the form; public
pages update within a minute, like any edit.

**Un-delete a listing:** deleted records keep their history. Open
`/admin/audit`, filter to the content type, find the record, pin its history
(or follow the editor's history link), and restore the last version from
before the delete — the record comes back live exactly as it was.

**Maps and parking zones:** those two editors are frozen high-risk files, so
their history lives in the browser instead — use the "change history" links
on `/admin/map` and `/admin/maps` (they open `/admin/audit` pre-filtered),
pick the record, and restore from there. One caveat: restoring a map
feature restores its **document** (shape, name, links) — an image file that
was replaced separately is not part of the snapshot.

**What can't be restored, on purpose:** accounts, invites, and orgs (their
history shows who did what and when, but details are hidden and restore is
disabled — an old account snapshot is a security lever, not content), and
partial events like status changes or re-verify stamps (they aren't full
versions of anything). Restored versions are re-validated against today's
content rules first — a very old snapshot that no longer fits is refused
with a field-by-field reason instead of being force-written, same rule as
worklist approvals.

**For the operator:** the trail is append-only and kept **at least 12
months** (no pruning exists anywhere; deleting audit rows is a policy
decision that would need its own epic). `/admin/audit` → **Download CSV**
exports the current filter (up to 10,000 rows) with metadata columns only —
`ts,actor,action,store,record_id,source`, never document bodies — safe to
hand to the board or an auditor. Every restore is itself an audit row
(`action: restore`, with the admin's email), so the trail records the undo.
A restore keeps the record's current lifecycle status: restoring an old
version of a **pending** submission does not publish it.

**Deploy posture (staging-first):** the E09 branch deployed to staging via
the `staging` branch, the full restore flow was rehearsed end-to-end
against the production build + a real Postgres locally (login → edit →
history → restore → verify → 409 on a stale pin → CSV), and Mat ran the
hands-on restore on the staging host before the production merge.
(Staging's admin accounts were reset and re-bootstrapped that day — the
original E03-era staging login had been lost.)

Restore rehearsed on staging: 2026-07-20

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

> **✅ DONE on production, 2026-07-19.** Auth v2 is live and the accounts are
> migrated. Kept as the procedure for the next migration-bearing release.
>
> ⚠️ **It did not go to plan, and the lesson generalizes.** The code merged to
> `main` and auto-deployed BEFORE the production migration ran, so production
> served auth-v2 against an empty `users` table and nobody could sign in for
> ~3 hours (the public site was unaffected). Read
> **[Migrations under auto-deploy](RUNBOOK-CUTOVER.md#migrations-under-auto-deploy)**
> before shipping anything like this again. Short version: `main` auto-deploys,
> so **run the production migration BEFORE merging the PR that reads the new
> tables.**

The auth-v2 release changes the session-token format (it adds the `sv`
revocation claim). Tokens without it cannot be revoked, so they are not
honored.

**Every signed-in user is logged out once when this release deploys.** There
are roughly 20 accounts and they are all known to the Chamber — announce it
first. Nobody loses data, nobody needs a new password: they sign in again with
the credentials they already have.

Order of operations (staging first, then production in a quiet window — and
note step 0, which is the one that was missed):

0. **Confirm the migration has run against the target BEFORE the code that
   needs it reaches that target.** For production that means: run the migration
   first, then merge. There is no gap between merging and deploying.

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

## 5b. Scheduled jobs — the complete inventory

Every recurring job, and where it runs. **If a job is not in this table it does
not run.**

| Job | Where | Schedule (UTC) | Calls | Token |
|---|---|---|---|---|
| `events-ingest` | Render cron | `23 * * * *` hourly | `POST /api/events/ingest` | `EVENTS_INGEST_TOKEN` |
| `ferry-observe` | Render cron | `*/15 * * * *` | `POST /api/ferry/observe` | `FERRY_OBSERVE_TOKEN` |
| `ferry-accuracy` | Render cron | `0 8 * * *` (~1 AM Pacific) | `POST /api/ferry/accuracy` | `FERRY_OBSERVE_TOKEN` |
| `worklist-sweep` | Render cron | `0 14 * * 1` Mondays (~7 AM Pacific) | `POST /api/admin/worklist/sweep` | `WORKLIST_SWEEP_TOKEN` |
| `backup-offsite` | **GitHub Actions** | `23 9 * * *` daily | `GET /api/admin/backup` | `BACKUP_TOKEN` |
| `privacy-retention` | GitHub Actions, **manual only** | *(no schedule — ships dark)* | `POST /api/admin/privacy/retention` | `RETENTION_TOKEN` |

**Why the app crons live on Render (E15 slice 4).** GitHub disables scheduled
workflows after 60 days with no repo commits. For an app maintained by one
part-time person a quiet stretch is normal, and the failure is silent: ferry
observations — the data the busyness forecast learns from — would just stop.

**Why `backup-offsite` deliberately stays on Actions.** It installs `age` and
encrypts the bundle **on the runner** before it is stored anywhere. Running it
from a Render cron would mean putting the backup keypair inside the app's own
image, which is the one thing a backup has to survive.

**Why `privacy-retention` has no schedule.** Its apply flag is
`inputs.apply || event_name == schedule`, so giving it *any* schedule makes it
start really deleting. Enabling the purge is an owner decision (E11), not a
side effect of a cron change. `tests/unit/cron-inventory.test.ts` fails if a
schedule is ever added.

**The trap that has bitten this repo.** A cron calling an `/api/admin/*` route
is authorised by the `MACHINE_TOKEN_ROUTES` table in `src/proxy.ts`, which maps
the **exact path** to the env var holding its token. A path missing from that
table is rejected no matter how correct the token is, and the only symptom is a
job that quietly stops. That is how nightly backups broke once. The same test
file asserts every cron's admin path is present in the table.

**Rotating a cron token** means updating it in **two** places — the web service
and the cron service — because the cron authenticates against the web service.

---

## 6. Seasonal & recurring maintenance calendar

Dated, concrete, grounded in the seed files. Put these on a real calendar.

### Fixed dates

| When | What | Where |
|---|---|---|
| **2026-09-12** | Kitsap Transit GTFS feed **S1000066 expires** (valid 2026-06-14 → 2026-09-12). The bundled fast-ferry times are hardcoded from it — refresh when the fall schedule drops (`https://pride.kitsaptransit.com/gtfs/google_transit.zip`) or the app shows a stale summer schedule. Also re-check the Saturday seasonal window (currently months 5–9). | `src/lib/kitsap.ts` |
| **~2026-09-14** | Friends & Neighbors Brewing resumes Monday 4–8 pm hours (closed Mondays until MNF returns). Update the hours string (or have them edit via the portal). | `src/lib/data/restaurants.ts` |
| **October 2026** | WSF typically changes fares each October; Kitsap Transit fares also historically take effect Oct 1. **Fares are admin-editable — no deploy:** edit them at **`/admin/ferry-info` → Fares** (walk-on, drive-on, fast ferry) and update the "rates as of" line in the same save. The **walk-on round-trip** figure also feeds the sentences on `/ferry`, `/simple` and `/es`; all three follow that row, so one save fixes every surface. Do NOT hand-edit a fare into `src/lib/i18n/safety-content.ts` — a test fails on purpose if you do. **Still needs a code change:** the fast-ferry `$2`/`$13` prose on `/ferry` and in `src/lib/kitsap.ts`, and the `$27` drive-on badge — the inventory is `KNOWN_DUPLICATES` in `tests/unit/fare-single-source.test.ts`, with a reason for each. | `/admin/ferry-info` → Fares (seed: `src/lib/data/ferry-info.ts`); leftovers listed in `tests/unit/fare-single-source.test.ts` |
| **Oct 1–30, 2026** (annually; watch kitsap.gov/das each summer — the window has moved) | Kitsap County **LTAC** grant RFP for 2027 funds. One-month window; late = rejected. Export the survey/analytics summaries from `/admin` for the application. | DATA_SOURCES §12 |
| **Annually** (pick a fixed month once E03's migration date is known) | Rotate the **age backup keypair** (`BACKUP_AGE_RECIPIENT`) — see §12 Secret rotation. Keep every retired private key; old backups need them. | 1Password "ExploreKingston backup age key" |
| **Monthly** (once the E11 retention cron is scheduled) | Check the last `retention-purge` audit row in `/admin/audit` — a silent cron failure is retention drift: the public privacy page keeps promising windows nothing is enforcing. No row since the last calendar month = investigate the workflow run. | `/admin/audit` (action `retention-purge`); `.github/workflows/privacy-retention.yml` |

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
- **Run the restore drill and log it** — [`docs/runbooks/RESTORE-DRILL.md`](runbooks/RESTORE-DRILL.md). Mode A (filesystem) is non-programmer-runnable; a backup you've never restored is a hope, not a backup.
- **Confirm the on-call secondary contact and send a test alert** — [`docs/runbooks/ALERTS.md`](runbooks/ALERTS.md). The Chamber board designee's phone must actually ring when Mat is away.
- **Check the GeoLite2 status** on `/admin/ops` (WARN = a stale/failing self-refresh, usually an expired key) — [`docs/runbooks/GEOIP.md`](runbooks/GEOIP.md).
- **Rotate `BACKUP_TOKEN`, `FERRY_OBSERVE_TOKEN`, `WORKLIST_SWEEP_TOKEN`, and `EVENTS_INGEST_TOKEN`** — see §12 Secret rotation.
- **Run `npm run events:probe`** (E12 source drift alarm) — re-checks the three event
  sources and rewrites `docs/adr/events-source-probe.json`; a changed answer (the
  explorekingstonwa feed filling, the whole-calendar URL arriving/dying, the GrowthZone
  subdomain retiring) is a `calendar-sources` toggle on `/admin/events-sources`, not a
  code change — see §5 "Unified events calendar & ingest".

Since E08 the staleness sweep (§5 "Worklist & moderation") files Re-verify
queue items for overlay-backed records automatically — this hand-check
remains authoritative for seed records the sweep can't see yet and for the
deep-link/403 checks no automation can do.

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

### Basemap vector tiles — `kingston.pmtiles` on R2 (E31)

The map basemap is a **self-hosted Protomaps vector archive** (ADR-0006), not a
live third-party tile fetch. One ~1.9 MB PMTiles file covers Kingston + the
churches + the full Edmonds–Kingston ferry crossing (east to the Edmonds
terminal, for the live-vessel map); MapLibre reads it by HTTP range.

**Where it lives.** A dedicated **private** R2 bucket (`visit-kingston-tiles`),
kept apart from the private image bucket (`R2_IMAGES_*`). R2 has no public URL
here (a Cloudflare custom domain needs a nameserver move the binding decisions
reject; `r2.dev` is not for prod — the same reason images are private), so the
public route `GET /api/map/tiles/<name>.pmtiles`
(`src/app/api/map/tiles/[file]/route.ts`) proxies the client's `Range` header to
the bucket and passes R2's `206` straight back. `src/lib/map/tiles-store.ts`
holds the `R2_TILES_*` accessor and the filename allowlist.

**Env** (four vars, mirroring `R2_IMAGES_*`): `R2_TILES_ENDPOINT`,
`R2_TILES_BUCKET`, `R2_TILES_ACCESS_KEY_ID`, `R2_TILES_SECRET_ACCESS_KEY`. Local:
`.env.local`. Prod: **Render env** — add these before flipping any map to
MapLibre. A half-set config reads as "not configured" and 502s the tile route
rather than half-serving.

**Refresh** (quarterly — OSM drifts slowly):

```bash
brew install pmtiles                 # once, if not present
set -a; . ./.env.local; set +a       # load R2_TILES_* (or run in CI with env set)
node scripts/build-tiles.mjs         # newest Protomaps build -> extract Kingston bbox -> R2
# node scripts/build-tiles.mjs --dry-run   # extract only, no upload
```

The bbox is the only knob (`BBOX` in the script); widen it there if the map ever
needs Hansville / Point No Point / Indianola.

**Verify:**

```bash
curl -I -H 'Range: bytes=0-0' https://<host>/api/map/tiles/kingston.pmtiles   # expect: HTTP 206 + Content-Range
```

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
| 10 | **Resend email (before businesses self-serve)** — SPF + DKIM TXT added to the authoritative zone on the Chamber's WordPress VPS (the same cPanel Zone Editor as the app CNAME — **not** at the registrar, NameCheap, where they would have no effect) so invite email works. ⚠️ These are **mail** records on the box carrying Chamber email: capture `dig TXT` + `dig MX` before and after, and only ADD records — never edit or replace the existing SPF/MX. Until then hand invite codes over directly. | SYNDICATION "Email" |
| 11 | **Send the GrowthZone written non-renewal notice by March 1, 2027** — the contract auto-renews each April; notice must land ≥30 days before term end and missing it costs another non-refundable ~$4k year. Confirm the exact April term-end day from the renewal invoice and complete ALL data exports first (no export rights after termination). Full plan: docs/ROLLOFF-GROWTHZONE.md §4. | Mat + Chamber office — calendar this NOW |
| 12 | **Constant Contact takeover (Mat)** — when the CC export work is set up: inventory which CC lists GrowthZone auto-fills (Contacts → Lists), gather whatever access is needed, export the GZ email/newsletter templates at the same time, and stand up the app→CC list-export runbook (docs/ROLLOFF-GROWTHZONE.md §3). | Mat, with Chamber CC login |
| 13 | **Name the on-call secondary contact (the Chamber board designee)** — fill in name/phone/email in [`docs/runbooks/ALERTS.md`](runbooks/ALERTS.md), add them as an UptimeRobot alert contact, and grant Render dashboard access. Bus-factor: someone's phone must ring when Mat is unavailable (UE-20 / FR-A29). | Chamber board + Mat |
| 14 | **Create the free MaxMind GeoLite2 account + license key** for visitor-origin geo on `/admin`, then set `MAXMIND_LICENSE_KEY` on Render — [`docs/runbooks/GEOIP.md`](runbooks/GEOIP.md). Optional: analytics geography shows "Unknown" without it, nothing else changes. | Mat |
| 15 | **Chamber/legal review of the privacy notice and accessibility statement** (E11) — read through `/privacy` and `/accessibility` before treating them as settled. ~~verify the ADA small-entity compliance deadline date before citing it~~ **Date half RESOLVED 2026-07-21**: verified against [ada.gov's compliance table](https://www.ada.gov/resources/2024-03-08-web-rule/) — public entities under 50,000 people and special district governments must meet WCAG 2.1 AA by **April 26, 2028** (DOJ extended it a year from April 26, 2027 in an interim final rule effective 2026-04-20, so anything written before then says 2027 and is stale). `/accessibility` now states it, scoped honestly: the Chamber is a private nonprofit, so Title II does not bind the site and the date is adopted voluntarily. The date lives in the `accessibility.ada.deadline` copy block — editable without a deploy, because DOJ has moved it before. **The broader Chamber/counsel read-through of both pages stays OPEN.** | Mat + Chamber (+ counsel if available) |
| 16 | **Confirm the E11 retention windows** are what the Chamber wants on the public page (k=5 distinct sessions; geo-ping 90 days→rollup; page/link 25 months; survey 36 months; hunt submissions+photos 12 months; request contacts scrubbed at resolution). Changing any is a notice-version bump. | Mat + Chamber |

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

### `/api/health` returns 503 (or 500)

Since E15 the only thing that can make health unhealthy is Postgres. **The
status code tells you which kind of database failure it is** — a genuinely
useful first triage step:

| Code | Body | Meaning | Fix |
|---|---|---|---|
| **503** | `{"ok":false,"db":false,…}` | The app is running but has **no database configured** — `DATABASE_URL` unset. The route ran and reported honestly. | Set `DATABASE_URL` on the service and redeploy |
| **500** | `Internal Server Error` (no JSON) | `DATABASE_URL` **is** set but the host is **unreachable** (wrong host/port/credentials, or Neon down). The boot migrator in `src/instrumentation.ts` fails on `CREATE SCHEMA IF NOT EXISTS "drizzle"`, the instrumentation hook fails to load, and Next 500s **every** route — health never even runs. Check the service logs for `ECONNREFUSED` / `An error occurred while loading instrumentation hook`. | Correct `DATABASE_URL` or wait for Neon; redeploy |

Both are fail-closed — Render withholds traffic from any non-200 release — so
the safety posture is the same; only the diagnosis differs. (Health no longer
probes the disk; a storage problem is reported in `storage` but never 503s.)
Render withholds traffic from the unhealthy release, and **since E15 removed
the disk that now keeps the previous release serving**: with no volume to hand
over, the old container stays up until the new one is healthy, so a bad release
is held back rather than taking the site down. (Before the disk was removed the
old container had to stop first, and a release that never went green meant the
site was **DOWN (502)** — observed on staging 2026-07-19.) Fix the env var /
database and redeploy, or roll back to a known-good commit.

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
`src/lib/hunt-store.ts` (currently 400 MB). The number was sized for headroom
on the old 1 GB disk; since E15 images live in R2 and the cap is an ABUSE
control rather than a capacity one — it bounds what a flood can cost, not what
the box can hold. Re-tune it against the R2 spend you're willing to absorb.

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
| `WORKLIST_SWEEP_TOKEN` | Quarterly | Same procedure — update the Render env var on **both** services and wherever the sweep cron is registered (Render Cron Job or GH Actions secret). Fail-closed: while rotated-but-unset the sweep just needs an admin session. |
| `EVENTS_INGEST_TOKEN` | Quarterly | Same procedure — update the Render env var on the **web service AND the `events-ingest` cron service** (same value in both). Fail-closed: while rotated-but-unset, ingest still runs from "Sync now" on `/admin/events-sources`. |
| age keypair (`BACKUP_AGE_RECIPIENT`) | Annually, or immediately on any suspicion of exposure | `age-keygen` → new **public** key becomes the repo variable `BACKUP_AGE_RECIPIENT` (`gh variable set`) → new **private** key goes to 1Password ("ExploreKingston backup age key") → **keep every old private key** — backups encrypted under a retired key can only be decrypted with it, and rotation is forward-only (old backups are never re-encrypted) |
| `AUTH_SECRET` | Never casually — rotating logs **every** signed-in user out (see §10 "Portal login loops"). Only rotate on a real compromise. | Render dashboard env var → redeploy. Since E06 there IS per-user revocation (disable / reset / role change bump `session_version`), so rotating this is only for a compromise of the SECRET itself — to remove one person, use §5 "Off-board a volunteer". |

Never echo a secret value in a terminal, script, or CI log — this repo is
public, so a logged secret is an exposed secret. `gh secret set NAME` reads
the value from stdin or a file, never a shell argument that could land in
shell history or process listings.

---

## 13. Accessibility & language (E14)

The engineering side of this — the style guide, the manual audit checklist, the WCAG
posture, the exclusions policy — lives in [`docs/ACCESSIBILITY.md`](ACCESSIBILITY.md).
What follows is the part a **person** has to do.

### 13.1 Publish the Spanish page (`/es`)

`/es` **ships dark and stays dark until a bilingual human signs off.** It is registered in
`DEFAULT_HIDDEN_PAGES` (`src/lib/page-visibility.tsx`), which means the absence of a
site-pages record is treated as HIDDEN — a fresh database, a restored backup, or a wiped
store all leave it invisible rather than publishing unreviewed instructions about ferry
lines and tow rules. Visitors get a clean 404; admins see it with the hidden-page banner.

The procedure, in order:

1. **Print the strings.** They are all in `src/lib/i18n/safety-content.ts`, the `es` half —
   six sections, hand-authored, no machine translation anywhere in the path.
   Two sentences read `{phone}` and `{walkOnRoundTrip}` instead of a value. That is
   correct: those are live figures the Chamber edits without a deploy (the phone in
   Admin → Site content, the fare at `/admin/ferry-info` → Fares), and freezing either
   into this file is how the page starts publishing a number that is no longer true.
   Review the wording AROUND them, and review `SAFETY_TOKEN_FALLBACKS.es` in the same
   file — that is what the sentence says when the fare is unavailable, so it is a
   sentence a visitor can really see. Step 4 shows the filled version.
2. **Find a reviewer.** A bilingual Spanish/English speaker, ideally one who has actually
   stood in the SR 104 ferry line. A Chamber member or volunteer is fine; this does not need
   a professional translator, it needs someone who will catch a sentence that is technically
   correct and practically misleading.
3. **Review against the English, side by side.** The two halves are key-for-key identical by
   test, so every English step has exactly one Spanish counterpart. Check three things:
   the Spanish says the same thing; the Spanish is plain (grade 6–9, one idea per sentence);
   and no instruction promises something the app cannot guarantee — in particular there must
   be **no "last boat" time** anywhere.
   Two lines have already drifted once and are worth reading twice: `returnTrip.note`, where a
   wrong time of day strands somebody overnight, and any step that names a **fare** or a
   **clock time** — those are the sentences where "close enough" has a consequence.
4. **Preview it signed in.** Visit `/es` as an admin. It renders with a banner saying
   visitors get a 404. Read it on a phone.
5. **Fix anything the reviewer flags** — edits to the dictionary are a code change and a
   deploy; the page headings and the intro are copy-registry blocks and can be edited live
   in Admin → Site content, and a wrong **fare** is neither: fix it at
   `/admin/ferry-info` → Fares and both languages follow (§14.1).
6. **Unhide it.** Admin → Site content → Pages → "Kingston en español" → press the toggle so
   it reads **Visible**. That writes an explicit `{ id: "/es", hidden: false }` record, which
   is what makes the page public. The `/es` link appears in the site footer and on
   `/simple` within about a minute (ISR window).
7. **Record who reviewed it and when** — in the PR, or in this runbook — so the next annual
   review knows what it is re-checking.

To take it back down, press the same toggle. There is no other switch.

### 13.2 Confirm the phone number and email

The Chamber's own contact details are copy-registry blocks (`contact.phone.number`,
`contact.phone.label`, `contact.email.address` in `src/lib/site-copy-registry.ts`), editable
from Admin → Site content without a deploy. They are the guaranteed non-app fallback — the
number appears in the footer of every page, on `/simple`, on `/print`, and on
`/accessibility`.

- Current fallback: **360-860-2239** and **info@kingstonchamber.com**.
- Confirm both **annually**, and immediately whenever the office line changes. A wrong number
  in the footer is worse than no number: it is the last resort for someone who cannot use the
  rest of the site.
- §9 item 7 tracks confirming that `info@kingstonchamber.com` is actually monitored.

### 13.3 Review the accessibility statement annually

`/accessibility` is a public commitment, so it gets checked at least once a year and whenever
something significant ships.

- Update **"Last reviewed"** (copy-registry block `accessibility.lastReviewed`) from Admin →
  Site content. Changing that date is a claim — only change it after actually re-reading the
  page.
- Re-check the **known limitations** section against reality: are the named list-based
  alternatives to the maps still there, still complete, still linked?
- Re-check the **"How we check"** section. It currently describes the full per-route
  automated gate as *planned, not shipped*. When that gate lands, the wording changes; until
  then it must not claim it.
- **The ADA compliance date is now stated: April 26, 2028** (verified 2026-07-21 against
  [ada.gov](https://www.ada.gov/resources/2024-03-08-web-rule/) — the tier for public entities
  under 50,000 people and special district governments). It lives in the
  `accessibility.ada.deadline` copy block, so Admin → Site content can correct it without a
  deploy.
  **Re-verify it at every annual review, and never from memory or a model.** DOJ has already
  moved this date once — an interim final rule effective 2026-04-20 pushed it a year, from
  April 26, 2027. Any source written before then states 2027 and is now wrong, which is exactly
  the failure this gate was built to prevent. Check ada.gov itself, not a summary.
  The statement also names the earlier 2027 date and the extension, so a reader can tell the
  figure is tracked rather than copied once and forgotten.

---

## 14. Practical visitor basics (E27)

The four "on the ground" facts a ferry visitor needs: a restroom, a fare, whether
a thing costs money, and whether they can get in the door. All four are
Chamber-editable without a deploy.

### 14.1 Ferry fares — the October chore

**Where:** `/admin/ferry-info` → **Fares**.

Three groups (walk-on, drive-on, fast ferry), each a list of `{ what, amount,
note }` rows. Amount is free text, so "Free" and "$11.35" both work.

- WSF adjusts fares most Octobers — see the fixed-date row in §6. Update the
  amounts **and** the "rates as of" line together; that line is what tells a
  visitor how much to trust the numbers.
- The senior/disability row is deliberately its own line naming the **RRFP**
  (Regional Reduced Fare Permit). Keep it that way — it was buried in a
  sentence before E27 and the riders it applies to did not find it.
- The seed lives in `src/lib/data/ferry-info.ts` (`FERRY_FARES`). A test pins
  the exact figures, so a code-side change to a fare fails CI on purpose —
  that is a prompt to confirm the new number, not a bug.

#### The walk-on round-trip row is quoted in sentences elsewhere

`/ferry`, `/simple` and `/es` don't just list this fare in the table — they say
it mid-sentence ("a round trip on foot costs ___, and you pay it once"). All
three read the **same row**, so editing it here fixes all three at once. Two
things follow from that, and the editor says both on the row itself:

- **Rename or reorder it freely.** The pages follow a hidden stable key, not the
  label or the position. This is why renaming "Round trip on foot" is safe.
- **Delete it, or type something that isn't a single figure** (`Free`,
  `$27.00 + $11.35/passenger`), **and those sentences name no number** — they
  read "the fare posted at Edmonds" / "la tarifa publicada en Edmonds" instead.
  That is deliberate: publishing a figure nobody confirmed is worse than
  publishing none, and the readers of `/simple` and `/es` are the least likely
  to catch a wrong one. The fare **table** still shows exactly what you typed.

Before this, `/simple` and `/es` carried their own hardcoded copy of the fare in
both languages, so the October edit here fixed `/ferry` and left those two
showing last year's number until someone changed code.
`tests/unit/fare-single-source.test.ts` now fails if any page grows its own copy
again, and lists in `KNOWN_DUPLICATES` the fare figures still hardcoded in
`/ferry` prose (the `$2`/`$13` fast-ferry lines and the `$27` drive-on badge) —
those still need a deploy.

### 14.2 Restrooms, water & amenities

**Where:** `/admin/maps` — ordinary map features on the **`amenities`** view.

The public surfaces are `/map/restrooms` (a one-tap finder plus the map) and the
"Restrooms & Amenities" layer in the `/map` switcher.

To add or correct a pin:

1. Open `/admin/maps`, pick the **Restrooms & Amenities** view.
2. Add a marker and choose its category: restroom, drinking water, bench, picnic
   table, shade, trash/recycling, or trailhead.
3. **Put the source in the notes.** Where did this location come from — a Port
   map, a Chamber walk-through, a phone call? Say so, and say plainly if it is
   approximate. A test enforces this for restroom and water pins.
4. Drag the pin to reality. Seeded Port-map positions are approximate by
   admission; the ground always wins.

**Drinking water is deliberately empty.** No published source places a fountain
or potable spigot in Kingston, so nothing was invented. The finder tells visitors
so honestly. **If you know of one, adding it is a two-minute job here** — that is
the single highest-value amenity edit available.

> Why the caution: a pin to a restroom that isn't there sends someone who
> urgently needs one on a walk to nothing. Under-promising is the correct bias.

**Privacy note for anyone answering visitor questions:** the "Find the nearest
restroom" button does its distance maths on the visitor's phone and sends
nothing anywhere — no server call, no stored location. It is safe to recommend
without qualification.

### 14.3 Free vs paid labels

A shared badge renders **Free / Paid / Free & paid / By donation** as *text*
(never colour alone). Parking rows derive theirs from the existing parking rule,
so there is nothing extra to maintain there. Restaurants deliberately do **not**
carry it — they keep their `$` price level.

### 14.4 Access facts & the report loop

**Where:** the listings workbench, on each restaurant and lodging record.

Six fields: step-free entrance, accessible restroom, accessible parking (each
Yes / No / Partly / Not checked), plus notes, a verified-on date, and a source.

- **Leave "Not checked" unless someone actually checked.** A listing with
  nothing recorded shows no access block at all, which is honest. A wrong "Yes"
  strands someone at a door.
- Set **verified on** only for an in-person check. With it, visitors see
  "Checked <date>"; without it they see "Not verified in person yet — call
  ahead", which is the truthful default.
- Visitors report problems through the existing **Report an issue** link, which
  files a moderation-queue item (§5). Nothing a visitor submits is published.
- The venue-audit *programme* that would produce verified facts at scale is
  deliberately deferred — see `BACKLOG.md`.
