# Documentation index

Everything needed to build, maintain, improve, or **re-create** the Explore
Kingston platform. Written July 2026 against the implemented v1.

| Doc | What it answers | Read it when |
|---|---|---|
| [REQUIREMENTS.md](REQUIREMENTS.md) | What must the system do, for whom, and why — every feature (FR-numbered), every quality bar (NFRs, mobile-first flagged CRITICAL), acceptance criteria | Starting any change; evaluating scope; rebuilding v2 |
| [SDD.md](SDD.md) | How it is designed at code level — domain model, persistence, auth, all 19 API routes, all 24 pages, client islands' state machines, algorithms, fails-soft catalogue, testing status | Modifying or debugging anything |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System structure, layer contracts, the 14 load-bearing decisions with rejected alternatives, deployment topology, honest debt list | Questioning "why is it built this way"; planning structural change |
| [DATA_SOURCES.md](DATA_SOURCES.md) | Every external data source: endpoints, access, costs, verified facts, gotchas (WCF dates, GTFS expiry, fare seasons), Chamber action items, hosting/DNS plan | Touching any adapter; seasonal maintenance; wiring a new source |
| [SYNDICATION.md](SYNDICATION.md) | The verified truth about pushing updates to Google / Apple / Yelp / Meta / TikTok, and the shipped feeds/embeds/JSON-LD | Building outbound integrations; setting business expectations |
| [OPERATIONS.md](OPERATIONS.md) | Runbook: setup, env vars, `.data/` backup/reset, deploy steps + blockers, the dated seasonal maintenance calendar, human action items, troubleshooting | Running the thing; onboarding an operator |
| [DEPLOY.md](DEPLOY.md) | Two-phase go-live: Phase 1 persistent-disk host now (Docker/Render/Fly, `DATA_DIR` volume, `/api/health`, DNS CNAME, backups); Phase 2 Vercel later (the store-module DB/blob migration seam) | Deploying to production; planning the Vercel move |
| [COMPETITOR-BAINBRIDGE.md](COMPETITOR-BAINBRIDGE.md) | Teardown of go.visitbainbridgeisland.org — its Lovable+Supabase stack, features, and exactly what it captures (GA4 + first-party view/QR analytics; location used client-side only) | Benchmarking; deciding what to emulate or avoid |
| [ROADMAP-V2.md](ROADMAP-V2.md) | Prioritized (P0/P1/P2) improvement backlog — mobile/PWA hardening first, DB migration, auth hardening, syndication adapters, quality engineering — plus keep/change guidance for a from-scratch rebuild | Planning the next phase or a v2 rewrite |
| [GIT_SETUP.md](GIT_SETUP.md) | Keeping this personal repo separate from the owner's work identity; 1Password-backed credentials | Git/GitHub account changes |

**Rebuilding from scratch?** Read in this order: REQUIREMENTS →
ARCHITECTURE (§2 principles + §7 decisions) → DATA_SOURCES (the verified
facts are the expensive part — do not re-research what is already dated and
sourced here) → SDD for any behavior you want to preserve exactly →
ROADMAP-V2 §10 for what to deliberately do differently (start on a
database, start with tests, PWA from day one).
