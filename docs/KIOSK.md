# KIOSK.md — Kiosk mode design

**Status: BUILT (E22, July 2026) — shipped dark, device not yet deployed.**
This document is the *design*, kept as the record of why the kiosk is shaped this way.
For running the actual panel, see **[KIOSK-DEPLOY.md](KIOSK-DEPLOY.md)** (Chromium
flags, the URL-allowlist policy, the front-desk recovery card, and the install-day
field test).

**Author:** research + design pass, July 2026.
**Companion:** [KIOSK-POWER.md](KIOSK-POWER.md) — hardware power budget + off-grid
solar feasibility (the "can it run on battery/solar at the ferry" question).

### What shipped, and where it differs from this design

The route-group decision (§2), the screen list (§3), the layout split (§4), `KioskShell`
(§5), the store-backed update story (§6) and the device setup (§8) all shipped as
described. Three things landed differently, each for a reason recorded at the code:

| §  | Designed | Shipped | Why |
| -- | -------- | ------- | --- |
| §4 | Kiosk viewport pins the zoom scale | It does not | E14 shipped an accessibility invariant forbidding that anywhere in `src/`, and kiosk WCAG AA is a launch gate. Zoom lockdown moved to the device (`--disable-pinch`), where it applies only to the panel and an operator can undo it. |
| §3 | `/kiosk/map` reuses `<FeatureMap/>` | Server-rendered walking times + landmarks, with the interactive map one QR away | Tiles need the network per pan and offline tile packs are a non-goal, so the first drag on dropped Wi-Fi lands in grey squares. Leaflet's attribution is also a real external anchor, which a locked-down panel must not have. |
| §7 | Possibly Serwist | E13's hand-rolled `public/sw.js`, extended | The worker already existed by the time E22 ran; the kiosk added one bounded cache and a stale-while-revalidate branch rather than a migration. |

Also worth knowing: the kiosk deliberately does **not** fall back to `/offline`. That page
carries the site nav, which on a panel with no address bar is a working escape hatch —
`kioskNavigate()` in `public/sw.js` answers with self-contained markup instead.

The open questions in §12 are now answered: refactor was done first (not the cover-up
path), usage is tracked as a separate `source: "kiosk"` series, v1 defaults to Ferry ·
Eat · Events · Map · Parking with Stay and Things-to-Do built but off, and the SW was
extended rather than replaced.

> **Before you write code:** heed `AGENTS.md` — this is Next.js **16.2.10** (React
> 19, Tailwind v4) and conventions differ from older mental models. The route-group,
> `layout`, `manifest`, and `headers()` APIs referenced here were checked against
> `node_modules/next/dist/docs/` on 2026-07; re-read those before implementing.

---

## 1. Why this exists

The Greater Kingston Chamber runs a physical touchscreen **kiosk** near the ferry
(today powered by the third-party "Qwick Tourist" platform — see the memory note /
strategic brief). The decision is to **drop the Qwick software subscription** and run
a purpose-built kiosk experience off the app we already own and host. The kiosk PC is
being replaced with a low-power mini PC; the existing display + enclosure are kept.

So we need a **fullscreen, touch-first, self-running "kiosk mode"** of Explore
Kingston that:

- Renders a walk-up, portrait **1080×1920** directory (ferry times, eat, stay, do,
  events, map, parking) with large touch targets — no browser chrome, no site nav.
- Runs unattended 24/7-ish on a locked-down Chromium: attract loop when idle, resets
  to home between visitors, can't be navigated off-app, self-heals after errors.
- Hands visitors off to their **phones** via QR (the kiosk is a funnel into the
  mobile app, not a dead end).
- Updates its content **automatically** from the same admin CMS that runs the website
  — edit a listing in `/admin`, the kiosk reflects it within the ISR window, no deploy.
- Degrades gracefully when the venue network drops.

**Audience:** walk-on ferry riders, one-time close-range use, mixed tech comfort,
often in a hurry. Design for glanceability and a 20–60 second interaction.

---

## 2. The core decision — embed in this app, do **not** stand up a separate app

**Decision: build kiosk mode as a route group inside this repo** (`src/app/(kiosk)/`),
sharing the data layer, stores, brand tokens, and deploy with the website. A separate
app is explicitly rejected.

### Why in-app wins here

| Factor | In-app route group (**chosen**) | Separate app (rejected) |
|---|---|---|
| Content freshness | Reuses the existing server stores + ISR — admin edits flow to the kiosk for free (see §6) | Must re-consume our data (duplicate stores, or call our feeds) and re-implement revalidation |
| Data layer | `import` `src/lib/stores/*` + `src/lib/data/*` directly | Re-model the domain or depend on our (currently thin) `/api/feeds` |
| Brand / copy | Reuses `@theme` tokens, fonts, and the `site-copy-registry` editable-copy system | Re-create the design system + a second copy CMS |
| Hosting cost | **$0 marginal** — same Render service, one more route group | A second deploy + its own hosting/monitoring |
| Ops surface | One repo, one deploy, one backup story | Two of everything to keep in sync |
| Isolation | Route group gives the kiosk its own bare layout — enough isolation without a second codebase | Full isolation we don't actually need |

The only real cost of in-app is a **one-time structural refactor** (§4) to give the
kiosk a chrome-free layout without dragging the site nav/footer into it. That refactor
is mechanical and URL-preserving, and it's worth it.

### Rejected alternatives (ADR-style)

- **Separate standalone app** (e.g. a tiny Vite/Next app just for the kiosk). Rejected:
  duplicates the domain model and forces the kiosk to fetch our content over HTTP
  instead of reading the same in-process stores, re-introducing exactly the
  "content lives somewhere else and must be synced" problem we're leaving Qwick to
  escape.
- **Conditional chrome in the existing root layout** (render `SiteNav`/`SiteFooter`
  only when the path isn't `/kiosk`). Rejected: the root `layout.tsx` is a server
  component with no direct pathname; doing this needs middleware to inject a header
  and makes the root layout read `headers()`, which pushes the **whole site** toward
  dynamic rendering and undercuts the ISR/static performance the site depends on.
- **Multiple root layouts** (a truly separate `<html>` for the kiosk via two root
  layouts, no top-level `layout.tsx`). Viable, and the Next docs list it as a use case,
  but it forces *every* route into a group and triggers a full reload when crossing
  layouts. We don't need a separate `<html>` — a single root `<html>` plus a bare
  `(kiosk)` group layout (§4) gets us there with less blast radius. Keep this in
  our back pocket only if the kiosk later needs entirely different fonts/`<head>`.
- **Prototype-only cover-up layout** (keep the root layout, have `/kiosk` render a
  `position:fixed; inset:0` panel that paints over the nav). Acceptable for a throwaway
  demo, but the `Tracker` still fires, the nav/footer stay in the DOM (focus traps,
  edge peeking, wasted render), so not the production shape. Documented as a fast path
  only.

---

## 3. What the kiosk actually shows

A small set of **kiosk-styled screens**, all reading existing data:

1. **Attract / Home** — full-bleed rotating Kingston photography, big "Touch to explore
   Kingston" prompt, live next-ferry times, a clock/weather strip, and a grid of large
   category tiles (Ferry · Eat & Drink · Stay · Things to Do · Events · Map · Parking).
   The tiles mirror the site's information architecture so we reuse copy and data.
2. **Category screens** — kiosk-scaled versions of `/ferry`, `/eat`, `/stay`,
   `/events`, `/map`, `/parking`, reading the same stores. Not the mobile pages
   verbatim — a kiosk layout with 60px+ targets, 24px+ body text, minimal scrolling.
3. **Listing detail** — name, description, hours (reuse the hours engine), and a
   **QR code** ("Scan to open on your phone") deep-linking to the corresponding mobile
   route with `?utm_source=kiosk` so the handoff is measurable (see §6, §7).

**Outbound links become QR codes.** A kiosk must never open a third-party site in its
own browser (that's how visitors escape the lockdown and strand the kiosk on some
external page). Anywhere the mobile app renders an external `OutboundLink` (menus,
booking, phone), the kiosk instead renders a QR that opens that destination on the
**visitor's** phone. This mirrors the Qwick `qr` concept and sidesteps the lockdown.

**Portrait canvas.** The existing panel is portrait (Qwick renders 1080×1920). Design
to a fixed 1080×1920 stage and scale it to whatever the panel reports with a CSS
transform (`transform: scale(min(100vw/1080, 100vh/1920))`), so layout is pixel-stable
regardless of the exact display.

---

## 4. Routing & layout structure

### Target structure (route-group split)

```
src/app/
  layout.tsx            # ROOT: minimal — <html><body>, shared fonts, metadataBase only
  (site)/               # everything the public site is today (URLs unchanged)
    layout.tsx          # the CURRENT chrome: CopyProvider + Tracker + SiteNav + <main> + SiteFooter
    page.tsx            # home  (moved from src/app/page.tsx)
    eat/ stay/ events/ ferry/ map/ parking/ hunt/ itineraries/ about/ give/ webcams/
    admin/ portal/      # (moved as-is)
  (kiosk)/
    layout.tsx          # BARE: no nav/footer/Tracker; kiosk viewport + lockdown container
    kiosk/
      page.tsx          # attract/home
      eat/ stay/ ... /page.tsx   # kiosk-styled category screens
  api/                  # unchanged — route handlers are unaffected by the group split
```

Route groups `(site)`/`(kiosk)` are **stripped from the URL** (verified in
`node_modules/next/dist/docs/.../route-groups.md`), so `/eat`, `/admin/...`, etc. keep
their exact paths. The kiosk lives at `/kiosk`.

**Why the split:** a descendant layout can't *remove* chrome that an ancestor layout
renders. Today `SiteNav`/`SiteFooter`/`Tracker` live in the single root `layout.tsx`,
so they'd render on `/kiosk` too. Moving that chrome down into `(site)/layout.tsx`
lets `(kiosk)/layout.tsx` be genuinely bare. We keep **one** top-level root `<html>`
(so no full-reload-between-layouts caveat, and shared fonts/metadata stay in one place).

**Migration checklist (mechanical, URL-safe):**
1. Create `src/app/(site)/layout.tsx` = the current `layout.tsx` body (CopyProvider +
   Tracker + SiteNav + `<main>` + SiteFooter, plus its `getHiddenPaths`/`getCopyOverrides`).
2. Slim `src/app/layout.tsx` to `<html className="… font vars">` + `<body>{children}</body>`,
   the font imports, `viewport`, and `metadata`/`metadataBase`. (Fonts must stay on
   `<html>` so both groups get the CSS variables.)
3. `git mv` every current route folder + `page.tsx` under `src/app/(site)/`.
4. Add `(kiosk)/`.
5. `next build` + smoke-test a few URLs (`/`, `/eat`, `/admin`) — paths must be
   identical. Watch for anything importing from `@/app/...` (unlikely; the codebase
   uses the `@/` alias to `src`, which is unaffected).

> **Lower-risk staging:** if touching every route at once is uncomfortable on the live
> app, ship the kiosk first with the **prototype cover-up layout** (§2, rejected list)
> to validate the UX, then do the route-group refactor as a focused follow-up PR.

### The bare `(kiosk)/layout.tsx`

- Renders **no** `SiteNav`/`SiteFooter`/`Tracker`.
- Wraps children in a `position:fixed; inset:0` kiosk stage that paints over the
  global animated-gradient `body` background from `globals.css`.
- Exports a kiosk-specific `viewport` (`width=1080, userScalable:false, maximumScale:1`,
  `themeColor` navy) — per-route viewport overrides merge over the root.
- Mounts the **`KioskShell`** client component (§5) around the stage.
- Applies lockdown CSS to the stage: `user-select:none; -webkit-touch-callout:none;
  touch-action:manipulation; overscroll-behavior:none; cursor:none`.

---

## 5. `KioskShell` — the client runtime

A single `"use client"` component (model it on `src/components/tracker.tsx`'s
lifecycle-effect style) that owns everything a walk-up kiosk needs the browser to do.
Responsibilities:

- **Idle reset.** Listen for `pointerdown`/`touchstart`/`keydown`/`mousemove`; each
  resets a timer. After ~90s idle, `router.replace('/kiosk')` (back to attract) and
  clear any transient state, so each visitor starts fresh. Reuse the `sessionStorage`
  session-id idea from `Tracker` and rotate it on reset if we track kiosk sessions.
- **Attract loop.** When idle, show a full-screen overlay of rotating Kingston photos
  + "Touch to explore" that dismisses on first touch. This overlay is *also* the
  burn-in defense (must be genuinely moving content, not a static frame).
- **Input lockdown (JS).** `preventDefault` on `contextmenu`, `selectstart`,
  `dragstart`, `gesturestart`. (CSS handles the rest, from the layout.)
- **Stay in-app.** All nav uses `next/link`/`router`. No external `<a>` renders in
  kiosk components — external destinations become QR codes. Optionally intercept any
  click whose href leaves `/kiosk` and cancel it. (Real enforcement is the OS/browser
  kiosk config — §8 — this is defense in depth.)
- **Self-heal.** `window.addEventListener('error' | 'unhandledrejection')` →
  debounced `location.reload()` (max ~1/30s to avoid reload storms). A heartbeat
  `setInterval` pings the existing `/api/health`; on repeated failure show a cached
  "be right back" state instead of a white screen. A periodic **freshness reload** of
  `/kiosk` during idle both pulls new CMS content and clears any memory leak from a
  browser running for days.
- **Burn-in mitigation.** Every ~30–60 min nudge the whole stage by 1–2px
  (`transform: translate`) so static elements (header/clock) don't sit on identical
  pixels; avoid persistent pure-white; optionally dim/blank on a schedule during known
  closed hours.

Keep `KioskShell` free of Node/server imports so it hydrates cleanly; feed it
server-fetched data as props from the kiosk pages.

---

## 6. Data flow & remote updates (the big advantage)

Kiosk pages are **server components** that read the same stores as the website
(`src/lib/stores/*` merging `src/lib/data/*` seed + admin overlays) and set
`export const revalidate = 60` like the rest of the app. Consequences:

- **One source of truth.** No kiosk-specific content store; the kiosk shows exactly
  what the site shows.
- **Free remote updates.** An admin edits a listing/hours/ferry note in `/admin` →
  the overlay store changes → ISR revalidates within ~60s → the kiosk picks it up on
  its next attract-loop/freshness reload. **No deploy, no per-device push** — this
  matches (and beats, since it's our data) Qwick's "hosted on our servers" update model.
- **Optional instant push.** Add on-demand `revalidatePath('/kiosk')` (and child
  paths) from the relevant admin server actions if 60s feels slow in practice.

**Analytics.** The kiosk deliberately does **not** mount `Tracker` (it's site chrome).
Decide explicitly whether to (a) leave the kiosk untracked, or (b) add a kiosk-scoped
beacon that tags events `source=kiosk` so walk-up usage and QR handoffs are measurable
for LTAC reporting. Recommendation: (b), lightweight, reusing the `/api/track` endpoint
with a `source` field — but keep it separate from visitor web analytics so it doesn't
skew them.

---

## 7. Offline resilience / PWA (the main net-new subsystem)

There is **no** PWA/service-worker/manifest today (`next.config.ts` is just
`{ output: "standalone" }`, no `manifest.ts`, no `sw.js`). A kiosk on venue Wi-Fi
needs the app to survive a network blip without white-screening. Plan:

- Add `src/app/manifest.ts` (`MetadataRoute.Manifest`, `display:"standalone"`, navy
  theme) — verified file convention in the bundled docs.
- Add a **service worker** that caches the `/kiosk` shell + last-good listing/event
  data and serves **stale-while-revalidate** so a dropped network shows last-known-good
  content, not the browser error page. Cache-first for static assets/photos.
- Set the SW's own `Cache-Control: no-cache, no-store, must-revalidate` (via
  `next.config` `headers()`) and register with `updateViaCache:'none'` so a stale SW
  can't pin the kiosk forever.
- **Tooling caveat:** Next recommends Serwist, but this app is Next 16 + `standalone`
  output (and possibly Turbopack). **Validate the SW build against the bundled Next 16
  docs and a real `next build` before committing to Serwist** — a hand-rolled
  `public/sw.js` may be simpler if the plugin fights the build. This is the riskiest,
  most version-sensitive part of the whole feature; timebox a spike.

This subsystem also benefits the mobile app (installable PWA) — it's on the roadmap
(`ROADMAP-V2.md` P0) anyway, so the kiosk is a good forcing function.

---

## 8. Device & OS side (the mini PC)

The web app is only half the kiosk; the **enforcement** (can't-exit-the-app,
boot-to-fullscreen) is the OS/browser config on the device — the app-level lockdown in
§5 is best-effort only.

- **Compute:** a low-power fanless mini PC (Raspberry Pi 5 or Intel N100-class) booting
  Linux straight into **Chromium in kiosk mode** pointed at
  `https://<app-host>/kiosk`. Flags: `--kiosk --disable-pinch
  --overscroll-history-navigation=0 --noerrdialogs --disable-infobars --incognito
  --no-first-run` (+ a URL allowlist policy if we want hard nav locking). Autostart via
  the OS session so a power blip returns to the app.
- **Display:** reuse the existing panel + enclosure (per decision). It is a
  **fixed, dominant power load** — see [KIOSK-POWER.md](KIOSK-POWER.md) for the
  budget and whether battery+solar is realistic at Kingston's latitude (verdict:
  year-round off-grid is impractical here; a power drop or solar+grid hybrid wins);
  that analysis
  drives the daytime-only-vs-24/7 and power-drop-vs-solar calls, which in turn set the
  kiosk's **operating-hours / sleep schedule** (implemented as the §5 schedule + a
  possible `/kiosk` "sleep" state).
- **Connectivity:** if relocated away from wired internet, an LTE hotspot; the SW/offline
  layer (§7) covers gaps.
- **URL / device identity:** the kiosk loads a stable URL. If we ever run more than one
  device or want per-device settings, add a `?device=<id>` (or a signed device token)
  read by the kiosk layout; not needed for a single kiosk.

> Cross-reference: the "who owns the hardware / can we repoint it" and "is the existing
> screen sunlight-readable behind glass" questions live in the strategic brief + power
> analysis, not here.

---

## 9. Config, security, ops

- **Env:** reuse `NEXT_PUBLIC_SITE_URL` for absolute QR/deep-link targets. No new
  secrets required for the kiosk itself.
- **Rate-limit** the `/kiosk` route and any kiosk beacon with the existing
  `@upstash/ratelimit` (it's already a dep) — `/kiosk` is a public URL.
- **Don't leak admin data** on `/kiosk`: it renders only public content (same as the
  site's public pages); never expose overlay/admin internals.
- **`next.config.ts`:** add `headers()` for the SW cache-control and standard security
  headers. Keep `output: "standalone"` (Render/Docker).
- **Deploy:** ships with the normal `git push → Render auto-deploy`. No separate
  pipeline. Add `/kiosk` to any smoke-test list.

---

## 10. Build plan & effort

Rough sequence for a technical solo dev on this codebase:

1. **Route-group refactor** (§4) — move site into `(site)`, slim root layout, add
   `(kiosk)` skeleton. *~0.5–1 day.* (Or defer via the prototype cover-up path.)
2. **Portrait stage + lockdown layout** + a static kiosk home with category tiles.
   *~1 day.*
3. **`KioskShell`** — idle/attract/self-heal/lockdown. *~1 day.*
4. **Kiosk category + detail screens** reusing stores; QR handoff for outbound.
   *~1–2 days.*
5. **PWA/offline + burn-in** (timebox the SW spike first). *~1 day + spike.*
6. **On-device**: Chromium kiosk autostart on the mini PC, point at `/kiosk`,
   field-test on the actual panel. *~0.5 day + on-site.*

**~4–6 focused days for a solid v1; ~2 weeks for a field-tested, polished version.**

## 11. Testing

- `next build` + route smoke test after the group refactor (URLs unchanged).
- Kiosk UX on the **actual panel** (touch targets, portrait scaling, glare).
- **Pull the plug** test: kill Wi-Fi mid-session → confirm last-good content, not a
  white screen; restore → confirm recovery.
- Leave it running overnight → confirm the freshness reload + no memory bloat + attract
  loop cycling.
- Edit a listing in `/admin` → confirm the kiosk reflects it within the ISR window.

## 12. Open questions / decisions to lock

- Route-group refactor **now** vs prototype-cover-up first? (Recommend refactor; stage
  if risk-averse.)
- Track kiosk usage (`source=kiosk`) or run untracked? (Recommend tracked, separated
  from web analytics.)
- Which screens make v1 (Ferry + Eat + Map are the ferry-rider core) vs later.
- Serwist vs hand-rolled SW — decide after the §7 build spike.
- Operating hours / sleep schedule — set by the power analysis outcome.

## 13. Non-goals

- Not a second app, not a second CMS, not a separate deploy.
- Not embedding the app *inside* the old Qwick shell (that path is a dead end — Qwick
  custom apps can't load an external URL; see the strategic brief). This replaces Qwick.
- No new data model — kiosk reads existing stores only.
