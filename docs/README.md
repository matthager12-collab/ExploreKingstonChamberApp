# Documentation index

**July 2026.** Everything needed to build, run, maintain, improve, or
**re-create** the Explore Kingston platform — the mobile-first tourism app for
Kingston, Washington, built with the Greater Kingston Chamber of Commerce and
the companion to [explorekingstonwa.com](https://explorekingstonwa.com).

**Status:** Phase 1 is **deployed and live on Render**
(https://explore-kingston.onrender.com) — Next.js 16 in a Docker/standalone
image; since E05 all structured data lives in **Neon Postgres**
(`DATABASE_URL` required — health fails closed without it) and the persistent
disk holds images/hunt photos. A serverless Phase 2 (Vercel + Vercel Blob +
Upstash) is built and ready but not yet in use.

These docs are written to survive a from-scratch rebuild: they state not just
*what* exists but *why*, and they carry the verified facts (ferry APIs, parking
rules, platform-sync feasibility) that were the expensive part to establish.

| Doc | What it answers | Read it when |
|---|---|---|
| [REQUIREMENTS.md](REQUIREMENTS.md) | What the system must do, for whom, and why — FR-numbered features (ferry planner, side-of-water, boarding-pass, maps CMS, content CMS, portals, analytics), NFRs (mobile-first flagged CRITICAL; persistence portability), acceptance criteria | Starting any change; evaluating scope; rebuilding |
| [chamber/app-requirements/](chamber/app-requirements/00-README.md) | **Voice-of-customer requirements** — 13 Kingston business-leader personas each ask the Chamber for the app, consolidated into one prioritized request: the [consolidated request](chamber/app-requirements/03-CONSOLIDATED-REQUEST.md) (epics, non-negotiables register, matrix, phasing, metrics), [personas](chamber/app-requirements/01-PERSONAS.md), [per-business user stories](chamber/app-requirements/02-PERSONA-REQUESTS.md) (priority×cost, non-negotiables), [priority×cost matrix](chamber/app-requirements/04-PRIORITY-EXPENSE-MATRIX.md), and [per-epic implementation research](chamber/app-requirements/05-IMPLEMENTATION-RESEARCH.md) | Grounding scope in member needs; prioritizing; pitching the Chamber board or LTAC |
| [SDD.md](SDD.md) | Code-level design (dated snapshot — E05-superseded facts are marked inline) — domain model, persistence design, auth, all API routes + all pages, client-island state machines, algorithms (hours engine, ferry busyness, boarding-pass lapse), security posture, testing status | Modifying or debugging anything |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System structure, layer contracts, the load-bearing principles + ADR decision log (with rejected alternatives), deployment topology, honest debt list | Questioning "why is it built this way"; structural change |
| [MAPS.md](MAPS.md) | The map subsystem — the general multi-view map CMS (views + drawable features + built-in data layers), the `/admin/maps` builder, the parking-zone polygon editor (`/admin/map`), the specialized live ferry/SR-104 maps, and the street-parking overlay generator | Touching anything map-related |
| [DATA_SOURCES.md](DATA_SOURCES.md) | Every external data source — endpoints, access, cost, verified facts, gotchas (WCF dates, GTFS expiry 2026-09-12, WSF "Best Times" calibration, NWS/NOAA), self-collected ferry observations, Chamber action items, hosting/DNS plan | Touching any adapter; seasonal maintenance; new source |
| [SYNDICATION.md](SYNDICATION.md) | "Update once, everywhere" — the shipped feeds/embeds/JSON-LD, and the verified per-platform plan for Google / Apple / Yelp / Meta / TikTok | Building outbound integrations; setting member expectations |
| [OPERATIONS.md](OPERATIONS.md) | Runbook for the live deployment — setup, env vars, the `DATA_DIR` state tree + two backup layers, admin operations, DB-migration path, dated seasonal maintenance calendar, human action items, troubleshooting | Running the thing; onboarding an operator |
| [DEPLOY.md](DEPLOY.md) | Two-phase go-live — Phase 1 (Docker/Render/Fly + Neon Postgres, `DATA_DIR` disk for images, `/api/health`) which is the current live shape, and Phase 2 (Vercel serverless: Blob/Upstash, migration, DNS CNAME) | Deploying; planning the Vercel move |
| [ROADMAP-V2.md](ROADMAP-V2.md) | What shipped since v1 (DB seam, deploy, rate limiting, CMSs) vs the prioritized P0/P1/P2 backlog — mobile/PWA, ferry-forecast maturation, events ingest, tests/CI, a11y — plus keep/change guidance for a rebuild | Planning the next phase or a v2 rewrite |
| [KIOSK.md](KIOSK.md) | Software design for a fullscreen touch "kiosk mode" that replaces the third-party Qwick Tourist kiosk — the decision to build it as an in-app `(kiosk)` route group (not a separate app), routing/layout, the `KioskShell` client runtime, ISR-driven remote updates, offline/PWA, and the on-device Chromium-kiosk setup | Building the ferry-terminal kiosk; replacing Qwick |
| [KIOSK-POWER.md](KIOSK-POWER.md) | Hardware power budget + off-grid solar/battery feasibility for that kiosk at Kingston's latitude — mini-PC picks (12V-native), the display-dominates math, the PNW-winter solar reality (Dec ~1.3 sun-hours), a measured-wattage lookup table, and a straight power-drop-vs-solar verdict | Siting/powering the kiosk; sizing solar+battery |
| [COMPETITOR-BAINBRIDGE.md](COMPETITOR-BAINBRIDGE.md) | Teardown of go.visitbainbridgeisland.org (Lovable + Supabase stack, features, analytics capture) with an emulate/avoid/steal read against what Explore Kingston now ships | Benchmarking; deciding what to emulate |
| [VISION-LINESIDE-DELIVERY.md](VISION-LINESIDE-DELIVERY.md) | Long-range (late-2027) concept — deliver food to ferry-queue cars & events using the app's ferry-prediction moat; verified feasibility (regulatory gates, precedents, fulfillment, ownership), phased roadmap, and the **architecture seams to preserve now** so a pilot needs no rewrite | Making any architecture decision that could foreclose it; considering ordering/payment/precise-location changes |
| [FERRY-QUEUE-SENSING.md](FERRY-QUEUE-SENSING.md) | Standalone implementation plan (code-grounded, red-teamed) for crowd-sourced probe-GPS ferry-queue-length estimation — the "how long is the line right now" signal: queue-path geometry, self-mark + QR-anchor signs + behavioral fusion, the penetration-free gap-count + tail model, the **precise-in→aggregate-out→raw-discarded** privacy pipeline (k-anonymous), the dual-source blend into `scoreAt()`, and a phased rollout. Also the sensing layer the delivery vision needs | Building the live queue signal; touching precise location, the forecast blend, or the map CMS |
| [GIT_SETUP.md](GIT_SETUP.md) | The public repo + personal-vs-arda identity separation, the repo-local credential helper, and that a push to `main` auto-deploys to Render | Git/GitHub account changes |

**Rebuilding from scratch?** Read in this order: REQUIREMENTS →
ARCHITECTURE (principles + decision log) → DATA_SOURCES (verified facts — do
not re-research what is already dated and sourced here) → SDD for any behavior
to preserve exactly → ROADMAP-V2's "if rebuilding" section for what to do
differently from day one (keep the seed+overlay stores — Postgres-backed since
E05 — token-only theming, and the CMS layer; start with a database, a test
suite, and a PWA shell instead of retrofitting them — E05/E02 did exactly that
retrofit).
