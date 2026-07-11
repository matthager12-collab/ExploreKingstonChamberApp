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
# Stage 3: runner — the lean runtime image that actually gets deployed.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# server.js reads these to bind the listener (verified in Next 16.2.10 docs).
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# All mutable runtime state resolves through src/lib/data-dir.ts -> DATA_DIR.
# On the persistent host this MUST point at the mounted volume (see /data below).
ENV DATA_DIR=/data

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

# Create the mount point for the persistent volume and hand it to the app user
# so the health probe's write test and all data writes succeed. On Render/Fly
# the disk is mounted here at runtime, shadowing this empty dir.
RUN mkdir -p /data && chown nextjs:nodejs /data
VOLUME ["/data"]

USER nextjs

EXPOSE 3000

# Liveness+readiness: GET /api/health returns 200 only when /data is writable,
# 503 otherwise. wget ships in alpine's busybox (no curl needed). -q silent,
# -O- to stdout; non-zero exit on HTTP failure (via --spider-less body fetch).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

# Standalone entrypoint (server.js at bundle root — verified for Next 16.2.10).
CMD ["node", "server.js"]
