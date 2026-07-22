# syntax=docker/dockerfile:1
#
# Production image for "Explore Kingston" (Next.js 16.2.10, App Router).
#
# Standalone-output paths verified against THIS installed version's docs at
# node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md
# and the build source node_modules/next/dist/build/index.js (16.2.10):
#   - `output: "standalone"` (set in next.config.ts) emits `.next/standalone`,
#     a self-contained server bundle that runs WITHOUT node_modules installed.
#   - A minimal `server.js` is emitted at the ROOT of `.next/standalone` and is
#     the entrypoint (run with `node server.js`). It honors the PORT and
#     HOSTNAME env vars (docs "Good to know": `PORT=8080 HOSTNAME=0.0.0.0 node server.js`).
#   - standalone does NOT include `public/` or `.next/static/` — the docs say
#     to copy them into `standalone/public` and `standalone/.next/static`
#     manually, after which server.js serves them automatically. That is
#     exactly what the runner stage does below.
#
# Multi-stage: deps -> build -> runner. Only the runner is shipped.

# ---------------------------------------------------------------------------
# Stage 1: deps — install node_modules from the lockfile only.
# Isolating this stage lets Docker cache dependencies across builds as long as
# package.json / package-lock.json are unchanged.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# Only the manifest + lockfile so this layer is cached unless deps change.
COPY package.json package-lock.json ./

# `npm ci` installs the EXACT lockfile tree — reproducible and fails if
# package.json and the lock are out of sync. Needs the lockfile (verified present).
RUN npm ci

# ---------------------------------------------------------------------------
# Stage 2: build — compile the app and produce .next/standalone + .next/static.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Reuse the cached dependency tree from the deps stage.
COPY --from=deps /app/node_modules ./node_modules

# Copy the rest of the source. .dockerignore keeps node_modules/.next/.data/
# .env* / docs / scratch out of the build context.
COPY . .

# Build in production mode so Next optimizes output and disables dev-only code.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3: geoip — download the DB-IP City Lite database to bake into the image.
#
# DB-IP Lite is CC-BY-4.0 (redistributable), so — unlike MaxMind GeoLite2, which
# it replaced 2026-07-22 — the .mmdb can ship IN the image: no runtime download,
# no license key, present the instant the container boots (src/lib/geoip.ts).
# Isolated stage so a DB-IP outage fails the build loudly HERE (never a runner
# with a half-written DB), and so the layer caches by month. Runs in parallel
# with build; only the ~125 MB .mmdb is copied into the runner below.
# ---------------------------------------------------------------------------
FROM alpine:3.20 AS geoip
RUN apk add --no-cache curl
WORKDIR /geoip
# Try the current month, then the previous month: DB-IP publishes the new file
# on the 1st, and a build in the first minutes of a month can race that upload.
# Previous month is computed with POSIX arithmetic (busybox `date` has no
# relative `-d`); 10# forces base-10 so "08"/"09" are not read as bad octal.
# --retry rides out transient 5xx/network blips. Fail the build if NEITHER
# month resolves — a failed deploy beats an image whose geo silently never works.
RUN set -eu; \
  cur="$(date -u +%Y-%m)"; \
  y="$(date -u +%Y)"; m="$(date -u +%m)"; \
  pm=$((10#$m - 1)); py="$y"; \
  if [ "$pm" -lt 1 ]; then pm=12; py=$((y - 1)); fi; \
  prev="$(printf '%04d-%02d' "$py" "$pm")"; \
  ok=0; \
  for ym in "$cur" "$prev"; do \
    url="https://download.db-ip.com/free/dbip-city-lite-${ym}.mmdb.gz"; \
    echo "geoip: trying ${url}"; \
    if curl -fSL --retry 3 --retry-delay 5 --max-time 300 -o db.mmdb.gz "$url"; then ok=1; break; fi; \
  done; \
  [ "$ok" = 1 ] || { echo "geoip: could not download DB-IP City Lite for ${cur} or ${prev}"; exit 1; }; \
  gunzip db.mmdb.gz; \
  test -s db.mmdb

# ---------------------------------------------------------------------------
# Stage 4: runner — the lean runtime image that actually gets deployed.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# server.js reads these to bind the listener (verified in Next 16.2.10 docs).
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# NO DATA_DIR (E15 slice 3). Nothing durable is written to this container's
# filesystem: structured state is in Postgres via DATABASE_URL (E05), uploaded
# images are in the private R2 bucket via R2_IMAGES_* (E15 slice 1).
#
# src/lib/data-dir.ts still exists and falls back to <cwd>/.data when DATA_DIR
# is unset — that fallback is for LOCAL DEV. In this image it resolves to an
# ephemeral /app/.data that is discarded on every deploy, which is correct:
# there is nothing left that needs to survive here.

# Run as a dedicated non-root user (defence in depth; least privilege).
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# The standalone bundle (traced node_modules + server.js) lands at the app root.
# --chown so the non-root user owns its runtime files.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
# static assets are NOT part of standalone — copy them to the path server.js
# expects (./.next/static) so hashed JS/CSS is served.
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
# public/ (brand assets, embed, geo) is also not part of standalone.
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# Checked-in Drizzle migrations, read at runtime by the boot migrator
# (src/instrumentation.ts). Standalone's file tracer only follows static
# imports, so runtime-read .sql files must be copied in explicitly.
COPY --from=build --chown=nextjs:nodejs /app/db/migrations ./db/migrations
# Operator scripts run INSIDE this container, via the Render dashboard Shell
# (`render ssh` needs a registered key and is interactive-only). They are kept
# in the image because they must run against the service's own environment —
# its R2 credentials and, while the disk existed, its mount. The image
# migration is finished (production had zero images on disk), but the script
# stays: it is the tool for verifying image parity if a disk is ever restored
# from a backup, and it costs a few KB.
COPY --from=build --chown=nextjs:nodejs /app/scripts ./scripts
# aws4fetch must be copied EXPLICITLY. The E15 epic assumed it would resolve
# from the standalone bundle's traced node_modules because blob-store.ts
# imports it statically — it does not. Next BUNDLES pure-ESM packages straight
# into the server chunks (verified: the AWS4-HMAC-SHA256 literal appears in
# .next/server/chunks/, and .next/standalone/node_modules/aws4fetch does not
# exist), so the app works while a standalone `import "aws4fetch"` would fail
# at runtime. `pg` survives tracing because it is CommonJS, which is why the
# migration script's optional record-value check needs no equivalent line.
# ~10 KB, and the migration cannot run without it.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/aws4fetch ./node_modules/aws4fetch

# Baked-in DB-IP City Lite geo database (CC-BY-4.0; src/lib/geoip.ts,
# docs/runbooks/GEOIP.md). Present at boot, so visitor geography works
# immediately with no runtime download and no license key. GEOIP_DB_PATH points
# the app straight at it; redeploy to pick up the next monthly release.
COPY --from=geoip --chown=nextjs:nodejs /geoip/db.mmdb ./geoip/dbip-city-lite.mmdb
ENV GEOIP_DB_PATH=/app/geoip/dbip-city-lite.mmdb

# No /data mount point and no VOLUME (E15 slice 3) — the persistent disk is
# gone. Declaring a VOLUME here would make any host that honours it re-create
# per-container storage and quietly reintroduce the stop-start deploy window.

USER nextjs

EXPOSE 3000

# Liveness+readiness: GET /api/health returns 200 only when Postgres answers;
# 503 otherwise (E15 — it no longer touches the filesystem, which is what let
# the disk be removed). The DB is a hard gate: a release started without a
# reachable DATABASE_URL never reports healthy.
#
# Since the disk was removed that gate finally does what it should — with no
# volume to hand over, the old instance keeps serving until the new one is
# healthy, so a bad release is HELD BACK instead of taking the site down.
# (While a disk was attached, only one instance could hold it, so Render had to
# stop the old container first and an unhealthy release meant a 502.)
# wget ships in alpine's busybox (no curl needed). -q silent,
# -O- to stdout; non-zero exit on HTTP failure (via --spider-less body fetch).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

# Standalone entrypoint (server.js at bundle root — verified for Next 16.2.10).
CMD ["node", "server.js"]
