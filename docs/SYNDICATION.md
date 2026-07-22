# Syndication — update once, propagate everywhere

_July 2026. Sibling docs: [SDD.md](SDD.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [DATA_SOURCES.md](DATA_SOURCES.md) · [OPERATIONS.md](OPERATIONS.md) · [ROADMAP-V2.md](ROADMAP-V2.md) · index in [README.md](README.md)._

The promise of the member portal is "a business edits its hours/events **once**, and
that change reaches the rest of the internet." This doc is the honest state of that
promise: what ships live in the code today, what is wireable next (with the platform
gates researched against primary developer docs, adversarially fact-checked
2026-07-02), and what is a hard "no." We keep the project's ethos: **never label a
non-live thing as live, and never promise a platform we cannot actually reach.**

Everything below reads the same canonical seed+overlay stores the public site reads
(see [ARCHITECTURE.md](ARCHITECTURE.md) for the persistence seam) — there is no
separate export pipeline to drift out of sync.

---

## 1. Shipped and live today

| Surface | Route / file | What it does |
| --- | --- | --- |
| The site itself | store overlay + ISR | Portal edits go live on Explore Kingston pages within a minute (overlay write wins by id; pages revalidate). |
| Events JSON feed | `GET /api/feeds/events` | All upcoming events (not-yet-finished), machine-readable. `?owner=<id>` filters to one listing/org (matches `ownerId` **or** `charityId`). |
| Events calendar feed | `GET /api/feeds/events?format=ics` | RFC 5545 iCalendar; subscribe from Google Calendar ("From URL") or Apple Calendar ("New Calendar Subscription"). `?owner=` supported. |
| Website embed | `GET /embed/kingston-events.js` | Paste-in `<script>` that renders a business's (or the whole town's) events. Zero-dependency, self-styling, self-removing on failure. |
| Business listing JSON | `GET /api/feeds/business/<id>` | Name, address, phone, hours, `weeklyHours`, `hoursVerified`, links, plus a **server-computed `openNow` / `openLabel`** — a business's own site can poll it so hours never drift. |
| Search structured data | `components/json-ld.tsx` (`LocalBusinessJsonLd`) | schema.org `Restaurant` + `openingHoursSpecification` JSON-LD, emitted per restaurant. |
| Manual syndication hub | `/portal/syndicate` | All of the above wired into copy-paste blocks, an honest big-platform checklist, and a social composer. |

### Feed details (verified against code)

- **CORS-open on purpose.** Both feed routes and the business-JSON route send
  `Access-Control-Allow-Origin: *` — the embed script and any business's own site
  fetch them cross-origin. These are public reads only.
- **Caching.** Events feed: `s-maxage=300, stale-while-revalidate=600`. Business JSON:
  `s-maxage=60` (open/closed flips on minute boundaries; the rest of the payload
  rarely changes).
- **iCal is correct, not hand-wavy.** `route.ts` folds content lines at 75 octets
  (UTF-8-safe, never splits a multibyte char), escapes TEXT values per §3.3.11, and
  emits UTC stamps so no `VTIMEZONE` block is needed (`X-WR-TIMEZONE` is a display
  hint). `URL` is emitted as a URI value type (unescaped), TEXT fields escaped.
- **`openNow` is real math.** `/api/feeds/business/<id>` runs the same
  `getOpenStatus(weeklyHours)` used by the site's live open/closed badge (see
  `src/lib/hours.ts`); returns `null` when a listing has no structured `weeklyHours`.
- **Embed knobs.** `kingston-events.js` reads `data-owner` (omit → whole-town
  calendar), `data-limit` (default 5), and `data-heading` (`""` hides it; default
  "Upcoming in Kingston"). It derives the feed origin from its own `src`, so the same
  snippet works on any host.

### JSON-LD — scope and honest caveats

- Typed as `Restaurant` (a schema.org `LocalBusiness` subtype), with
  `openingHoursSpecification` (one spec per open span per day; closed days omitted),
  `PostalAddress` parsed from the single-string listing address (Kingston/WA
  fallbacks, zip end-anchored so a street number is never mistaken for it),
  `GeoCoordinates`, `telephone`, `servesCuisine`, `priceRange`, `hasMenu`.
- **Currently wired only on `/eat`** (`src/app/(site)/eat/page.tsx` imports and renders
  `LocalBusinessJsonLd` per restaurant). The component is deliberately page-agnostic —
  any listing page can import it — but today the restaurant grid is the only caller.
  Lodging/nonprofit pages do not emit JSON-LD yet.
- This is an **hours signal to Google/Bing/Apple crawlers, not a write API.** It
  complements — never overrides — a business's Google Business Profile.

### `/portal/syndicate` — what a member sees

Server component (only interactivity is the delegated-click Copy buttons). Admins see
**all** listings plus a town-wide "All Kingston events" card; members see only the
listings their account is linked to (`user.linkedIds`). Three sections:

1. **Live feeds** — per-listing copy blocks for the JSON feed, iCal subscription,
   embed snippet, and (businesses only) the listing JSON with open-now. URLs are built
   absolute from the request host/proto, so they copy-paste correctly in dev and prod.
2. **Update the big platforms** — a **Callout that states plainly there is no
   auto-sync yet**, then each listing's current hours ready to paste, plus deep links
   to Google Business Profile, Apple Business Connect, Yelp for Business, and Bing
   Places with a one-line tip each. This is the honest "5-minute manual round."
3. **Post it to socials** — a prewritten post per upcoming event the member manages,
   with Facebook/X share links and a note that Instagram/TikTok take copy-paste only.

> The "no auto-sync yet" copy on this page is the source of truth members read. Keep it
> in step with reality: the moment the GBP adapter (below) ships, that Callout changes.

---

## 2. Wireable next (verified per-platform plan)

Priority order. Every gate below was checked against the platforms' own developer
docs; timelines are Chamber calendar-time, not engineering effort.

### 2.1 Google Business Profile — YES, free, two gates

- **Hours/description:** `PATCH` via **Business Information API v1**
  (`updateMask=regularHours,...`, `validateOnly` for a dry-run).
- **Posts/events:** the **legacy v4 `localPosts`** endpoint — never migrated but
  actively maintained (recurring posts shipped Apr 2026).
- **Gate A — API access application:** the *Application for Basic API Access* form.
  The Chamber needs its **own verified GBP, 60+ days old**, and applies from an
  owner/manager email. Days-to-weeks; the APIs are invisible until approved.
- **Gate B — auth model:** use the **Chamber-as-Manager** model. Each business adds
  the Chamber's Google account as a **Manager** of its profile (Google's own partner
  FAQ recommends this), so **one Chamber OAuth covers every listing** and we skip
  per-owner OAuth verification entirely.
- **Gotchas:** 10 edits/min/profile hard cap (batch each save into one patch); edits
  can land as pending moderation (`hasPendingEdits` — build a read-back loop); a
  newly added Manager faces a ~7-day cooldown.

### 2.2 Meta (Facebook Pages + Instagram) — YES, pilot-first

- **No app review for a pilot:** a Business-type app gets Standard Access for all
  permissions automatically, valid for accounts with a role on the app — up to **50
  tester businesses** on an unlinked app.
- **Path:** create the Meta app → add pilot businesses as Testers → each connects
  their Page (`pages_manage_posts`) and/or IG professional account
  (`instagram_content_publish`, or the Instagram-Login flavor
  `instagram_business_content_publish`, which sidesteps the "IG must be linked to a
  Page" trap).
- **Scale phase:** Chamber Business Verification + Advanced Access review **per
  permission** (screencasts; multi-week). Pilot API usage is a review prerequisite, so
  pilot-first is the correct order.
- **Facts to plan around:** **no Facebook Events API** (announce events as feed posts
  only); IG is JPEG-only, 100 API posts/day; long-lived Page tokens don't expire but
  **die on password change** — build posting-failure alerts.

### 2.3 Apple Business — application required

Apple Business Connect merged into "Apple Business" (Mar 2026). A real free write API
for hours/details exists, but access is a **partner/third-party application**, not
self-serve. The Chamber registers an Apple Business account and applies as a
third-party listing manager. Worth submitting early; timeline unknown. (Members can
already self-serve via the Apple Business Connect deep link on `/portal/syndicate`.)

### 2.4 Bing Places — agency path

Register the Chamber as a Bing Places **agency** managing client listings. Bing can
also import/sync from a connected GBP, so a solid Google pipeline covers much of Bing
for free.

### Yelp — NO. Do not promise it.

No public write API for anyone (Fusion is read-only and now paid after a 30-day trial;
listing management is enterprise-partner-only, Yext-class). The `biz.yelp.com` deep
link on `/portal/syndicate` is the permanent answer unless Yelp changes policy.

### TikTok — defer

Content Posting API before audit forces posts private (`SELF_ONLY`) on private
accounts, max 5 posting users/day — a hard veto for v1. Copy-paste composer only.
Revisit only if the Chamber wants to run the ~1.5-month app-review + audit gauntlet.

---

## 3. Email (portal invites / magic links)

**Resend** — permanent free tier of 3,000/month (100/day cap: **transactional only**,
never newsletters). Sends from `mail.explorekingstonwa.com` after SPF+DKIM DNS records
(a Chamber action item alongside the app CNAME). **Not yet integrated** — there is no
`resend` dependency or client in the codebase today; invites/redeems currently surface
their links in-app (see auth flow in [SDD.md](SDD.md)). Wire this when the portal moves
off localhost.

---

## 4. Suggested order of operations

1. **Now (done):** portals + feeds (`/api/feeds/*`) + embed + JSON-LD + the
   `/portal/syndicate` manual checklist.
2. Chamber submits the **GBP API access form** and the **Apple Business** application
   (both free; both take calendar time).
3. Build the **GBP adapter behind a feature flag**; pilot with 2–3 businesses using the
   Manager model; add the pending-edit read-back loop. Flip the "no auto-sync yet"
   Callout on `/portal/syndicate` when it lands.
4. **Meta pilot app** with a handful of tester businesses; measure appetite before
   committing to Advanced Access review.
5. Wire **Resend** when the portal moves off localhost.

---

## Known limitations / debt

- **JSON-LD is restaurant-only.** Lodging and nonprofit pages emit no structured data;
  extend `LocalBusinessJsonLd` (or add sibling components) when those pages matter for
  search.
- **All outbound propagation is pull or manual.** Feeds are pull-only (the platform or
  the business's site must poll); the big-platform round is human copy-paste. Nothing
  in §2 is wired yet — no adapter code exists.
- **`openNow` is null without structured hours.** A listing with only a freetext
  `hours` string and no `weeklyHours` gets `openNow: null` in the business JSON and no
  `openingHoursSpecification` in JSON-LD. Structured-hours coverage is the lever for
  richer syndication.
- **No syndication analytics.** We don't track feed/embed consumption, so we can't yet
  say which members' sites actually pull the feeds.
