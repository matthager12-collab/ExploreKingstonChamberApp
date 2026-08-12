# Completion plan — closing the coalition epics

**Date: 2026-08-07 · Owner: Mat · Feeds from:
[STATUS-2026-08.md](STATUS-2026-08.md) (verified state vs. plan) and
[CODE-REVIEW-2026-08.md](CODE-REVIEW-2026-08.md) (build findings).**

Goal: close all 13 epics — and with them the 112 coalition user stories —
from [03-CONSOLIDATED-REQUEST.md](chamber/app-requirements/03-CONSOLIDATED-REQUEST.md),
while folding in the still-open ROADMAP-V2 items they overlap. 73 work items
were catalogued by the per-epic audits; this plan sequences them by what
actually gates them, not by the docs' (partly stale) phasing.

Sizes: **S** ≈ hours, **M** ≈ days, **L** ≈ week-plus.

---

## Track 0 — start immediately (gates everything else)

### 0a. External clocks — start now, they cost calendar time, not dev time

| Action | Why now | Gates |
|---|---|---|
| **Google Business Profile API application** — **fully unblocked, submit now**: the Chamber's GBP is confirmed claimed, managed by `director@kingstonchamber.com`, and past the 60-day verified-age gate (both confirmed 2026-08-07); apply from that address for the Cloud project below | Google-side review queue is the only remaining clock | GBP hours write + GBP event push (2 epics' final criteria) |
| **LTAC pre-clearance** (city/county attorney + LTAC committee) on the commerce modules | Legal review is slow; Phase 3 cannot start without it | Reservations/deposits, order-ahead (both P1 🔒 epics) |
| **Resend production config** (`RESEND_API_KEY` / `EMAIL_FROM` — code exists and silently no-ops today) | One ops task | Helper magic links, booked-customer notices, host drift nudges, owner digests |
| **Non-LTAC funding sign-off for resident mode** (Chamber general/membership dollars, separate accounting) | Bookkeeping precondition the docs make explicit | Entire resident epic |
| **Chamber content backfill** (coords/hours/walk-times for up-the-hill shops; Living-Here records; civic layers) | Staff time is the critical path, not code | Up-the-hill surface, resident mode |
| **Meta pilot recruitment** (≤50 tester businesses) | Needs willing owners + pilot app | Social event push |
| **GrowthZone term-end date established** | Engagement-level unmanaged risk (no export possible after termination) | Resident directory roster; membership re-charter |

#### GBP architecture decision (settled 2026-08-07)

Dual-mode auth, one adapter. The sync logic is identical in both models; a
token-provider seam picks the credential per listing (`chamber` | `owner`).

- **One External-type Cloud project**, created **inside the Chamber's
  `kingstonchamber.com` Workspace org** (confirmed on Workspace), Mat as
  project editor. Single API-access application, single OAuth verification.
- **Dedicated sync account** (e.g. `sync@kingstonchamber.com`, hardware-key
  2FA, used for nothing else) holds the runtime OAuth grant and is what
  members add as Manager — never `director@`, which submits the API
  application but stays out of the runtime path (role turnover + phishing
  exposure).
- **Manager-mode first:** works the day API access clears; the Chamber
  account tolerates the interim "unverified app" screen (no member sees it).
- **Owner-choice OAuth second:** portal "Connect Google" flow → demo video →
  `business.manage` sensitive-scope verification (no CASA; ~2–6 weeks) →
  publish → members may choose "connect your own Google" instead of the
  Manager grant. Search Console domain verification for
  `explorekingstonwa.com` + `kingstonchamber.com`; privacy-policy paragraph
  on Google user data.
- Sequence: API application → adapter dark (Manager mode) → owner-OAuth
  flow → verification → owner choice live. Nothing in it blocks Wave 1.

### 0b. Quality fixes from the code review — do before/alongside Wave 1

Full detail in [CODE-REVIEW-2026-08.md](CODE-REVIEW-2026-08.md). The ones
that block planned work or bite hardest in peak season (now — peak runs
through Sep 19):

1. **Takedown bug (high):** admin takedown silently leaves seed-backed
   listings publicly visible (`src/lib/moderation.ts:307`). A content-safety
   control that no-ops on most of the catalog. Small fix (tombstone instead
   of status flip) + test.
2. **Ferry-burst performance (high ×2):** home and `/ferry` are
   cookie-dynamic so their declared ISR is inert — every request is a full
   server render; and `getEmpiricalBusyness()` full-scans ~52k observation
   rows in JS on `/ferry`'s request path. Fix both before the next busy
   weekend.
3. **Forecast measurement fix (medium ×2, but load-bearing):** the empirical
   busyness table and the accuracy backtest both grade per-snapshot instead
   of per-sailing, biasing the forecast light and misreporting bias/MAE.
   **The staffing-alerts accuracy gate cannot honestly clear until this is
   fixed.** Fix, then let the daily backtest cron re-accumulate a verdict.
4. **Fast-ferry GTFS expiry guard (medium):** the hard-coded Kitsap timetable
   expires **2026-09-12** with no guard — five weeks away. Add the expiry
   check + honest fallback label now.
5. Batch next: spoofable X-Forwarded-For rate-limit/geo keys, unbounded
   upload buffering, `React.cache()` request-dedup, portal API fork
   (nonprofit events lost recurrence), timing-safe token compares.

---

## Wave 1 — unblocked, code-only (closes the bulk of the P0 epics)

Everything here has **no external dependency** and builds on proven seams.
Grouped as coherent workstreams; epic + size in brackets. Shared items are
listed once and credited to both epics.

### W1.1 Hours truth chain *(closes most of accurate-hours + part of portal epic)*
- Per-listing same-day override — "closed today / closing early / out of
  fuel" — cloning the boarding-pass Pacific-midnight auto-expiry store, with
  one-tap portal toggle [M] *(shared: hours epic + portal epic)*
- Holiday-closure exceptions on the hours record + editor [S]
- Staleness gate on the public open-now badge and walk-time line
  ("Hours unverified — call ahead · last checked [date]") [S]

### W1.2 Portal delegation & simplicity *(ten-second-portal epic)*
- Owner-minted scoped helper invites + one-tap revoke [M]
- Magic-link redeem/sign-in for helpers [M] *(needs 0a Resend)*
- Field-level scope enforcement (hours & status only) [M]
- Service-business profile template (area served, contact, status line) [M]
- Ruthless mobile-simplicity pass on the portal editors [M]
- Recurrence + skip-date controls in the nonprofit editor [S]
  *(also fixes the forked nonprofit events API — see code review)*

### W1.3 Events to authoritative *(post-once-syndication epic)*
- Expand recurring events on public surfaces (or flip at E15 cutover) [S]
- Live event pins on the town map [M]
- Self-service posting path for service businesses [M]

### W1.4 Ferry-timed visitor surfaces *(foot-traffic epic, forecast-gate-independent half)*
- Vessel-ETA-to-forecast join ("boat lands in ~N min") [S]
- Just-arrived visitor surface: open-now nearby + "get back before your
  return ferry" framing [M]
- Owner arrivals board (back-office tablet view, ETA column only) [M]
- Rush-vs-schedule view exposed to owners as preview [S]

### W1.5 Truck & tap status *(realtime-status epic — net-new but small)*
- Mobile-vendor listing type + `todayStatus` overlay store [M]
- One-thumb "Set today" vendor form [M]
- Map renders live truck pins, drops non-today statuses [S]
- Taproom tap list: schema, portal editor, public render [M]
- "Food truck today" slot + cross-promo render on host venue [M]
  *(shared: cross-promo epic)*
- Midnight/DST propagation test coverage [S]

### W1.6 Cross-promotion *(cross-promo epic)*
- Member-controlled "pairs well with" links + confirmed reciprocity [M]
- Typed itinerary stops + Chamber "evening in Kingston" bundles [M]
- Lodging "stay + do" suggestion on /stay [S]

### W1.7 Guest guide *(guest-concierge epic — its stated blocker is already shipped)*
- Guest-guide record type + portal private-fields editor [M]
- `/g/[unit-slug]` public guide route [M]
- Offline caching of the guide route (extend `public/sw.js` within its
  contract test, by design decision) [M]
- QR poster generator + printable poster [S]
- Host drift-nudge email [S] *(needs 0a Resend)*

### W1.8 Alerts, minus push *(trusted-alerts epic)*
- Sourced town-status feed: `/alerts` page + home banner with WSDOT Highway
  Alerts + NWS active-alerts adapters (visible source + timestamp, no login) [M]
- Owner-fired cancellation flow, day-scoped, auto-expiring [M]
- Booked-customer notification path, email first [M] *(needs 0a Resend;
  full scope arrives with bookings in Wave 3)*

### W1.9 Analytics & LTAC evidence *(analytics epic + FR-15.5)*
- Per-listing engagement attribution + tracked action buttons [S]
  *(ship early — history accumulates from ship date)*
- Owner-facing monthly summary in the portal [M]
- Ferry-arrival correlation + local-vs-visitor split (uses observed
  arrivals, not the gated forecast) [M]
- One-click LTAC/grant export, CSV + printable, date-range [M]
- Volunteer signups/check-in wired into nonprofit portal, hours derived [M]
  *(closes stray story US-3)*
- Overnight headline anchored to paid lodging [S]

### W1.10 Resident mode, unblocked half *(resident epic; needs 0a funding sign-off first)*
- `/living` resident home + persistent "I live here" toggle [M]
- Structured Living-Here relocation records with lastVerified + editing [M]
- Log WSF service alerts + cancelled sailings into the observation store [S]
  *(starts the winter dataset the commute page needs)*
- Broker open-house posting to calendar/map [S] *(needs fair-housing-safe
  posting policy text)*

### Wave 1 stray stories
- SNAP/EBT + matching-dollars info on the market listing [S] *(FM-3)*
- Fold HB-6 (big high-contrast text) into the roadmap accessibility audit
  pass, run against every Wave 1 surface as it ships.

**Wave 1 milestone:** the five Phase-1 P0 epics reach done-except-GBP;
truck/tap, cross-promo, and guest-guide close entirely; alerts and analytics
reach ~80%. By story count this closes the majority of the 46 P0 stories.

---

## Wave 2 — externally gated (start as each gate opens)

| Item | Size | Gate (from Track 0) |
|---|---|---|
| GBP one-way hours write adapter behind a flag — dual-mode token seam per the 0a architecture decision | L | GBP API access (application unblocked 2026-08-07) *(closes accurate-hours final criterion)* |
| GBP event push with pending-edit read-back | (same adapter) | GBP API access |
| Owner-choice "Connect Google" portal flow + OAuth app verification (demo video, sensitive-scope review) | M | Manager-mode adapter live; no member-facing rollout until verification clears |
| Meta social-push pilot (FB Page + IG, ≤50 testers) | M | Meta pilot app + recruits |
| Web push (VAPID) delivery — relax `sw-contract.test.ts` by decision | L | Product decision; shared by alerts "minutes" promise, staffing heads-up, pre-boat nudge, ferry reminders phase 2 |
| Owner staffing heads-up (opt-in, threshold, lead time) | M | Forecast accuracy gate — **after** the Track 0 measurement fix clears the backtest |
| Enable `/ferry/plan` publicly (flip prediction flag) | S | Same accuracy gate |
| Honest ferry-commute reality page | M | Winter of logged cancellation data (W1.10 starts the clock) |
| Public resident-serving directory surface | M | GrowthZone roster export + sign-off to lift the E17 no-public-surface non-goal |
| Generalized public "Place" type + up-the-hill discovery surface | L | Chamber content backfill |
| Deterministic fair-rotation featured placement | M | Most valuable after the Place type exists |
| Ferry-slack "explore beyond the dock" nudge + quick loops | M | Place data |
| Light community board (submission/moderation/expiry) | M | Turnstile keys + published moderation policy |
| Resident perks + visitor-to-resident bridge cards | S | /living shipped |
| Digital loyalty punch card + resident perk | L | None hard — schedule by appetite |

**Wave 2 milestone:** every P0 epic fully closed; all Phase-1/2 epics done;
only commerce remains.

---

## Wave 3 — commerce (only after LTAC pre-clearance)

Sequenced last on cost and legal exposure, exactly as the coalition asked.
Public money stays on the platform layer; deposits ride each owner's own
processor; no percentage-of-sale fees anywhere.

**Reservations & deposits** *(epic, ~6 items)*: booking data model + portal
Bookings tab [M] → public booking flow with "seats now vs. reserve later" [M]
→ 21+ age-gate with audit trail [S] → Stripe Connect (owner's own account,
manual-capture holds) [M] → owner calendar sync, iCal feed then Google OAuth
write-back [M].

**Ferry-timed order-ahead** *(epic, ~5 remaining)*: ready-by timing advisor +
disruption kill-switch [S] *(no external dep — can even land in Wave 1)* →
merchant order-ahead setup in portal [M] → discovery UI with ready-by times
on /eat and /line [S] → structured pre-order request fallback [M] → opt-in
pre-boat push nudge [via Wave 2 web push].

Booking cancellations then complete the alerts epic's "notifies everyone
booked" criterion.

**Wave 3 milestone:** all 13 epics closed; all 112 stories closed or
explicitly honored-by-design (CW-7, US-6); US-4 (membership/donation) hands
off to the E16/E19 membership re-charter under
[ROLLOFF-GROWTHZONE.md](ROLLOFF-GROWTHZONE.md).

---

## Effort rollup

73 catalogued items: 23 S / 44 M / 6 L, with ~4 shared across epics. At
S≈½ day, M≈2–3 days, L≈1–2 weeks: **roughly 30–40 solo dev-weeks** end to
end, before Track 0b quality fixes (~2 weeks). Wave 1 alone is ~18–22
dev-weeks; it contains most of the value and none of the external risk.
Treat these as planning-grade ranges, not commitments.

## Suggested first fortnight

1. Track 0a letters/applications out (GBP, LTAC, Resend keys, funding
   sign-off ask, GrowthZone date).
2. Track 0b items 1–4 (takedown fix, burst perf, forecast measurement fix,
   GTFS guard) — all small, all high-leverage, one PR each.
3. W1.1 hours truth chain — the single highest-trust, lowest-cost epic
   advance, and the coalition's #1 non-negotiable.
4. W1.9 attribution [S] — ship early so analytics history accumulates while
   everything else builds.
