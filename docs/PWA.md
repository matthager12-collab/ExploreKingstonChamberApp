# PWA & offline (E13)

Explore Kingston installs to a home screen and keeps working with no signal.
The whole thing is **dependency-free**: one hand-written `public/sw.js`, one
`src/app/manifest.ts`, one client mount (`src/components/pwa.tsx`), and a small
IndexedDB outbox (`src/lib/outbox.ts`). No Workbox, no Serwist, no build step —
the worker ships from `public/` exactly as it is written, so what you read in
that file is what runs on a visitor's phone.

Why it exists: Kingston has thin spots (the ferry holding lane, Point No Point,
most of the way to Hansville). A visitor who already loaded the ferry board
should still see it — and must be told, plainly, that it is a saved copy.
**Every offline surface in this epic carries an honest freshness label.** That
is the point of the feature; a silent stale board would be worse than no board.

Companion docs: [OPERATIONS.md](OPERATIONS.md) §5 (the operator pointer),
[DEPLOY.md](DEPLOY.md) (build + deploy), [PRIVACY.md](PRIVACY.md) (what we do
and do not store on a device).

---

## 1. Strategy table

Read `public/sw.js` top to bottom — the `fetch` handler's branch **order is a
security property**, not a style choice, and the file says so at each branch.
This table is that handler, in order. The worker's own numbered comments only
run 1–6: rows 3 and 4 are a single branch in code (the ferry carve-out is
nested *inside* the deny check), and rows 5 and 6 are a single `navigate()`
call that decides internally whether the path is allowlisted.

| # | Route class | Strategy | Cache | Bound | Staleness label |
|---|---|---|---|---|---|
| 1 | Any non-`GET` | Not intercepted — no `respondWith` | — | — | n/a — writes belong to the outbox (§4), never to a cache layer |
| 2 | Cross-origin `GET` (WSDOT, map tiles, fonts) | Not intercepted | — | — | n/a — third parties keep their own caching rules |
| 3 | `/admin/*`, `/portal/*`, `/api/*` | **Never cached** — one exact-path exception, row 4. Passes through untouched | — | — | n/a |
| 4 | `GET /api/ferry/status` (exact string equality, nested inside branch 3) | Network-first; `cache.put` only when `res.ok` | `vk-data-*` | 1 entry | Cached copy is stamped `X-SW-Fetched-At`; the live copy is not. Both boards read that header and render the amber line: *"Offline — saved times as of H:MM. Not live; confirm at wsdot.wa.gov/ferries when you're back online."* Two-way wording and a date qualifier — see below the table |
| 5 | Navigation (`request.mode === "navigate"`) to a path in `NAV_ALLOWLIST` | Network-first; `cache.put` only when `res.status === 200 && !res.redirected` | `vk-shell-*` | 9 entries, FIFO | `<OfflineBanner/>` (`src/components/pwa.tsx`): *"You're offline — showing saved info from H:MM."*, or the time-less *"You're offline — showing saved info."* when the timestamp fails the honesty gate (§7) |
| 6 | Any other same-origin navigation | Network-first, **never cached**. On failure: saved copy → `/offline` → a plain-text 503 | — | — | `/offline` says it in prose; the banner's time clause is suppressed on that **document**, wherever it is served from (§7) |
| 7 | `/_next/static/*`, `/brand/*`, and `/_next/image?url=/brand/…` **only** | Cache-first | `vk-static-*` | 80 entries, FIFO | None needed for `/_next/static/*` — content-hashed and immutable. `/brand/*` is not: its urls are stable, and cache-first means no revalidation, so a **replaced** logo or icon reaches an already-visited device only on a `VERSION` bump (§3.1) |
| 8 | Everything else same-origin `GET` (e.g. `/manifest.webmanifest`, `/geo/*.json`) | Not intercepted | — | — | n/a. `/manifest.webmanifest` *is* warmed into the static cache at install, but no fetch branch ever reads it back — §2 |

**The amber ferry label has two wordings, and the difference is a promise.**
Both boards (`src/app/ferry/ferry-board.tsx` and `src/components/next-ferries.tsx`)
carry the same `Stale = { at, reason }` state and the same two strings:

- `reason: "offline"` — the fetch threw, or the worker handed back its stamped
  copy: *"Offline — saved times as of H:MM. Not live; confirm at
  wsdot.wa.gov/ferries **when you're back online**."*
- `reason: "unavailable"` — the fetch **resolved** with a non-`ok` status: our
  own route 500ing (Postgres unreachable), or the worker's bodyless 503 when it
  has nothing saved yet. *"Can't reach live times — saved times as of H:MM. Not
  live; confirm at wsdot.wa.gov/ferries."*

Only the offline wording may promise that reconnecting fixes it. A resolved
non-`ok` usually means the visitor has four bars and *we* are broken, so
"Offline" would send them hunting for a signal problem they do not have, and
"back online" would be a promise we cannot keep. The wording is deliberately
one-directional: it never claims the visitor is offline on evidence that only
proves our server answered badly. Do not collapse the two.

Both wordings run the instant through `savedAtLabel()`, which **prepends the
date whenever the saved copy is from a different Pacific day** — *"saved times
as of Sat, Jul 19, 4:02 PM"* rather than a bare *"4:02 PM"*. A device that has
been in a bag since yesterday must not print a time that reads like this
morning.

`NAV_ALLOWLIST` is **exact-pathname membership, never a prefix**. A prefix on
`/events` would swallow `/events/suggest` (which renders an admin preview of
unpublished events); a prefix on `/ferry` would swallow `/ferry/plan`. Today it
is `/`, `/ferry`, `/eat`, `/events`, `/parking`, `/about`, `/offline`.

Three routes are **deliberately absent** and `tests/unit/sw-contract.test.ts`
fails the build if any of them is added: `/ferry/plan` (the prediction flag
defaults off with no seed record, so it `notFound()`s for every visitor today —
allowlisting it would cache a 404), `/webcams` and `/map` (useless offline and
heavy enough to blow the shell budget; tiles are the deferred NFR-97 item, §6).

Branch 3 must precede 4–7 because `/api/hunts/photo` serves **admin-only
moderation photos** with an image destination, and `/api/map/image` and
`/api/events/attachment` are the same shape. A "cache all same-origin images"
rule running first would put the moderation queue into a cache on a shared
device — normal in a ferry town. The same-file exact-equality carve-out for
`/api/ferry/status` exists because `/api/ferry/observe` and
`/api/ferry/accuracy` are **state-mutating GETs**: a `startsWith("/api/ferry")`
match would make every offline retry write to the database. The contract test
greps for that prefix form and fails on it.

**Row 7's `/_next/image` rule is a decoded query check, not a prefix — and that
is a privacy decision, not tidiness.** Every `<Image>` in the app uses Next's
default loader, so the wire request for the logo is really
`/_next/image?url=%2Fbrand%2Flogo-…png&w=1920&q=75`: pathname `/_next/image`,
which matches neither `STATIC_PREFIXES` entry. But that same pathname also
sails straight past branch 3's deny check, because the optimizer carries its
real target in the **query string** — `/_next/image?url=%2Fapi%2Fhunts%2Fphoto%2F123`
has nothing under `/api` in its pathname at all. So `isBrandImage()` decodes
the `url` parameter itself and cache-firsts **only** our own `/brand/` files
(with a `".."` test, because `/brand/../api/hunts/photo/123` does start with
`/brand/`). Everything else the optimizer serves — including any future
`<Image>` someone drops onto a moderation screen — falls through untouched.
**Do not fold this into `STATIC_PREFIXES`.**

---

## 2. Cache inventory

Naming scheme: **`vk-<role>-<VERSION>`**. Every cache name ends with the
version string, and `activate` deletes every cache that starts with `vk-` and
does **not** end with `-${VERSION}`. The `vk-` prefix guard matters — this
origin also hosts caches this app did not create, and deleting those would be
someone else's outage. `VERSION` is **`"v2"`** today, so the live names are
`vk-shell-v2`, `vk-static-v2`, `vk-data-v2`.

| Cache | Holds | Cap | Eviction |
|---|---|---|---|
| `vk-shell-*` | The single `PRECACHE` entry (`/offline`), then one HTML entry per allowlisted path | `SHELL_LIMIT` = `NAV_ALLOWLIST.length + 2` = **9** | FIFO `trim()` after every write |
| `vk-static-*` | `/_next/static/*`, `/brand/*`, optimizer-served brand imagery (`/_next/image?url=/brand/…`), and the three `PRECACHE_STATIC` entries warmed at install: `/manifest.webmanifest`, `/brand/icon-192.png`, `/brand/icon-512.png` | `STATIC_LIMIT` = **80** | FIFO `trim()` after every write |
| `vk-data-*` | Exactly one entry, keyed `/api/ferry/status` | **1**, by construction (fixed key) | Overwritten by every successful poll |

The footprint is **bounded by construction** — that is M-18-04 / T&L NFR-97's
"measurable, evictable footprint" half, and it is why every cap is a named
constant rather than a comment.

Notes that are load-bearing:

- **Shell entries are keyed by `url.pathname`, not by the `Request`.** The
  installed app's `start_url` is `/?source=pwa`; keying by request would file
  the home page under a key a later plain `/` visit never matches.
- **Static entries are keyed by the whole `Request`**, deliberately the other
  way round: a `/_next/image` entry carries `url`/`w`/`q` in its query string,
  and that query string *is* its identity.
- **`PRECACHE` is a list of exactly one, and that is load-bearing.** The shell
  cache is also where page navigations land, and it is trimmed FIFO — so
  precached entries, being the oldest by definition, are first in line for
  eviction. Parking the icons there would have put the one asset we cannot
  afford to lose (`/offline`) at the front of the queue. With the list at one,
  the shell budget is a budget for the allowlist and nothing else: seven
  allowlisted pathnames (`/offline` is one of them) against a cap of nine, so
  **ordinary browsing can never evict the offline fallback**.
- **The install icons and the manifest are precached into the *static* cache**
  (`PRECACHE_STATIC`), which is where the `/brand/` fetch branch reads the icons
  back from anyway. Two of the manifest's three icons are warmed this way; the
  maskable 512 is not, and is simply cached on demand by that same branch the
  first time anything asks for it. `/manifest.webmanifest` is the odd one out:
  no fetch branch matches it (row 8), so the worker never serves that entry
  back — the browser keeps its own copy. Belt-and-braces, not load-bearing.
- **`trim()` is FIFO, not LRU.** `cache.keys()` resolves in insertion order, so
  the oldest goes first. An LRU would need a cache write on every read — a lot
  of disk churn to buy an eviction order nobody notices at these sizes.
- **Both precache lists use per-entry `cache.add(url).catch(() => {})`, never
  `cache.addAll()`.** The bulk form rejects atomically, so one missing asset
  kills the install and the worker **silently never activates** — no error
  anywhere a volunteer would look. A missing icon should cost one icon, not the
  whole offline story. The contract test forbids `addAll(`.

---

## 3. Shipping a new worker: `VERSION` bump, and the kill switch

### 3.1 Normal update — bump `VERSION`

**Bumping `VERSION` in `public/sw.js` is the only supported cache
invalidation.** There is no other lever.

1. Edit `public/sw.js`. Change `const VERSION = "v2";` to `"v3"`, and leave a
   one-line note next to it saying what changed — the `v2` bump carries one
   (the `v1` caches were filled by earlier fetch logic that never stored brand
   imagery and could let a failed cache write change which page a visitor was
   handed, so a returning device drops them wholesale rather than carrying that
   state forward).
2. Deploy normally. Every cache name changes with it, `activate` deletes every
   `vk-*` cache that does not end in the new version, and `skipWaiting()` +
   `clients.claim()` mean already-open tabs get the new worker without waiting
   for every tab to close.
3. Bump it whenever the caching *strategy* changes. You do **not** need to bump
   it for ordinary app deploys — `/_next/static/*` is content-hashed, and shell
   HTML is network-first, so a normal release refreshes itself. The one deploy
   that **does** need a bump is a **brand-asset replacement** — a new logo,
   hero, or install icon at the same url. Those are cache-first with no
   revalidation (§1 row 7), so a device that has already visited keeps serving
   the old bytes until its `vk-static-*` cache is dropped.

Two defences already sit in front of a stale worker, and both matter:

- `next.config.ts` serves `/sw.js` with `Cache-Control: no-cache, no-store,
  max-age=0`, so the browser cannot pin an old worker file.
- `src/components/pwa.tsx` registers with `{ scope: "/", updateViaCache:
  "none" }`, which makes the browser revalidate `/sw.js` itself rather than
  trusting its own HTTP cache.

> **`headers()` resolves at BUILD time** into `routes-manifest.json`. Changing
> the `/sw.js` cache header therefore requires a **rebuild + redeploy** —
> **never** a Render restart. A restart re-runs the existing bundle and the old
> header comes right back. Same class of trap as the E09 "restart ≠ env inject"
> lesson (OPERATIONS.md §3).

### 3.2 KILL SWITCH runbook

Use this when the worker itself is the problem — visitors stuck on stale pages,
a caching bug you cannot diagnose live, or any "turn it off now" call. Two
steps, in order. Step 1 fixes almost everything; step 2 is the nuclear option.

**Step 1 — bump `VERSION` and deploy.** This drops every `vk-*` cache on the
next activate. If the bug is bad cached *content*, you are done here.

**Step 2 — nuclear: ship a self-unregistering worker.** If the bug is in the
worker's *logic* (a fetch handler serving the wrong thing, an install loop), a
version bump is not enough — the broken code still runs. Replace the entire
contents of `public/sw.js` with this, and deploy:

```js
// KILL SWITCH (E13). Temporary worker: deletes every cache, unregisters
// itself, and reloads open tabs so they come back with no worker at all.
// Deploy this in place of the real public/sw.js, confirm recovery, then
// restore the real file with a bumped VERSION.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.map((name) => caches.delete(name))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => clients.forEach((client) => client.navigate(client.url))),
  );
});
```

Deliberately **no `vk-` filter** here, unlike the real `activate` handler: a
kill switch should leave nothing behind, and this app puts nothing else in
CacheStorage. Every visitor who loads any page picks this worker up (the
`no-store` header guarantees the browser fetches it), it wipes and unregisters,
and the site reverts to a plain online-only web app.

**Recovery:** restore the real `public/sw.js` with a bumped `VERSION` and
deploy. Devices re-register on the next visit. Do not skip the bump — a
returning device may still hold caches from before the kill switch.

**Keep the `KILL SWITCH (E13)` comment on line 1 — it is load-bearing, not
decoration.** `main` is branch-protected on a green `ci` check, and
`tests/unit/sw-contract.test.ts` asserts the *normal* worker's structure —
allowlist, deny prefixes, GET-only guard, caching branches. The kill-switch
worker has none of those, so without that sentinel the test goes red, `ci` goes
red, and the emergency PR **cannot be merged** — at exactly the moment you need
it merged. The test looks for that exact string and, when it finds it, checks
the kill-switch contract instead (takes over immediately, deletes every cache,
unregisters, serves no traffic). Delete or reword the comment and you are back
to a red build.

What the sentinel does *not* waive: the privacy floor. The forbidden-token table
(no `sync`, `periodicsync`, `push` or `message` listeners) runs in both modes.
An emergency worker is still a worker.

**Both steps require a rebuild + redeploy.** There is no admin toggle, no env
var, and no dashboard button for any of this — deliberately. A kill switch that
can be tripped from a phone is a kill switch that gets tripped by accident.

---

## 4. The outbox + idempotency contract

This is the half of E13 that outlives E13. **E20 (volunteer check-in) and E26
(guest concierge) must consume `src/lib/outbox.ts` and
`claimIdempotencyKey()` rather than rolling their own** — an offline write path
per epic is how you end up with four different double-submit bugs.

### 4.1 There is no Background Sync, on purpose

**This design never uses Background Sync** (`sync`), Periodic Background Sync,
or push, and `tests/unit/sw-contract.test.ts` fails the build if a listener for
any of them is ever added to `public/sw.js`. The reason is not taste: **iOS
Safari does not implement Background Sync and there is no sign it ever will**,
and iOS is the majority of the visitors this app is built for. A retry
mechanism that works on Android and silently does nothing on iPhone is worse
than no mechanism, because nobody would notice it was broken. So the outbox
replays from the **page**, on two triggers only, both in
`src/components/pwa.tsx`: on mount (every page load) and on every `window`
`"online"` event. That pair *is* the Background Sync replacement. Each is also
a permission surface and a wake-up path we have no operational story for, which
is the secondary reason to keep them out.

### 4.2 Entry shape

```ts
// src/lib/outbox.ts
export type OutboxEntry = {
  id: string;                        // random UUID; doubles as the idempotency key
  url: string;                       // same-origin POST target
  body: string;                      // JSON.stringify'd payload
  contentType: "application/json";
  createdAt: number;                 // epoch ms
  attempts: number;
};
```

Stored in IndexedDB database **`vk-outbox`** v1, object store **`requests`**,
`keyPath: "id"`. Every IndexedDB touch sits inside a function behind a
`typeof indexedDB === "undefined"` guard — the module is imported by client
components that also render on the server, where a bare `indexedDB` reference
is a `ReferenceError`, not `undefined`.

Callers use one function:

```ts
const result = await submitOrQueue("/api/survey", payload);
if (result.status === "queued") { /* say so honestly in the UI */ }
```

`submitOrQueue` never throws. It returns `{ status: "sent" }` or
`{ status: "queued" }`. `flushOutbox()` runs the replay pass and is safe to call
on every mount and every `online` event; it takes a Web Lock (`vk-outbox`,
`ifAvailable: true`) when the browser has one so two tabs do not flush at once,
and runs unguarded when it does not — a rare double flush replays with the
stored key, and the server collapses it.

### 4.3 The `X-Idempotency-Key` header

Every submission carries the entry's `id` in the **`X-Idempotency-Key`**
request header, and **a replay reuses the same key**. That is the entire reason
a double delivery is harmless.

The key is a random UUID (`crypto.randomUUID()`, falling back to
`getRandomValues` on insecure origins). It is **never derived from or joined to
any user, device, or session identifier** — an MHMDA/privacy floor: the outbox
must not become a tracking mechanism. `idempotency_keys` holds no personal data
and needs no `PII_STORES` entry.

### 4.4 Server half — claim semantics

```ts
// src/lib/db/idempotency.ts (server-only; must live under src/lib/db/ because
// only the data layer may import the DB client — a dependency-cruiser rule and
// an eslint rule both hard-fail otherwise)
claimIdempotencyKey(key: string, scope: string): Promise<"claimed" | "duplicate" | "invalid">
releaseIdempotencyKey(key: string): Promise<void>
```

A valid key matches `/^[A-Za-z0-9-]{8,64}$/` — the upper bound is the
`varchar(64)` column width. Validation runs before the query so a 70-character
key surfaces as a clean 400, not a driver error.

| Verdict | Meaning | What the endpoint must do |
|---|---|---|
| `"claimed"` | First time this key has been seen in this scope | Do the work, then return success |
| `"duplicate"` | Already claimed | Return **success without redoing the work** (`/api/survey` answers `{ ok: true, duplicate: true }`) |
| `"invalid"` | Malformed key | **400.** A malformed key is a broken client, not a replay — callers must be able to tell those apart |

The claim is atomic by construction: a single
`INSERT … ON CONFLICT DO NOTHING … RETURNING`, with the verdict read from
`rows.length` (1 on insert, 0 on conflict). Do **not** read `rowCount`:
node-postgres populates it, PGlite (the vitest engine) populates `affectedRows`
and leaves `rowCount` undefined, so a `rowCount`-only read makes every claim
look like a duplicate under test.

**Placement inside the endpoint is load-bearing.** Claim **after** validation
and **before** the save:

- Claiming before validation burns the key on a body that is then rejected. The
  outbox deletes its copy on a 400 (§4.5), so the answer is gone *and* the
  replay can never land.
- An endpoint that does not claim the key at all is **not safe to put behind
  this outbox.** That is the contract, not a suggestion.

**The compensating release.** `POST /api/survey` swallows store failures and
still answers `{ ok: true }` — it will not fail a visitor's request over
telemetry. Combined with a pre-save claim, a transient DB outage would become
*permanent* loss: the outbox deletes on the 200, and every replay is answered
"duplicate" for a body that was never persisted. So the route calls
`releaseIdempotencyKey(key)` in the save's `catch`. It is best-effort and never
throws — a stranded key costs one lost retry, and a throw there would mask the
original failure. **Any future consumer that can return success on a failed
save owes the same release.**

### 4.5 Delivered statuses, and why 429 is excluded

`isDeliveredStatus(status)` decides whether a replay removes the entry:

| Status | Delivered? | Why |
|---|---|---|
| `2xx` | **yes** | The server accepted it |
| `409` | **yes** | Already processed — the idempotent intake saying a previous pass got there first. Delivered, not failed |
| `400` | **yes** | Permanently malformed. No retry fixes the body, and a stuck entry at the head of the queue blocks everything behind it |
| `413` | **yes** | Permanently too large (`/api/survey` caps bodies at 8 KB). Same class as 400 — the payload will not shrink on its own |
| `429` | **no** | `/api/survey` rate-limits **5 per 10 minutes per IP**. A device that queued six answers offline would delete real submissions it was merely being throttled on |
| `5xx` | **no** | Server reached but unhealthy |

`429` and `5xx` increment `attempts`, **stop the pass**, and age out through
`shouldDrop()` instead of being thrown away on the spot. Stopping the pass is
deliberate: pushing the rest of the queue at a throttled or struggling server is
the wrong instinct.

### 4.6 "An HTTP response means don't queue"

`submitOrQueue` returns `{ status: "sent" }` **whenever the server was
reached — including 4xx and 5xx**. Only a thrown `fetch` (DNS/transport
failure, i.e. genuinely offline) queues. Retry policy for a 5xx belongs to the
caller, not to the queue: **blind re-queueing of server errors is how
poison-pill loops start.**

### 4.7 The queue is bounded

Entries are dropped when **age > 7 days** *or* **attempts > 25**
(`shouldDrop()`, pinned by `tests/unit/outbox-policy.test.ts`). Nothing here
holds a visitor's answer — or any PII — indefinitely. A replay pass that is
still offline counts one attempt and returns rather than burning all 25 on a
single tunnel.

### 4.8 Warning for E20 / E26: JSON only

**The entry shape carries `body: string` + `contentType: "application/json"`.
It cannot carry multipart.** The most obvious next consumer,
`POST /api/hunts/submit`, takes **multipart `FormData`** (a photo), so it does
**not** fit this outbox as written. Queuing a photo needs a contract extension
— a `Blob`-carrying variant of `OutboxEntry`, a size bound on what is worth
holding on a phone, and a decision about whether a queued photo should count
against the device's storage story. Do that work explicitly; do not quietly
`JSON.stringify` a `FormData` and hope.

---

## 5. The 30-day idempotency-key sweep

`sweepIdempotencyKeys()` in `src/lib/db/idempotency.ts` deletes rows from
`idempotency_keys` older than 30 days. Thirty days is far past any plausible
replay window — the outbox itself drops entries after 7 — so a swept key can
only be re-claimed by a client that had already given up.

It is **opportunistic**, not scheduled: a module-level deterministic counter
fires it every **50** claims (`SWEEP_EVERY`), fire-and-forget, errors swallowed.
Deterministic rather than `Math.random()` because that is the repo's existing
prune idiom (`src/lib/stores/ferry-observations.ts`) and because a random gate
is not unit-testable without stubbing the RNG. **There is no cron entry and
none is needed** — the table only grows when someone posts, so the thing that
grows it is the thing that prunes it.

`idempotency_keys` is operational metadata, not a record: writes bypass the
`writeRecord` choke point and emit **no audit rows** (a dedupe claim is not a
record edit, and an audit row per replayed POST would be pure noise). It is
also **not in the backup bundle** — transient dedupe state with zero restore
value.

> **Deliberately NOT in `RETENTION_POLICY`.** That manifest
> (`src/lib/privacy/policy.ts`) is an **ask-first human floor**: it is rendered
> verbatim on the public `/privacy` page and pinned by three test files. It
> describes what we promise visitors about *their* data. This sweep is an
> internal housekeeping detail about a table that holds no personal data, and
> adding an entry for it would both break those tests and dilute a page whose
> value is that every line on it is a promise. If a future epic makes these keys
> joinable to anything about a person, that decision changes — and it is an
> ask-first conversation with Mat, not a code change.

---

## 6. Deferred / out of scope

**Offline map tiles for a Kingston bounding box.** This is the remaining half
of T&L NFR-97 (the bounded-cache requirement; E13 delivered the "measurable,
evictable footprint" half — §2). It is deliberately not built because it needs
a **size-disclosure UX** first: an explicit, up-front "this will download ~N MB"
consent step, a defined bounding box, a visible footprint the visitor can
evict, and **no silent background prefetch**. Shipping tiles without that would
violate the very requirement it is meant to satisfy. `/map` and `/webcams` are
excluded from `NAV_ALLOWLIST` for the same reason.

**Web push / VAPID / notification permission flows — E21 owns all of it.**
`public/sw.js` has no `push` listener and no `PushManager` reference, and the
contract test fails the build on either. E13's install nudge is push's
*prerequisite* (iOS only permits web push from an installed app), not push
itself. Anything notification-shaped belongs in E21, including the permission
prompt copy.

**Not in scope, and worth naming:** offline *writes* beyond the visitor survey
(the outbox exists; consumers are E20/E26's work), any payment path, and
offline access to `/admin` or `/portal` — those pathnames are never cached at
all (§1, branch 3). An admin's render of a *public* page is a different
question, and an open one: §7, "Admin preview cache poisoning".

---

## 7. Known limitations

Stated honestly, because each one is a real thing a visitor or an operator can
hit.

**Side-of-water is baked into the cached HTML.** `/` and `/ferry` render
differently depending on the `vk-side` cookie (Kingston side vs Edmonds side).
The service worker caches one HTML entry per pathname, so it caches **the side
that was current when the page was last online**. Switching sides while offline
writes the cookie and calls `router.refresh()`, which cannot reach the server —
so the page silently keeps showing the previously-cached side. There is no
in-worker fix short of keying the shell cache by cookie value, which would
double the shell footprint for a case that mostly resolves itself the moment
signal returns. Know about it before you debug it.

**Any allowlisted page can become a 404 at runtime.** A Chamber admin can hide
`/eat`, `/events`, `/parking`, `/about` or `/ferry` from `/admin/content`, which
turns an allowlisted path into a `notFound()`. That is exactly why the
navigation branch caches **only** `res.status === 200 && !res.redirected`: a
cached 404 would outlive the admin un-hiding the page, with no way for a
visitor to escape it. What that guard does **not** cover is the admin's own
view of a hidden page — which is a 200 by design — see "Admin preview cache
poisoning" below.

**Two staleness labels can show at once, and that is correct.** The top banner
answers "is this page a saved copy?"; the amber ferry line answers "are these
times a saved copy?"; the existing "schedule not live" note answers "is the WSF
*feed* live?". All three are different questions and all three can legitimately
be true together. The WSDOT link is repeated between them on purpose — do not
"dedupe" them.

**The banner drops its timestamp rather than guess — and it identifies the
document, not the url.** `/offline` is statically prerendered (it must be, so
the worker can precache it), which freezes its `renderedAt` at **build** time.
Printing "saved info from 4:02 AM" over a page that carries no saved anything
would be precisely the dishonesty this epic exists to prevent, so the time
clause is suppressed there.

The mechanism is a **meta marker, not a pathname test**, because the pathname
gets this backwards in the normal case. When a navigation to `/stay` fails, the
worker returns the precached `/offline` document and **leaves `/stay` in the
address bar** — Next builds `usePathname()` from `window.location`, not from
the document it received, so the router says "/stay" while the screen says
"You're offline". Being served under somebody else's url is that page's entire
job; a hand-typed visit to `/offline` is the rare case. So
`src/app/offline/page.tsx` declares `other: { "vk-offline-fallback": "1" }` in
its metadata, which renders as `<meta name="vk-offline-fallback" content="1">`
inside the HTML, and `<OfflineBanner/>` reads it back with a
`document.querySelector` behind `useSyncExternalStore` (server snapshot `false`,
so hydration matches). The `pathname === "/offline"` test is kept as a **second,
free answer** for the one case a url can settle, so a future metadata edit that
loses the marker still cannot put a build time on that page.

The clause is suppressed again — on any page — for a timestamp that is
unparseable, more than a minute in the future, or more than 24 hours old, which
covers any route that later loses its `revalidate` without anyone remembering
this file. In all those cases the banner still shows; it just reads *"You're
offline — showing saved info."* with no time on it.

**No service worker in development.** Registration is gated on
`process.env.NODE_ENV === "production"`. A cache-first worker plus hot reload is
exactly how a developer gets locked out of their own dev server. To exercise
offline behaviour locally you need a production build served from the
standalone bundle (`node server.js`), not `npm run dev`.

**Best-effort everywhere, silently.** Private-mode Safari, denied quota, an
insecure origin, a blocking older tab: `openDb()` resolves `null` and the write
really is lost. The outbox still reports `"queued"` — the only other answer
("sent") is a strictly stronger false claim. Likewise, a browser with no service
worker support just gets the plain online app. No error is ever surfaced to a
visitor for any of this.

**Branded error screens do not render for bots.** Next renders a graceful
degrade boundary instead of `src/app/global-error.tsx` for bot user-agents, and
segment boundaries keep rendering children. Verify `error.tsx` /
`global-error.tsx` manually with a **normal browser UA** — a curl or a crawler
will not show you what a visitor sees.

### Known limitations / deferred — found, understood, not fixed

Three things were identified during E13's review and **deliberately left
standing**. They are written down here so the next person finds them as a
decision rather than rediscovering them as a surprise. None is a mystery; each
one's durable fix is named.

**1. Admin preview cache poisoning — mitigated, not closed.** `assertPageVisible()`
lets an admin through to a page that is hidden from the public: they get a
normal **HTTP 200** render with `<HiddenPageBanner/>` on top. The worker cannot
tell that render apart from a visitor's — fetch events never carry the session
cookie — so `navigate()` sees "200, not redirected, allowlisted pathname" and
files the admin's copy in the shell cache under the bare pathname. Signing out
clears the cookie, not CacheStorage.

The mitigation is a self-eviction: `<HiddenPageBanner/>` (in
`src/lib/page-visibility.tsx`) mounts `<HiddenPreviewEvict/>`
(`src/lib/hidden-preview-evict.tsx`), a render-nothing client child that deletes
`window.location.pathname` out of every `vk-shell-*` cache. Rendering that
banner is the only proof available in the browser that these bytes are an
admin-only preview.

**Residual exposure, stated plainly:** the eviction is a client effect racing a
fire-and-forget cache write (`saveInBackground` is not awaited before the
response is returned), and it is a silent no-op wherever `caches` is
unavailable. So it can miss — the admin closes the tab before hydration, the
put lands after the delete, private mode, an insecure origin. When it misses,
on a shared device — the front-desk or volunteer tablet — a later **offline**
visitor is handed the hidden page, admin banner string and all: *"Hidden page —
visitors get a 404. Only admins can see this preview."* It is bounded (one
pathname, that one device, only while offline, until the next successful online
load overwrites the entry or `VERSION` is bumped) but it is real, and it is why
this is written down instead of closed out.

The durable fix is to mark personalised renders uncacheable at the auth proxy,
so the worker never sees a 200 worth storing. That is a `src/proxy.ts` change
and belongs to whichever epic owns that file — outside E13's charter.

**2. Claim-before-save has no completion state.** `claimIdempotencyKey()`
commits its `INSERT` before the survey row is written (§4.4 — that ordering is
correct, and the alternative is worse). The ordinary failure case is covered:
`/api/survey` calls `releaseIdempotencyKey()` in the save's `catch`. What is
**not** covered is abrupt process death between the two — a container kill, an
OOM, a lost DB connection that never resolves. The claim survives; the answer
does not; and every later replay of that key is answered `duplicate: true` for
a submission that was never stored. The visitor is told it landed, and it did
not. Frequency is very low (one narrow window, on one telemetry endpoint) and
the loss is one survey answer, which is why it was not chased. The durable fix
is a `completed_at` column on `idempotency_keys`, set after the save, with
incomplete claims expiring quickly enough to be re-claimable — a **schema
change**, deliberately deferred rather than bolted onto this epic.

**3. `renderedAt` is frozen at the document's first render.** The root layout
computes it once per server render and hands it to `<PwaClient/>`; a
**client-side (soft) navigation** re-renders segments without producing a new
document, so the banner's timestamp keeps naming the moment the *original*
document was built, not the segment now on screen. Left alone on purpose,
because the error is one-directional: `renderedAt` can only be **older** than
what is displayed, so the banner can under-claim freshness and never over-claim
it. For an honesty label that is the safe direction, and the 24-hour gate in
`honestAsOf()` bounds how far it can drift before the clause disappears
entirely.

---

## 8. Manual device matrix (Mat, on staging)

Not automatable — install prompts, the iOS Share sheet, and real airplane mode
have no test-harness equivalent. Run this on **the staging host** (see
[DEPLOY.md](DEPLOY.md)) after deploy, on real hardware, before production.
Record the date and the result here.

### iOS Safari (iPhone) — the primary target

| # | Step | Expected |
|---|---|---|
| 1 | Open the staging site in Safari. Tap **Share → Add to Home Screen** | The app name reads **Kingston**, the icon is the Explore Kingston mark (not a screenshot), and the browser chrome colour matches the site |
| 2 | Open the installed app from the home screen | Launches standalone (no Safari address bar); the status-bar area is not overlapped by content |
| 3 | Browse to the home page **and** `/ferry`, let both load fully | Ferry times visible on both. This is what seeds the cache — an untouched page cannot be offline |
| 4 | Enable **airplane mode**. Open the app again | A top strip reads *"You're offline — showing saved info from H:MM."* The ferry board still shows sailings |
| 5 | Read the ferry board carefully | The amber line reads *"Offline — saved times as of H:MM. Not live; confirm at wsdot.wa.gov/ferries when you're back online."* The time is the last time you had signal, in Kingston wall-clock — **not** the current time, **not** blank, **not** "Invalid Date". Leave the phone in airplane mode overnight and re-check: the label must gain the date (*"as of Sat, Jul 19, 4:02 PM"*), because a bare time from yesterday reads like this morning |
| 6 | Navigate to a page you did **not** open in step 3 (e.g. `/stay`) | The branded `/offline` page — **with `/stay` still in the address bar.** That is correct: the worker returns the offline document as the response to the failed url, it does not redirect. The top banner must read *"You're offline — showing saved info."* with **no time on it**. A time here (it would be the build time) is the bug §7 describes, and it means the `vk-offline-fallback` marker went missing |
| 7 | Still offline: answer the visitor survey | It accepts the answer and shows the queued wording — *"Saved — we'll send it when you're back online"*-style, **not** the plain thank-you |
| 8 | Turn airplane mode off. Reopen the app | Banner and amber line disappear; live times return |
| 9 | Check the survey landed **exactly once** — `/admin` visitor insights, or count rows for that day | **One** new response. Not zero, not two. This is the whole idempotency story in one number |
| 10 | Force-quit and reopen the app twice more | Still exactly one response — a replay of an already-delivered entry must not add a row |

### Android Chrome

| # | Step | Expected |
|---|---|---|
| 1 | Open the staging site. Leave, and return a second time | On the **second** visit the quiet install card appears ("Add Explore Kingston to your home screen") — **never** on the first |
| 2 | Confirm Chrome's own mini-infobar did **not** also appear | Only our card asks. (`beforeinstallprompt` is `preventDefault()`ed) |
| 3 | Tap **Not now** | The card disappears and **never returns**, on this or any later visit. One dismissal is permanent — there is no re-ask path anywhere |
| 4 | Clear site data, revisit twice, tap **Install** | The browser's own install dialog appears; accepting installs the app with the correct name and maskable icon |
| 5 | Repeat the iOS steps 3–10 above (airplane mode walk) | Identical behaviour: banner, amber ferry label, `/offline` fallback, queued survey, exactly one row after reconnect |

### Both platforms — the kill-switch rehearsal (once, at least)

Worth doing once on staging so the runbook in §3.2 is not the first time anyone
runs it: deploy the self-unregistering worker, confirm on a device that the app
still loads and that the caches are gone (Chrome DevTools → Application →
Cache storage shows no `vk-*` entries), then restore the real worker with a
bumped `VERSION` and confirm offline works again.

**Results log**

| Date | Platform / OS | Who | Result |
|---|---|---|---|
| _(pending)_ | iOS Safari | Mat | |
| _(pending)_ | Android Chrome | Mat | |
