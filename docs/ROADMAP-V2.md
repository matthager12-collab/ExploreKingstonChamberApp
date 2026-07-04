# Roadmap v2 — improvement backlog

Backlog for evolving this codebase (or re-creating it — see §10). Written
July 2026. Every item carries a priority and a one-line rationale:

- **P0** — blocks real users or protects irreplaceable data/trust
- **P1** — should land within the next season of work
- **P2** — valuable, defer until P0/P1 are done

Cross-references: [OPERATIONS.md](OPERATIONS.md) (deploy blockers),
[DATA_SOURCES.md](DATA_SOURCES.md), [SYNDICATION.md](SYNDICATION.md).

---

## 1. Mobile-first hardening (CRITICAL — owner-flagged)

The primary user is a phone on Highway 104, often in the ferry line
(REQUIREMENTS.md). This section outranks everything except data persistence.

**What exists today:** fixed bottom nav bar + "More" sheet on mobile
(`src/components/site-nav.tsx`), responsive grids throughout, pages written
mobile-first, tap-friendly ferry board. Solid baseline — not the v2 bar.

**The v2 bar:**

- **P0 — PWA manifest + service worker caching the ferry schedule and tide
  data for offline.** The killer feature: schedule access **on the boat**
  and in the SR 104 dead zones with no signal. Cache the fallback schedule,
  last-fetched live sailings, and today's tides; show a clear "cached as of
  HH:MM" honesty label (consistent with the app's `live: false` pattern).
- **P0 — safe-area insets for the bottom nav.** The bar is
  `fixed inset-x-0 bottom-0` with no `env(safe-area-inset-bottom)` padding —
  on notched/home-indicator phones the tap targets sit under the indicator.
- **P0 — Lighthouse mobile performance budget: LCP < 2.5 s on throttled
  4G.** The full-bleed hero (`/brand/photo-kingston-37.jpg` on the home
  page) is the current risk — serve responsive sizes (`next/image` with
  `sizes`, priority hint on the hero only) and re-measure. Add the budget to
  CI (§8) so it can't regress silently.
- **P1 — 44px minimum touch-target audit.** Sweep every interactive element
  (nav icons, badge chips, sailing rows, portal form controls) against the
  44×44 CSS-px floor; fix by padding, not font size.
- **P1 — thumb-zone placement for primary CTAs.** The one action per page
  (Ferry: next sailing; Eat: call/order; Hunt: submit photo) belongs in the
  bottom third of the viewport, not behind a scroll-back-up.
- **P1 — form input types / `inputmode` audit.** Portal + survey + hunt
  forms: `type="email"`, `inputmode="numeric"` for zips/counts,
  `autocomplete` attributes — keyboard correctness is cheap mobile UX.
- **P1 — real-device test matrix.** Minimum: iOS Safari (current + one
  back) and Android Chrome on a mid-range device; test the camera capture
  path inside the Facebook/Instagram in-app browsers specifically (that's
  where Chamber promotion lands — see DATA_SOURCES §11).
- **P1 — installability.** Once manifest + SW exist, verify the install
  prompt and iOS Add-to-Home-Screen (icons, splash, standalone display).
- **P2 — `prefers-reduced-motion` support.** Guard any transitions/embeds;
  small effort, accessibility win.
- **P1 — ferry reminders, phase 2: web push.** Phase 1 shipped (commit
  `376d4f8`): per-sailing opt-in on the home widget — a calendar `.ics` link
  that drops the sailing (with a 20-min alarm) into any phone's calendar, plus
  an in-page browser notification while the tab is open. Code:
  `src/lib/ferry-reminder.ts`, `src/app/api/ferry/reminder/route.ts`,
  `src/components/next-ferries.tsx`. **Phase 2 = notifications that fire when
  the app is closed.** Depends on the PWA manifest + service worker (the P0
  above), then adds: VAPID keys, a push-subscription store (privacy-review the
  endpoint before shipping), and a scheduler to send ~20 min before departure
  (e.g. a Render cron scanning armed subscriptions). iOS only delivers web
  push to an installed PWA. This was the deliberately-deferred half of the
  "both, phased" decision (2026-07-03).
- **P2 — ferry reminders polish (phase 1 follow-ons).** All optional: surface
  the 📅/🔔 controls on `/ferry` too (home-only today); add fast-ferry
  (Seattle) reminders (car ferry only today); a lead-time choice (15/30/60 min
  vs the fixed `REMINDER_LEAD_MIN = 20`); a one-line discoverability hint above
  the sailing rows.

## 2. Data layer v2 — Postgres/Supabase migration

- **P0 — migrate every file store to Postgres (Supabase or Vercel
  Postgres).** File stores don't persist on serverless; this is deploy
  blocker #1 in OPERATIONS §3. The store modules are the seam — swap
  internals, keep exports. Mapping:

  | File today | Table(s) |
  |---|---|
  | `.data/auth/users.json` | `users` |
  | `.data/auth/invites.json` | `invites` |
  | `.data/stores/restaurants.json` | `restaurant_overrides` (keep seed-merge semantics: overlay wins by id, tombstone deletes) |
  | `.data/stores/events.json` | `event_overrides` |
  | `.data/stores/charities.json` | `charity_overrides` |
  | `.data/stores/volunteer-needs.json` | `volunteer_need_overrides` |
  | `.data/hunts/custom-hunts.json` | `hunts` + `hunt_stops` |
  | `.data/hunts/submissions.jsonl` | `hunt_submissions` |
  | `.data/hunts/refs/`, `.data/hunts/photos/` | object storage (Supabase Storage / Vercel Blob), path in the row |
  | `.data/analytics/events.jsonl` | `analytics_events` (indexed on ts + type) |
  | `.data/ltac-responses.jsonl` | `survey_responses` |

- **P1 — audit log for portal edits.** Who changed what, when, old → new
  values, on every overlay write. The Chamber will want it the first time a
  listing is edited wrong; trivial to add at the `writeOverlayRecord`
  choke point during migration, painful to retrofit.
- **P1 — backups become the DB's job.** Managed Postgres point-in-time
  recovery replaces the `.data/` tar cron; document the restore drill and
  actually run it once.

## 3. Auth v2

- **P0 — rate limiting** on login and invite redemption (per-IP + per-email,
  exponential backoff). Unlimited online guessing against scrypt hashes is
  the portal's biggest exposure (deploy blocker #2).
- **P1 — password reset via Resend magic links.** Today a forgotten
  password means an admin manually re-inviting; Resend is already the
  planned invite-email channel (SYNDICATION §Email), reuse it.
- **P1 — session revocation list.** Sessions are stateless HMAC cookies;
  the only kill switch is rotating `AUTH_SECRET` (logs out everyone). A
  small `revoked_sessions` table (or session-version column per user)
  enables single-account logout after the DB migration.
- **P1 — CSRF hardening.** State-changing portal routes currently lean on
  `SameSite=Lax` alone; add origin checks or CSRF tokens on POSTs.
- **P2 — optional passkeys.** Nice for a non-technical business audience
  (no password to forget), but only after reset + revocation exist.

## 4. Syndication v2 (from SYNDICATION.md — priorities restated)

- **P1 — Google Business Profile adapter first**, behind a feature flag,
  Chamber-as-Manager auth model (one Chamber OAuth covers every listing).
  Hours via Business Information API v1 `PATCH`; posts via legacy v4
  `localPosts`. **Build the pending-edit read-back loop** (`hasPendingEdits`)
  — edits can sit in moderation, and silent failure would destroy the
  "update once, everywhere" promise. Gated on the Chamber's API-access
  application (OPERATIONS §5 item 3); batch each save into one patch
  (10 edits/min/profile cap).
- **P1 — Meta pilot, ≤ 50 tester businesses.** Business-type app gets
  Standard Access with no review; pilot Page/IG posting with 2–3 real
  businesses, measure appetite before committing to Advanced Access review
  (multi-week, screencasts). Build posting-failure alerts — long-lived Page
  tokens die on password change.
- **P2 — Apple Business application.** Submit early (it's free and the
  timeline is unknown), integrate later.
- **Never — Yelp.** No public write API at any tier; the biz.yelp.com deep
  link on `/portal/syndicate` is the permanent answer. Do not promise it to
  businesses.

## 5. Events v2

- **P1 — GrowthZone iCal ingest** (the Chamber's real calendar at
  business.kingstonchamber.com). Blocked on the 10-minute feed-existence
  check (OPERATIONS §5 item 6); parse VTIMEZONE properly, expand RRULEs,
  dedupe on normalized title + start date, prefer the Chamber record.
- **P1 — The Events Calendar REST API on explorekingstonwa.com as a feed
  source.** Verified live (`/wp-json/tribe/events/v1/`) and the Chamber
  already controls it — a machine-readable feed with zero new vendor
  relationships, candidate to replace `src/lib/data/events.ts` seeds.
- **P1 — recurring-event model.** The seed currently duplicates each
  occurrence as its own record (`public-market-2026-07-05`,
  `public-market-2026-07-12`, …) — fine for a season, unmaintainable for a
  year. Store recurrence (RRULE or weekday+window) and expand at read time;
  the deconfliction check must see expanded occurrences.

## 6. Analytics v2

- **P0 — DB-backed store** (rides the §2 migration; `summarize()` currently
  re-reads the whole JSONL per call — fine at file scale, not after).
- **P1 — dashboard time-series.** Daily/weekly trends per page and outbound
  target, not just totals — "did the ferry-line QR campaign work" is a
  time-series question.
- **P1 — LTAC report export (CSV/PDF) aligned to JLARC categories.** The
  whole reporting story: one click produces the calendar-year summary in
  the six JLARC metric groups (Predicted/Actual/Method/Explain — see
  DATA_SOURCES §12) so the Chamber's submission to Kitsap County is
  copy-paste. Mirror the current-year portal form, not the 2018 PDF.
- **P1 — bot filtering.** JSONL counts currently include every crawler that
  executes JS; filter obvious bots (UA heuristics at ingest, honeypot
  paths) or the LTAC numbers overstate and can't be defended.
- **P1 — k-anonymity floor on area counts.** Never publish a named-area
  geo-ping bucket with fewer than k (say 5) distinct sessions — small-town
  counts of 1 are re-identifiable, and the privacy posture is the feature.

## 7. Content v2

- **P1 — photo pipeline for listings.** Portal upload → validate → resize
  to fixed variants → object storage → `next/image`. Reuses the hunt
  photo-handling patterns; unlocks businesses owning their imagery (OTA
  photos are copyrighted — DATA_SOURCES §8).
- **P1 — lodging booking-link maintenance.** Weekly link-checker over
  ordering/menu/lodging URLs (status + TLS — it would have caught
  cellarcat.com), with a manual-review flag list for hosts that block bots
  (Toast, DoorDash 403; Skunk Bay 406; Airbnb maybe) instead of auto-fail.
- **P2 — menus as structured data with restaurant approval workflow.**
  Owner-approved, transcribed menus with an update contact per venue — the
  only legal, accurate source (platform APIs are closed). Gated on the
  Chamber's partnership workflow (DATA_SOURCES action item 4), so build the
  schema, don't force the content.
- **P2 — itinerary builder from live data.** Compose itineraries from
  what's actually open (the hours engine already answers open-now) plus
  sailing times — "you have 90 minutes until your boat" is the magic
  Kingston use case. Rebuild seeds as composable blocks first.

## 8. Quality engineering

There are currently **zero tests and no CI** — `npm run lint` is the whole
gate.

- **P0 — hours-engine golden tests, including DST transitions.**
  `src/lib/hours.ts` + `src/lib/time.ts` drive the open-now badges (the
  most trusted pixel in the app) and contain the subtlest logic:
  midnight-crossing spans, yesterday's tail, PDT/PST offset resolution.
  Fixed-clock golden cases incl. the March/November changeover nights.
- **P0 — CI via GitHub Actions:** `tsc --noEmit` + `eslint` + tests +
  `next build` on every push. The build step alone catches the Next 16
  breaking-change class of error this repo's AGENTS.md warns about.
- **P1 — store merge tests** (`json-store.ts`): overlay-wins-by-id,
  tombstone hiding, corrupt-file fallback to seed.
- **P1 — auth tests:** invite lifecycle (mint → redeem → reuse rejected),
  password verify, session token expiry/tamper, and the **`canEdit`
  matrix** (role × linkedIds — the entire portal authorization model is
  that one function).
- **P1 — ICS output tests:** validate `/api/feeds/events?format=ics`
  against an RFC 5545 parser; calendar subscribers are silent failers.
- **P1 — error monitoring (Sentry free tier).** Adapters fail silent by
  design (`return null`) — great UX, invisible ops. Report the catch paths.
- **P1 — uptime check on `/api/ferry/status`** (UptimeRobot-class, free):
  the single endpoint whose failure most damages trust, and it can degrade
  to fallback without anyone noticing.

## 9. Accessibility

- **P1 — full audit pass:** heading hierarchy per page, visible focus
  states on all interactive elements (including the bottom nav and More
  sheet), landmark roles, contrast against the brand palette.
- **P1 — formalize the map's keyboard/screen-reader alternative.** The
  parking **zone list is already the fallback** — every zone the Leaflet
  map shows exists as list content. Make that contract explicit: label the
  map `aria-hidden`-plus-summary or provide a skip link, and add a test
  that every mapped zone appears in the list.
- **P1 — color-only meaning on the map needs text labels.** Street-parking
  rules are color-coded (free-2hr / prohibited / ferry-holding…);
  colorblind users need the rule as text in the popup/legend pairing, not
  hue alone.
- **P1 — alt-text pass** over brand photography and webcam images (webcams
  should convey location + snapshot age).

## 10. If rebuilding from scratch

What five months of this codebase proved out — and what to do differently
on day one of any v2 rewrite.

**Keep (proven):**

- **Adapter isolation with honest degradation.** UI never fetches external
  services; every adapter returns `{ live: boolean }` and the UI labels
  non-live data. This is why WSDOT flakiness never breaks the site.
- **Seed + overlay editability.** Typed seed files the Chamber can read,
  with portal edits overlaid by id — git-reviewable content *and* live
  editing, no CMS.
- **Token-only theming.** Brand palette/fonts as design tokens matching
  explorekingstonwa.com — restyles never touch component code.
- **Honesty labels** ("not live", "call first", "signs on the pole win") —
  trust is the product in a town this size.
- **The verified-data workflow.** DATA_SOURCES.md's verify-then-publish
  discipline with `lastVerified` dates and load-bearing gotchas is worth
  more than any integration; keep maintaining it.

**Change from day one:**

- **Start on Postgres.** The file stores were the right local-first call
  but every one of them is now a migration (§2); a rebuild starts on
  Supabase with the same store-interface seam.
- **Start with tests + CI.** The hours engine and store merge logic should
  never have existed untested (§8).
- **PWA from the start.** Offline-on-the-boat is the defining mobile
  feature (§1); service-worker architecture is much cheaper before the
  routes ossify.
- **Image pipeline from the start** — every listing photo through
  upload/resize/`next/image` from the first commit (§7), no hotlinked or
  unoptimized brand images.
- **i18n-ready strings if Spanish support is desired.** Extract
  user-facing strings behind an i18n layer on day one — retrofitting ~40
  pages of prose is the expensive path; deciding *whether* to translate
  can wait, string extraction can't.
