# Competitor teardown: Visit Bainbridge Island app

**go.visitbainbridgeisland.org** — evaluated 2026-07-04 (live inspection of
network/scripts/Supabase calls + web research; location permission declined,
no account created). This is the closest analog to what we're building: a
hyper-local ferry-town DMO app on the same Kitsap Peninsula.

## What it is

A mobile-first **PWA** (installable, offline service worker, "Visit BI" home
icon, teal theme). Bottom tabs Home / Eat / Shop / See / Plan / More. The
apex `visitbainbridgeisland.org` is a **separate Squarespace** marketing
site; the app lives only on the `go.` subdomain. Same split we planned
(app on a subdomain, WordPress/marketing on the apex).

## Stack & vendor (evidence-based)

**Built with Lovable** (the AI app builder) on **Supabase + Vercel + Google +
Resend** — NOT a productized DMO SaaS (Bandwango/Simpleview/Visit Widget).
Evidence: `<meta name="author" content="Lovable">`, a leftover Lovable TODO
comment, `lv_`-prefixed session keys, assets on `storage.googleapis.com/
gpt-engineer-file-uploads/` (Lovable's old name), Vercel `server`/CNAME
headers, and Supabase project `bzyusfxbffnaajmhqmxu.supabase.co`.

Their Terms describe an anonymous **"Developer"** who owns the code and
**licenses a multi-tenant platform** to the DMO (i.e. intends to resell the
same app to other towns). Governing law: **Kitsap County** — likely a small
local developer. **Takeaway: this validates our exact approach** (a bespoke
React app + Supabase + Vercel beats a six-figure DMO contract), and it's a
near-identical stack to our planned Vercel/Neon-or-Supabase migration.

## Features

Category listings (Eat/Shop/See), events, **trip planning + shareable
itineraries**, favorites/bookmarks (needs an account), "Trending now" (from
view counts, with editorial pin/override), maps + "What's Nearby" (opens
Apple/Google Maps; Google Places for photos), **real-time ferry schedule +
opt-in departure reminders** (WSDOT source, a `ferry-realtime` edge
function), public transit, visitor centers, optional **accounts** (email +
Google/Apple/Facebook), a **business self-service claim/verify portal**,
opt-in **push notifications**, an **ad system** (zones/placements with
impression counts), an **admin panel** with analytics dashboards + feature
flags, and some **AI-generated business descriptions** (disclaimed).
**Absent:** gamification/passport/points, check-ins, AR, deals/passes,
in-app payments.

## Data capture (the priority — what the popup is about)

Runs **first-party analytics into its own Supabase DB** plus **GA4** — and
notably does **not** send your location to its backend.

- **GA4 only** (`G-VMK9DWY0PC`, gtag in the HdEAD) — `page_view`. No Segment,
  Mixpanel, PostHog, Meta/TikTok pixel, Hotjar, or Sentry (verified against
  the bundle + live traffic).
- **First-party Supabase tables** (exact insert payloads from the bundle):
  - `device_info` — session_id, user_agent, platform, browser, screen size,
    is_pwa, referrer, UTM params (device/session profiling on load)
  - `user_activity` — per-screen route/name logging (their own pageviews)
  - `listing_views` — every business/place you open (timestamped) → powers
    "Trending now" **(this is basically our analytics + "outbound taps")**
  - `record_qr_click(...)` RPC — **QR-code scan attribution** for printed
    codes around town, by campaign
  - an **"internal engagement score"** per user (per the privacy policy)
- **The geolocation prompt = proximity only.** Coordinates are used
  **client-side** to sort listings by distance / "What's Nearby" — I grepped
  every Supabase insert and **no lat/lng is ever persisted**. No heatmaps,
  no dwell-time, no geofencing, no location history. Decline → it falls back
  to the **ferry terminal** as the reference point. (Google does receive
  place lookups for maps/photos; a Google Places key is exposed client-side
  and should be referrer-restricted.)
- **Accounts** optional (email + social). **Privacy policy** (in-app
  `/privacy`; note the public site's `/privacy` 404s — a gap): "**We do not
  sell your personal information**," US (Oregon) hosting, CCPA section,
  under-13 exclusion. No cookie/consent banner.

## Monetization

DMO owns it + **advertising** (built-in `ad_zones`/`ad_placements` with
impression counts, `home_featured`), monetizable **trending pin/override**,
a **business-listing portal** (upsell path; no payment code found — fees
off-platform today), and the **developer licenses the platform** to other
destinations (SaaS licensing).

## What to emulate / avoid for Kingston

**Emulate:** the lean ownable stack (we already have it); privacy-forward
location (client-side only, terminal fallback — we match this with our
block-rounded opt-in pings); first-party view/trending analytics + QR-scan
attribution for print campaigns (great for **LTAC** reporting without
surveillance); real-time ferry + reminders (we now surface delays, car
space, alerts, boarding-pass on the home widget — richer than theirs);
business self-service portal (we have it).

**Avoid / do better:** publish the privacy policy on the **public** site
(theirs 404s); restrict the Google key; consider a consent banner if
targeting EU/CA; on a licensed build, **negotiate code ownership / escrow /
exit** (theirs is an anonymous developer who keeps all IP — we own ours
outright); human-review any AI-written hours/prices; don't over-collect
(their device_info + user_activity + engagement-score stack is more than a
small DMO needs — our GA-free, first-party, aggregate-only analytics is a
cleaner posture).

**Ideas worth stealing:** opt-in **return-ferry reminders/alerts**, **QR-scan
attribution** for printed signage, and **shareable itineraries** (we have
itineraries; sharing is a small add).

*Flagged unverified:* the developer's real identity (undisclosed), whether
GA4 has ad/remarketing signals on, exact data-retention windows.
