# Documentation index

**July 2026.** Everything needed to build, run, maintain, improve, or
**re-create** the Explore Kingston platform — the mobile-first tourism app for
Kingston, Washington, built with the Greater Kingston Chamber of Commerce and
the companion to [explorekingstonwa.com](https://explorekingstonwa.com).

**Status:** Phase 1 is **deployed and live on Render**
(https://explore-kingston.onrender.com) — Next.js 16 in a Docker/standalone
image on a persistent disk, filesystem-mode state. A serverless Phase 2
(Vercel + Neon Postgres + Vercel Blob + Upstash) is built and ready but not
yet in use. Every store auto-detects its backend from which env vars are set.

These docs are written to survive a from-scratch rebuild: they state not just
*what* exists but *why*, and they carry the verified facts (ferry APIs, parking
rules, platform-sync feasibility) that were the expensive part to establish.

| Doc | What it answers | Read it when |
|---|---|---|
| [REQUIREMENTS.md](REQUIREMENTS.md) | What the system must do, for whom, and why — FR-numbered features (ferry planner, side-of-water, boarding-pass, maps CMS, content CMS, portals, analytics), NFRs (mobile-first flagged CRITICAL; persistence portability), acceptance criteria | Starting any change; evaluating scope; rebuilding |
| [SDD.md](SDD.md) | Code-level design — domain model, the dual-backend persistence seam, auth, all API routes + all pages, client-island state machines, algorithms (hours engine, ferry busyness, boarding-pass lapse), security posture, testing status | Modifying or debugging anything |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System structure, layer contracts, the load-bearing principles + ADR decision log (with rejected alternatives), deployment topology, honest debt list | Questioning "why is it built this way"; structural change |
| [MAPS.md](MAPS.md) | The map subsystem — the general multi-view map CMS (views + drawable features + built-in data layers), the `/admin/maps` builder, the parking-zone polygon editor (`/admin/map`), the specialized live ferry/SR-104 maps, and the street-parking overlay generator | Touching anything map-related |
| [DATA_SOURCES.md](DATA_SOURCES.md) | Every external data source — endpoints, access, cost, verified facts, gotchas (WCF dates, GTFS expiry 2026-09-12, WSF "Best Times" calibration, NWS/NOAA), self-collected ferry observations, Chamber action items, hosting/DNS plan | Touching any adapter; seasonal maintenance; new source |
| [SYNDICATION.md](SYNDICATION.md) | "Update once, everywhere" — the shipped feeds/embeds/JSON-LD, and the verified per-platform plan for Google / Apple / Yelp / Meta / TikTok | Building outbound integrations; setting member expectations |
| [OPERATIONS.md](OPERATIONS.md) | Runbook for the live deployment — setup, env vars, the `DATA_DIR` state tree + two backup layers, admin operations, DB-migration path, dated seasonal maintenance calendar, human action items, troubleshooting | Running the thing; onboarding an operator |
| [DEPLOY.md](DEPLOY.md) | Two-phase go-live — Phase 1 (persistent-disk host: Docker/Render/Fly, `DATA_DIR`, `/api/health`) which is the current live shape, and Phase 2 (Vercel serverless: Neon/Blob/Upstash, migration, DNS CNAME) | Deploying; planning the Vercel move |
| [ROADMAP-V2.md](ROADMAP-V2.md) | What shipped since v1 (DB seam, deploy, rate limiting, CMSs) vs the prioritized P0/P1/P2 backlog — mobile/PWA, ferry-forecast maturation, events ingest, tests/CI, a11y — plus keep/change guidance for a rebuild | Planning the next phase or a v2 rewrite |
| [COMPETITOR-BAINBRIDGE.md](COMPETITOR-BAINBRIDGE.md) | Teardown of go.visitbainbridgeisland.org (Lovable + Supabase stack, features, analytics capture) with an emulate/avoid/steal read against what Explore Kingston now ships | Benchmarking; deciding what to emulate |
| [GIT_SETUP.md](GIT_SETUP.md) | The public repo + personal-vs-arda identity separation, the repo-local credential helper, and that a push to `main` auto-deploys to Render | Git/GitHub account changes |

**Rebuilding from scratch?** Read in this order: REQUIREMENTS →
ARCHITECTURE (principles + decision log) → DATA_SOURCES (verified facts — do
not re-research what is already dated and sourced here) → SDD for any behavior
to preserve exactly → ROADMAP-V2's "if rebuilding" section for what to do
differently from day one (keep the seed+overlay stores, the dual-backend seam,
token-only theming, and the CMS layer; start with a database, a test suite, and
a PWA shell instead of retrofitting them).
