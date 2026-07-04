# Competitor teardown: Visit Bainbridge Island app

*July 2026. Companion doc: [README.md](README.md) (doc index),
[ROADMAP-V2.md](ROADMAP-V2.md) (what we build next), [MAPS.md](MAPS.md)
(our map CMS), [DATA_SOURCES.md](DATA_SOURCES.md) (our analytics posture).*

**go.visitbainbridgeisland.org** — evaluated July 2026 (live inspection of
network traffic / bundled scripts / Supabase calls + web research; location
permission declined, no account created). This is the closest analog to
Explore Kingston: a hyper-local ferry-town DMO app on the same Kitsap
Peninsula, one WSF route over. Everything below is evidence-based from the
shipped app; genuinely unverifiable items are flagged at the end.

## What it is

A mobile-first **PWA** (installable, offline service worker, "Visit BI" home
icon, teal theme). Bottom tabs Home / Eat / Shop / See / Plan / More. The
apex `visitbainbridgeisland.org` is a **separate Squarespace** marketing
site; the app lives only on the `go.` subdomain — the same app-on-subdomain /
marketing-on-apex split Explore Kingston uses (companion app to
explorekingstonwa.com).

## Stack & vendor (evidence-based)

**Built with Lovable** (the AI app builder) on **Supabase + Vercel + Google +
Resend** — NOT a productized DMO SaaS (Bandwango / Simpleview / Visit Widget).
Evidence: `<meta name="author" content="Lovable">`, a leftover Lovable TODO
comment, `lv_`-prefixed session keys, assets on `storage.googleapis.com/
gpt-engineer-file-uploads/` (Lovable's old "GPT Engineer" name), Vercel
`server`/CNAME headers, and Supabase project
`bzyusfxbffnaajmhqmxu.supabase.co`.

Their Terms describe an anonymous **"Developer"** who owns the code and
**licenses a multi-tenant platform** to the DMO — i.e. intends to resell the
same app to other towns. Governing law: **Kitsap County** — likely a small
local developer.

**Takeaway:** this validates our exact thesis — a bespoke React app on a lean
cloud stack beats a six-figure DMO contract. It is also a near-identical
architecture to our *Phase 2* target (Explore Kingston already runs the same
serverless shape on **Neon Postgres + Vercel Blob + Upstash**, gated behind a
store seam; see [ARCHITECTURE.md](ARCHITECTURE.md) / [DEPLOY.md](DEPLOY.md)).
The difference that matters: **we own our code outright.** Theirs is an
anonymous developer who keeps all IP and resells the shell.

## Features

Category listings (Eat / Shop / See), events, **trip planning + shareable
itineraries**, favorites / bookmarks (needs an account), "Trending now" (from
view counts, with editorial pin / override), maps + "What's Nearby" (opens
Apple / Google Maps; Google Places for photos), **real-time ferry schedule +
opt-in departure reminders** (WSDOT source, a `ferry-realtime` edge
function), public transit, visitor centers, optional **accounts** (email +
Google / Apple / Facebook), a **business self-service claim / verify portal**,
opt-in **push notifications**, an **ad system** (zones / placements with
impression counts), an **admin panel** with analytics dashboards + feature
flags, and some **AI-generated business descriptions** (disclaimed).

**Absent from theirs:** gamification / passport / points, check-ins, AR,
deals / passes, in-app payments — and, notably, anything ferry-specific
beyond a schedule + reminder. No busyness forecast, no drive-up-space or
boarding-pass surfacing, no side-of-water reframing. That gap is where
Explore Kingston is deliberately deeper (see the comparison table below).

## Data capture (the priority — what the popup is about)

Runs **first-party analytics into its own Supabase DB** *plus* **GA4** — and
notably does **not** send your location to its backend.

- **GA4** (`G-VMK9DWY0PC`, gtag in the `<head>`) — `page_view`. No Segment,
  Mixpanel, PostHog, Meta / TikTok pixel, Hotjar, or Sentry (verified against
  the bundle + live traffic).
- **First-party Supabase tables** (exact insert payloads read from the
  bundle):
  - `device_info` — session_id, user_agent, platform, browser, screen size,
    is_pwa, referrer, UTM params (device / session profiling on load).
  - `user_activity` — per-screen route / name logging (their own pageviews).
  - `listing_views` — every business / place you open, timestamped → powers
    "Trending now." This is the analog of our outbound-tap analytics.
  - `record_qr_click(...)` RPC — **QR-code scan attribution** for printed
    codes around town, by campaign.
  - an **"internal engagement score"** per user (per the privacy policy).
- **The geolocation prompt = proximity only.** Coordinates are used
  **client-side** to sort listings by distance / "What's Nearby"; grepping
  every Supabase insert, **no lat/lng is ever persisted**. No heatmaps, no
  dwell-time, no geofencing, no location history. Decline → it falls back to
  the **ferry terminal** as the reference point. (Google does receive place
  lookups for maps / photos; a Google Places key is exposed client-side and
  should be referrer-restricted.)
- **Accounts** optional (email + social). **Privacy policy** (in-app
  `/privacy`; the public marketing site's `/privacy` **404s** — a gap): "We
  do not sell your personal information," US (Oregon) hosting, CCPA section,
  under-13 exclusion. No cookie / consent banner.

## Monetization

DMO owns it + **advertising** (built-in `ad_zones` / `ad_placements` with
impression counts, `home_featured`), a monetizable **trending pin / override**,
a **business-listing portal** (upsell path; no payment code found — fees are
off-platform today), and the **developer licenses the platform** to other
destinations (SaaS licensing).

## Explore Kingston vs. Visit Bainbridge — where we now stand

| Capability | Visit Bainbridge | Explore Kingston (shipped, July 2026) |
|---|---|---|
| Ferry data | Schedule + reminder | Live WSF sailings, drive-up space, wait notes, delays, alerts, **SR-104 vehicle boarding-pass** status + "get in the line" routing, vessel + traffic + webcam views |
| Ferry busyness | none | **Busyness forecast** (`/ferry/plan`), model calibrated to WSF "Best Times to Travel", learns from a first-party observation log (ships behind an admin on/off flag, default off) |
| Departure reminders | opt-in push | opt-in **.ics** calendar reminder + in-page notify |
| Location framing | terminal-fallback proximity | proximity **+ side-of-water mode** (Kingston-side vs Edmonds-side reframing, opt-in, side switcher) |
| Maps | opens Apple / Google Maps; Google Places photos | **first-party map CMS** (`/map`) — admin-drawn views / markers / lines / trails / areas + built-in data layers, plus a parking-zone polygon editor; Leaflet + OSM, no per-map Google billing (see [MAPS.md](MAPS.md)) |
| Analytics | GA4 **+** first-party Supabase (device_info, user_activity, engagement score) | **first-party only**, no GA4, no third-party pixels; coarse block-rounded geo pings, aggregate posture (see [DATA_SOURCES.md](DATA_SOURCES.md)) |
| QR-scan attribution | yes (`record_qr_click`) | **not yet** — see "ideas worth stealing" |
| Content editing | Lovable admin | full **content CMS** (77 editable copy blocks, per-page show/hide) + admin editors for listings / itineraries / hunts / ferry facts |
| Business portal | claim / verify | claim / verify + org / event / needs self-service |
| Gamification | none | scavenger **hunts** (`/hunt`) with photo submission |
| Ads | built-in ad zones | none (deliberately) |
| Code ownership | anonymous dev, multi-tenant license | **owned outright** |

## What to emulate / avoid for Kingston

**Emulate (or already have):**
- The lean ownable stack — **we already have it**, and our Phase-2 seam
  (Neon / Blob / Upstash on Vercel) is the same shape they run.
- Privacy-forward location: client-side proximity + a sensible fallback. We
  **match and go further** — our geo pings are block-rounded and coarse-only,
  and our default framing is side-of-water rather than raw coordinates.
- First-party view / trending analytics for **LTAC / LTAC-style reporting**
  without surveillance. We already log outbound taps first-party; a
  "trending" rollup is a small add on top of our existing analytics store.
- Real-time ferry + reminders. We are **already richer** here (busyness
  forecast, drive-up space, boarding-pass, routing, webcams) — this is our
  clearest product moat over them.
- Business self-service portal — **we have it.**

**Avoid / do better:**
- Publish the privacy policy on the **public** site (theirs 404s).
- Restrict any client-exposed Google key by HTTP referrer. (We sidestep most
  of this: our maps are Leaflet + OSM; only the optional Street View embed
  touches Google, and it is a build-time key.)
- Consider a consent banner if targeting EU / CA visitors.
- On any licensed build, **negotiate code ownership / escrow / exit** — theirs
  is an anonymous developer who keeps all IP; we own ours.
- Human-review any AI-written hours / prices (we already flag unverified hours
  via `hoursVerified` in the data model).
- Don't over-collect. Their device_info + user_activity + engagement-score
  stack is more than a small DMO needs; **our GA-free, first-party,
  aggregate-only analytics is a cleaner posture** — keep it that way.

**Ideas worth stealing:**
- Opt-in **return-ferry reminders / alerts** — we have departure reminders;
  the return-trip nudge is a natural extension of the forecast + reminder we
  already ship.
- **QR-scan attribution** for printed signage — the one capture mechanism
  they have that we don't. High value for print-campaign / LTAC reporting and
  low-effort against our existing first-party `/api/track` beacon.
- **Shareable itineraries** — we have itineraries; a share link is a small add.

*Flagged unverified:* the developer's real identity (undisclosed), whether
GA4 has ad / remarketing signals enabled, and exact data-retention windows.
