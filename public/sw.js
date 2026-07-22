/*
 * Explore Kingston service worker (E13).
 *
 * Written to be read by a volunteer at 9pm with a broken ferry board on the
 * other screen, so it is longer in comments than in code. Plain JS, zero
 * dependencies, no build step: it ships from public/ exactly as written and is
 * served with `Cache-Control: no-cache, no-store, max-age=0` (next.config.ts).
 *
 * What it is for: a visitor standing in the ferry line with one bar of signal
 * should still see the last ferry times they loaded, and should be told
 * plainly that they are looking at a saved copy.
 *
 * What it deliberately does NOT do:
 *   - No background sync, no periodic background sync, no push notifications,
 *     no client messaging. Every one of those is a permission surface or a
 *     wake-up path we have no operational story for, and tests/unit/
 *     sw-contract.test.ts fails the build if one is ever added quietly.
 *   - No caching of anything under /admin, /portal or /api (one narrow,
 *     exact-match exception, below). Shared devices are normal here.
 *
 * To ship a new worker: bump VERSION. Old caches are dropped on activate.
 */

// Bumping this string is the ONLY supported cache invalidation. Every cache
// name ends with it, and activate deletes every vk-* cache that does not.
//
// v2: the v1 caches were filled by the earlier fetch logic — brand imagery was
// never stored at all, and a failed cache write could change which page a
// visitor was handed — so a returning device drops them wholesale on activate
// rather than carrying that state forward.
// v3: E22 added the kiosk cache and a stale-while-revalidate branch for kiosk
// navigations. The navigate() path now behaves differently per URL, so a
// returning device drops the v2 caches wholesale rather than carrying entries
// filled by the old logic forward.
const VERSION = "v3";

const SHELL_CACHE = `vk-shell-${VERSION}`; // HTML for allowlisted pages
const STATIC_CACHE = `vk-static-${VERSION}`; // build output + brand images
const DATA_CACHE = `vk-data-${VERSION}`; // exactly one ferry snapshot
const KIOSK_CACHE = `vk-kiosk-${VERSION}`; // HTML for the ferry-dock kiosk screens

// Exact-pathname membership ONLY — never a prefix match. A prefix on "/events"
// would swallow /events/suggest (which renders an admin preview of unpublished
// events); a prefix on "/ferry" would swallow /ferry/plan.
//
// "/ferry/plan" is DELIBERATELY ABSENT even though it exists as a route: the
// ferry-prediction flag defaults off with no seed record, so that page calls
// notFound() for every visitor today. Caching it would cache a 404.
// "/webcams" and "/map" are absent too — both are useless offline and both are
// heavy enough to blow the shell budget.
//
// OWED FOLLOW-UP (E14): add "/simple" and "/print" here once E14's low-bandwidth
// and print routes land. They do not exist yet, and an allowlist entry for a
// route that 404s caches the 404 — but they will be the two most offline-worth
// pages in the app, so this list is wrong the moment they ship. The SHELL_LIMIT
// slack below already covers both. tests/unit/sw-contract.test.ts asserts every
// entry here resolves to a real page.tsx, so adding them early fails the build.
const NAV_ALLOWLIST = ["/", "/ferry", "/eat", "/events", "/parking", "/about", "/offline"];

// The ferry-dock kiosk's screens (E22). A SEPARATE list, with its own cache and
// its own strategy, for three reasons that all bite if they share the shell's:
//
//   1. BUDGET. SHELL_LIMIT is sized to the visitor allowlist. Folding eight
//      kiosk screens in would let a panel that reloads itself every fifteen
//      minutes evict the pages a phone in the ferry queue came for.
//   2. STRATEGY. Visitor navigations are network-first: a phone should wait a
//      moment for the truth. The kiosk is the opposite — it is a wall display
//      whose content changes on an ISR cycle, so painting instantly from cache
//      and revalidating behind it is both faster and steadier, and the shell's
//      own freshness reload closes the loop.
//   3. FALLBACK. A failed kiosk navigation must NEVER land on /offline. That
//      page carries the site nav and footer, which on a locked-down panel with
//      no address bar is a working escape hatch out of the kiosk. See
//      kioskNavigate().
//
// Exact pathnames, same rule as above. tests/unit/sw-contract.test.ts asserts
// every entry resolves to a real page file (route-group aware since E22).
const KIOSK_NAV_ALLOWLIST = [
  "/kiosk",
  "/kiosk/ferry",
  "/kiosk/eat",
  "/kiosk/events",
  "/kiosk/map",
  "/kiosk/parking",
  "/kiosk/bus",
  "/kiosk/stay",
  "/kiosk/do",
];

// The site's declared private surface — identical to src/app/robots.ts. Do NOT
// derive this from src/proxy.ts's matcher: that one deliberately omits /portal
// (it IS the login page), /portal/setup, /portal/join and /api/auth/*, all of
// which these blunt prefixes must still cover. There is no /login or /signup.
const NAV_DENY_PREFIXES = ["/admin", "/portal", "/api"];

// Fetched at install so the offline fallback exists before the network ever
// drops. SHELL-cache only, and deliberately a list of ONE.
//
// Why the icons and the manifest are NOT here: this cache is also where page
// navigations land, and it is trimmed FIFO against SHELL_LIMIT. Precached
// entries are the oldest entries by definition, so any asset parked here is
// first in line for eviction once a visitor browses a few pages — and the one
// asset we cannot afford to lose is exactly the one that would go first.
// Keeping this list to /offline means the shell budget below is a budget for
// the allowlist and nothing else, and /offline can never be evicted by ordinary
// browsing. The install icons live in the static cache instead (see below),
// which is where the /brand/ fetch branch reads them back from anyway.
const PRECACHE = ["/offline"];

// Parked in the STATIC cache at install: same assets the /brand/ branch would
// cache-first on demand, just warmed early. The manifest is here rather than in
// the shell for the budget reason above; the browser keeps its own copy too, so
// this is belt-and-braces, not load-bearing.
const PRECACHE_STATIC = [
  "/manifest.webmanifest",
  "/brand/icon-192.png",
  "/brand/icon-512.png",
];

// Content-hashed build output and brand imagery: safe to serve cache-first.
//
// Note what these two prefixes do NOT cover: the logo and the home hero. Every
// <Image> in the app uses Next's default loader, so the wire request for
// /brand/logo-explore-kingston-primary.png is really
// /_next/image?url=%2Fbrand%2Flogo-explore-kingston-primary.png&w=1920&q=75 —
// pathname "/_next/image", which matches neither prefix. Those are handled by
// the optimizer rule below. Only the CSS background texture and the manifest
// icons are ever requested at /brand/ directly.
const STATIC_PREFIXES = ["/_next/static/", "/brand/"];

// Next's image optimizer, and the one rule in this file that deliberately is
// NOT a pathname prefix. The reason is privacy, not tidiness:
//
// Branch 3 below denies /admin, /portal and /api by looking at url.pathname —
// but the optimizer carries its real target in the ?url= QUERY parameter. A
// request for /_next/image?url=%2Fapi%2Fhunts%2Fphoto%2F123&w=640 has the
// pathname "/_next/image", sails straight past that deny check, and a blunt
// prefix here would file an admin-only moderation photo in a cache on the
// shared front-desk tablet.
//
// So we decode the parameter ourselves and cache-first ONLY our own /brand/
// files. Every other optimizer request — including any future <Image> someone
// drops onto a moderation screen — falls through to branch 6 untouched, exactly
// as if this worker were not installed. Do not fold this into STATIC_PREFIXES.
const IMAGE_OPTIMIZER_PATH = "/_next/image";

function isBrandImage(url) {
  if (url.pathname !== IMAGE_OPTIMIZER_PATH) return false;
  // URLSearchParams hands back the value already percent-decoded, so
  // "%2Fbrand%2Flogo.png" arrives here as "/brand/logo.png".
  const target = url.searchParams.get("url");
  // The ".." test is belt-and-braces: "/brand/../api/hunts/photo/123" does
  // start with "/brand/" and would otherwise walk right back out of the folder.
  return target !== null && target.startsWith("/brand/") && !target.includes("..");
}

// The one and only /api path this worker touches, matched by EXACT equality.
// Never by prefix on /api/ferry — /api/ferry/observe and /api/ferry/accuracy
// are state-MUTATING GETs, so a prefix match would make every offline retry
// write to the database. (tests/unit/sw-contract.test.ts fails the build on a
// prefix form here, comments included.)
const FERRY_STATUS_PATH = "/api/ferry/status";

// Small deliberate slack over the allowlist so a redirect or a one-off page
// cannot evict the pages people actually came for.
const SHELL_LIMIT = NAV_ALLOWLIST.length + 2;
const STATIC_LIMIT = 80;
// Same slack rule as the shell, against its own list — so the kiosk's screens
// and the visitor's pages can never evict each other.
const KIOSK_LIMIT = KIOSK_NAV_ALLOWLIST.length + 2;

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const [shell, static_] = await Promise.all([
        caches.open(SHELL_CACHE),
        caches.open(STATIC_CACHE),
      ]);
      // Per-entry cache.add, never the atomic bulk form: that one rejects as a
      // whole, so a single missing asset kills the install and the worker
      // SILENTLY never activates — no error anywhere a volunteer would look.
      // A missing icon should cost us one icon, not the entire offline story.
      await Promise.all([
        ...PRECACHE.map((url) => shell.add(url).catch(() => {})),
        ...PRECACHE_STATIC.map((url) => static_.add(url).catch(() => {})),
      ]);
      // Take over as soon as the download finishes rather than waiting for
      // every tab to close. Paired with clients.claim() below.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          // The vk- prefix guard matters: this origin also hosts Next's own
          // caches, and deleting those would be someone else's outage.
          .filter((name) => name.startsWith("vk-") && !name.endsWith(`-${VERSION}`))
          .map((name) => caches.delete(name)),
      );
      // Control already-open tabs immediately, so a visitor who installs mid-
      // visit does not have to reload before offline works.
      await self.clients.claim();
    })(),
  );
});

/* ------------------------------------------------------------------ */
/* Fetch — branch ORDER is the security property, do not reorder       */
/* ------------------------------------------------------------------ */

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // 1. GET only. A queued POST is the outbox's job (src/lib/outbox.ts), not
  //    this file's — replaying writes from a cache layer is how you double-book
  //    a reservation.
  if (request.method !== "GET") return;

  // 2. Same-origin only. Third-party embeds (WSDOT, maps, fonts) keep their own
  //    caching rules; we have no business storing their responses.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 3. Private surfaces, checked BEFORE every other branch. This ordering is
  //    load-bearing, not stylistic: /api/hunts/photo serves admin-only
  //    moderation photos with an image destination, and /api/map/image and
  //    /api/events/attachment are the same shape. A "cache all same-origin
  //    images" branch running first would put the moderation queue into a
  //    cache on a shared device.
  if (NAV_DENY_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    // The single carve-out, nested here on purpose: reachable only by exact
    // string equality, so no other /api path can ever fall into it.
    if (url.pathname === FERRY_STATUS_PATH) {
      event.respondWith(ferryStatus(event, request));
    }
    return;
  }

  // 4. Page navigations. The kiosk gets its own branch — stale-while-revalidate
  //    into its own cache, and a fallback that never leaves the kiosk.
  if (request.mode === "navigate") {
    if (KIOSK_NAV_ALLOWLIST.includes(url.pathname)) {
      event.respondWith(kioskNavigate(event, request, url));
    } else {
      event.respondWith(navigate(event, request, url));
    }
    return;
  }

  // 5. Immutable build output and brand images: cache-first. The second test is
  //    the optimizer-served brand imagery — see isBrandImage above for why it
  //    is a decoded query check and not another entry in STATIC_PREFIXES.
  if (STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) || isBrandImage(url)) {
    event.respondWith(staticAsset(event, request));
    return;
  }

  // 6. Everything else falls through with no respondWith — the browser's own
  //    default handling, exactly as if this worker did not exist.
});

/* ------------------------------------------------------------------ */
/* Strategies                                                          */
/* ------------------------------------------------------------------ */

/**
 * Network-first HTML, falling back to the saved page, then to /offline.
 *
 * The try guards the FETCH and nothing else. That scope is the whole point:
 * when the cache write sat inside it too, a QuotaExceededError on a full phone
 * (ordinary on a tourist's handset) threw away a perfectly good 200 and dropped
 * into the offline branch — a visitor on full LTE served yesterday's page, or
 * "You're offline", every single time, because every retry fails at the same
 * write. Saving the page is bookkeeping; it never decides what is on screen.
 */
async function navigate(event, request, url) {
  let res;
  try {
    res = await fetch(request);
  } catch {
    // Only the network leg lands here. Open the cache now rather than up front,
    // so an online visit never pays for a lookup it does not use.
    const cache = await caches.open(SHELL_CACHE);
    const saved = await cache.match(url.pathname);
    if (saved) return saved;
    const offline = await cache.match("/offline");
    if (offline) return offline;
    // Precache missed and nothing is saved. Say so in plain text rather than
    // letting the browser's own dinosaur explain it.
    return new Response("You're offline, and this page hasn't been saved yet.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Three conditions, all required:
  //  - status 200: any page on the allowlist can be HIDDEN at runtime by a
  //    Chamber admin, which turns it into a 404. Caching that 404 would
  //    outlive the admin un-hiding it.
  //  - !redirected: a redirect chain that ended somewhere else must not be
  //    filed under the URL the visitor asked for.
  //  - exact allowlist membership: see the NAV_ALLOWLIST comment.
  if (res.status === 200 && !res.redirected && NAV_ALLOWLIST.includes(url.pathname)) {
    // Keyed by PATHNAME, not by the request: the installed app's start_url is
    // "/?source=pwa", so keying by request would file the home page under a
    // key that a later plain "/" visit never matches.
    saveInBackground(event, SHELL_CACHE, SHELL_LIMIT, url.pathname, res.clone());
  }
  // Unconditional, and never behind an await on storage: the visitor gets the
  // live page whether or not it was saved.
  return res;
}

/**
 * Stale-while-revalidate for the ferry-dock kiosk's screens (E22).
 *
 * Paint whatever we have instantly, then refresh it behind the visitor's back.
 * A wall panel is not a phone: nobody is waiting on a spinner, the content
 * changes on a 60s ISR cycle rather than per-tap, and the shell reloads the
 * whole page every fifteen idle minutes anyway — so the freshest thing we can
 * put on the glass in zero milliseconds beats the truest thing in eight
 * hundred, every time.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: fall back to /offline. That document
 * carries SiteNav and SiteFooter, and on a device with no address bar and no
 * back button those links are a one-tap route out of the kiosk and into the
 * public site, where a visitor is then stuck. A kiosk with nothing cached gets
 * the self-contained notice below instead, and KioskShell's heartbeat is what
 * puts "Be right back" on screen while the network is away.
 */
async function kioskNavigate(event, request, url) {
  const cache = await caches.open(KIOSK_CACHE);
  const saved = await cache.match(url.pathname);

  // Started whether or not we hit, because the "revalidate" half is the whole
  // point: a hit that is never refreshed is just a stale cache.
  const network = fetch(request)
    .then((res) => {
      // Same three conditions navigate() uses, and for the same reasons — a
      // kiosk screen the Chamber has switched off answers 404, and caching that
      // would outlive them switching it back on.
      if (res.status === 200 && !res.redirected && KIOSK_NAV_ALLOWLIST.includes(url.pathname)) {
        saveInBackground(event, KIOSK_CACHE, KIOSK_LIMIT, url.pathname, res.clone());
      } else if (res.status === 404) {
        // AND THE OTHER HALF, which stale-while-revalidate needs and
        // network-first does not: EVICT on a 404.
        //
        // Without this the admin off-switch is a no-op on the actual device.
        // Turning the kiosk off makes /kiosk 404, but this branch would serve
        // the cached copy first and only "revalidate" behind it — and a
        // revalidation that declines to store anything leaves the old page in
        // the cache for ever. The panel would keep showing the directory after
        // staff had switched it off, with no way to tell from the admin page
        // that it had not taken. Same for a screen removed from enabledScreens.
        dropFromCache(event, KIOSK_CACHE, url.pathname);
      }
      return res;
    })
    .catch(() => null);

  if (saved) {
    // Keep the worker alive for the refresh even though nobody is awaiting it.
    try {
      event.waitUntil(network);
    } catch {
      // The event's lifetime already ended; the visitor has their page.
    }
    return saved;
  }

  const res = await network;
  if (res) return res;

  // Nothing cached and no network — the state a kiosk is in on its very first
  // boot at the dock if the venue Wi-Fi is not up yet. Self-contained markup:
  // no nav, no links, nothing to tap, styled to match the kiosk so it does not
  // look like a browser error page to a member of the public.
  //
  // THE META REFRESH IS THE POINT, not decoration. This document replaces the
  // app, so none of KioskShell's recovery runs from here: no heartbeat, no
  // freshness reload, no self-heal — that JS is in a bundle this response does
  // not load. Without a refresh the panel sits on this screen for ever once the
  // network returns, and the only cure is a human power-cycling the mini PC,
  // which defeats the whole unattended-recovery story in docs/KIOSK-DEPLOY.md.
  // Ten seconds is frequent enough to look instant to anyone watching and far
  // too slow to be load on a server that is, by definition, unreachable.
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta http-equiv="refresh" content="10">` +
      `<title>Explore Kingston</title></head>` +
      `<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;` +
      `background:#22334d;color:#fff;font:600 2rem/1.4 system-ui,sans-serif;text-align:center">` +
      `<p style="max-width:32rem;padding:2rem">Be right back &mdash; this screen is reconnecting.<br>` +
      `<span style="font-weight:400;opacity:.75">Ferry times are posted at the terminal.</span></p>` +
      `</body></html>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/**
 * Delete one entry, off the response path. Mirrors saveInBackground's contract:
 * nothing is awaited by the caller and every failure is swallowed, because an
 * eviction is bookkeeping and must never change what the visitor sees.
 */
function dropFromCache(event, cacheName, key) {
  const write = caches
    .open(cacheName)
    .then((cache) => cache.delete(key))
    .catch(() => {});
  try {
    event.waitUntil(write);
  } catch {
    // The event's lifetime already ended; the next navigation will retry.
  }
}

/** Cache-first for content-hashed assets and optimizer-served brand imagery. */
async function staticAsset(event, request) {
  const cache = await caches.open(STATIC_CACHE);
  // Keyed by the whole request, not by pathname: a /_next/image entry carries
  // url/w/q in the query string, and that query string IS its identity.
  const hit = await cache.match(request);
  if (hit) return hit;
  // No catch: if the NETWORK throws we let it, so a missing subresource fails
  // exactly the way it would with no worker installed.
  const res = await fetch(request);
  if (res.status === 200) {
    // Fire-and-forget for a sharper reason than in navigate(): an awaited
    // cache.put that rejects takes the promise handed to respondWith down with
    // it, and the browser surfaces that as a failed subresource. A full disk
    // would kill the JS chunk for a document the network served perfectly
    // well — a dead, un-hydrated page that would have loaded fine with no
    // worker at all, i.e. the exact opposite of what the line above promises.
    saveInBackground(event, STATIC_CACHE, STATIC_LIMIT, request, res.clone());
  }
  return res;
}

/**
 * Network-first ferry snapshot, single-entry cache.
 *
 * The cached copy is stamped with X-SW-Fetched-At; the live one is not. That
 * asymmetry IS the contract the ferry board reads: a service-worker-served
 * response resolves with res.ok === true and no error, so the presence of that
 * header is the only way the client can tell "saved copy" from "live".
 */
async function ferryStatus(event, request) {
  // The try wraps the NETWORK and nothing else — same rule as navigate() and
  // staticAsset(). If the stamp-and-store below were inside it, a full disk
  // would look identical to a dead network: we would answer a perfectly good
  // live poll with the saved copy, and the boards would print
  // "Offline — saved times as of…" to somebody sitting on full LTE.
  let res;
  try {
    res = await fetch(request);
  } catch {
    const cache = await caches.open(DATA_CACHE);
    const saved = await cache.match(FERRY_STATUS_PATH);
    if (saved) return saved;
    // Nothing saved yet. A 503 with no body lets the board's existing catch
    // keep whatever it already had on screen.
    return new Response(null, { status: 503 });
  }

  // res.ok, not just "it resolved": this route returns 500 whenever Postgres
  // is unreachable, and a 500 is a perfectly resolved fetch. Storing it would
  // overwrite the last-known-good board with an error page — the exact failure
  // this worker exists to prevent.
  if (res.ok) stampAndStore(event, res.clone());

  // Always the ORIGINAL response to the page — unstamped, so a live poll is
  // never mistaken for a saved one.
  return res;
}

/**
 * Store the ferry snapshot with an X-SW-Fetched-At stamp, off the response path.
 *
 * Stamping needs the decoded body, so it cannot reuse saveInBackground (which
 * takes a ready-made Response). Same contract though: fire-and-forget, every
 * failure swallowed, event.waitUntil to keep the worker alive for the write.
 */
function stampAndStore(event, cloned) {
  const write = (async () => {
    const body = await cloned.arrayBuffer();
    const headers = new Headers(cloned.headers);
    // These two describe the wire form, not the decoded buffer we are about to
    // store; carrying them over would be a lie about the stored body.
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.set("X-SW-Fetched-At", new Date().toISOString());
    const cache = await caches.open(DATA_CACHE);
    await cache.put(
      FERRY_STATUS_PATH,
      new Response(body, { status: cloned.status, statusText: cloned.statusText, headers }),
    );
  })().catch(() => {});
  try {
    event.waitUntil(write);
  } catch {
    // The event's lifetime already ended. The visitor has their response.
  }
}

/**
 * Store a response WITHOUT putting the write in front of the visitor.
 *
 * Nothing here is awaited by the caller, and that is the entire job of this
 * function. cache.put rejects with QuotaExceededError on a phone with a full
 * disk — routine for a visitor whose camera roll is full — and a cache write is
 * bookkeeping: it must never change what appears on screen. Both callers hand
 * us a res.clone() and return the original immediately.
 *
 * event.waitUntil keeps the worker alive long enough for the write to land (a
 * worker killed mid-put simply saves nothing, and the next visit tries again).
 * The try around it covers the one remaining case where waitUntil itself throws
 * because the event's lifetime has already ended — even that must not cost
 * anybody a page.
 */
function saveInBackground(event, cacheName, limit, key, response) {
  const write = caches
    .open(cacheName)
    .then((cache) => cache.put(key, response))
    .then(() => trim(cacheName, limit))
    .catch(() => {});
  try {
    event.waitUntil(write);
  } catch {
    // Nothing useful to do and nowhere useful to say it: the response is
    // already on its way to the visitor either way.
  }
}

/**
 * FIFO trim. cache.keys() resolves in insertion order, so the oldest entries
 * are first. Deliberately FIFO and not LRU: an LRU needs a cache write on every
 * read, which is a lot of disk churn to buy an eviction order nobody will
 * notice at these sizes.
 */
async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const excess = keys.length - limit;
  for (let i = 0; i < excess; i += 1) {
    await cache.delete(keys[i]);
  }
}
