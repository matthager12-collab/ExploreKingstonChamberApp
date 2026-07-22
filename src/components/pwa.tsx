"use client";

// The three browser-only PWA concerns (E13), split across TWO mount points by
// E22 because the kiosk needs one of them and must not have the other two:
//
// - <ServiceWorkerClient/> — registration + outbox replay, renders NOTHING.
//   Mounted from the ROOT layout, so the (site) and (kiosk) groups both get
//   offline support. /sw.js is registered after `load` (never in competition
//   with first paint) and only in production; the offline outbox is replayed on
//   mount and on every "online" event — there is no Background Sync in this
//   design because iOS Safari lacks it.
// - <PwaClient/> — the visible pair, mounted from the SITE chrome only:
//   - <OfflineBanner/> — a fixed strip while the device is offline, carrying an
//     honest "as of" time for the copy of the page being read.
//   - <InstallNudge/> — a quiet "add to home screen" card that asks at most once
//     in a visitor's life. Dismissing it is permanent; <InstallAppButton/> in
//     the nav's "More" surfaces is the deliberate way back in, so "never ask
//     again" never means "never installable again".
//   Neither belongs on the kiosk: "add to home screen" is meaningless on a
//   wall-mounted panel, and both are tappable UI on a device whose entire
//   design goal is that nothing can be tapped off-app. The kiosk states its own
//   offline condition through KioskShell's "be right back" screen instead.
//
// Every browser capability used here is feature-detected and every failure
// path is a silent no-op: a visitor in private mode, on an insecure origin, or
// on a browser without service workers gets the plain online app, never an
// error. Nothing here ever blocks or delays the visitor.

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { flushOutbox } from "@/lib/outbox";
import { formatPacificTime } from "@/lib/time";
import {
  isInstalled,
  isIosSafari,
  promptInstall,
  readCanInstall,
  serverCanInstall,
  subscribeToInstallPrompt,
} from "@/lib/install-prompt";

/* ── network state ──────────────────────────────────────────────────────── */

// The snapshot is 0 while online, else the epoch-ms moment we first noticed we
// were offline. Two reasons for the timestamp instead of a boolean: the banner
// needs a "now" to age-check its label (see honestAsOf) and reading Date.now()
// during render would be impure, and useSyncExternalStore needs a stable value
// — recomputing Date.now() on every getSnapshot call would loop forever.
let offlineSince = 0;

function subscribeToNetwork(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function readOfflineSince(): number {
  // navigator.onLine is only trustworthy in the negative: `false` means the OS
  // is sure there is no network. Anything else (including a browser that does
  // not implement it) is treated as online — we never claim "offline" on a
  // guess, because a wrong offline banner is a lie about the data below it.
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (!offline) {
    offlineSince = 0;
    return 0;
  }
  if (offlineSince === 0) offlineSince = Date.now();
  return offlineSince;
}

/** Server render is always "online", so the banner renders nothing and the
 *  first client render matches it exactly (no hydration mismatch). */
function serverOfflineSince(): number {
  return 0;
}

/* ── service worker + outbox replay ─────────────────────────────────────── */

function replayOutbox() {
  // Best-effort: a failed replay leaves the entries queued for the next pass.
  void flushOutbox().catch(() => {});
}

function useServiceWorkerAndOutbox() {
  useEffect(() => {
    // Anything the visitor submitted while offline goes out now — on this load
    // and again whenever the network comes back. This pair IS the replacement
    // for Background Sync.
    replayOutbox();
    window.addEventListener("online", replayOutbox);

    let cancelPendingRegistration = () => {};
    // Dev has no service worker on purpose: a stale SW serving a stale bundle
    // is the worst failure mode in this whole epic, and hot reload plus a
    // cache-first worker is exactly how developers get locked out.
    if (
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      process.env.NODE_ENV === "production"
    ) {
      const register = () => {
        navigator.serviceWorker
          // updateViaCache: "none" makes the browser revalidate /sw.js itself
          // rather than trusting its HTTP cache — the second defence against a
          // stale-worker lockout (next.config.ts's no-store header is the first).
          .register("/sw.js", { scope: "/", updateViaCache: "none" })
          .catch(() => {
            // Private mode, insecure context, or a disabled worker: the app
            // simply stays online-only. Never surfaced to the visitor.
          });
      };
      if (document.readyState === "complete") {
        register();
      } else {
        window.addEventListener("load", register, { once: true });
        cancelPendingRegistration = () => window.removeEventListener("load", register);
      }
    }

    return () => {
      window.removeEventListener("online", replayOutbox);
      cancelPendingRegistration();
    };
  }, []);
}

/* ── which document is on screen ────────────────────────────────────────── */

// src/app/offline/page.tsx puts this marker in its own metadata, so it rides
// inside that page's HTML. It is the only honest witness that the precached
// /offline document is what the visitor is looking at.
//
// The url cannot answer that question. When a navigation to /stay fails, the
// worker responds with the precached /offline document and leaves the address
// bar alone — and Next builds usePathname() from window.location, not from the
// document it received, so the router says "/stay" while the screen says
// "You're offline". Being served under somebody else's url is this page's
// entire job; a hand-typed visit to /offline is the rare case.
const OFFLINE_DOC_MARKER = 'meta[name="vk-offline-fallback"]';

function subscribeToDocument(): () => void {
  // Nothing to listen to: the marker cannot appear or vanish without a new
  // document, and a new document is a new mount. React still re-reads the
  // snapshot on every render, which is what catches a client-side navigation
  // off this page while the banner is up.
  return () => {};
}

function readIsOfflineDocument(): boolean {
  // Feature-detected like every other browser touch in this file: no document
  // means a silent "no", never a throw inside the root layout.
  if (typeof document === "undefined") return false;
  return document.querySelector(OFFLINE_DOC_MARKER) !== null;
}

/** Same shape as serverOfflineSince: the server has no document, so answering
 *  "no" here — rather than reading the DOM in the component body — is what
 *  keeps the first client render identical to the server's. React re-reads the
 *  real snapshot immediately after hydration, before the banner can appear. */
function serverIsOfflineDocument(): boolean {
  return false;
}

/* ── offline banner ─────────────────────────────────────────────────────── */

/** Oldest render we will still name a time for. See honestAsOf. */
const MAX_HONEST_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The honesty gate on the "saved info from HH:MM" clause.
 *
 * `renderedAt` is genuinely the moment this HTML was produced on the routes
 * that matter — `/` and `/ferry` are dynamic (they read cookies via getSide),
 * and the rest of the public pages are ISR with `revalidate = 60`, so their
 * prerender really is when the saved copy was made. The precached /offline
 * document is the one exception: E13 deliberately keeps it statically
 * prerendered so the service worker can hold it, which freezes its
 * `renderedAt` at BUILD time — and that document carries no saved anything, so
 * naming a time over it would be precisely the dishonesty this epic exists to
 * prevent.
 *
 * Note what the caller passes: whether the /offline DOCUMENT is on screen, not
 * whether the url is /offline. Offline those are different questions, and the
 * url gets it backwards in the common case — see OFFLINE_DOC_MARKER above.
 *
 * The clause is dropped again for any timestamp that is unparseable, in the
 * future, or more than a day old, which covers any page that later loses its
 * revalidate without anyone remembering this file.
 */
function honestAsOf(
  renderedAt: string,
  observedAt: number,
  isOfflineDocument: boolean,
): string | null {
  if (isOfflineDocument) return null;
  const rendered = Date.parse(renderedAt);
  if (!Number.isFinite(rendered)) return null;
  const age = observedAt - rendered;
  if (age < -60_000 || age > MAX_HONEST_AGE_MS) return null;
  // Kingston wall-clock, matching every other time in the app (and the ferry
  // board's own "saved times as of …" label, which sits below this one).
  return formatPacificTime(renderedAt);
}

function OfflineBanner({ renderedAt }: { renderedAt: string }) {
  const pathname = usePathname();
  const observedAt = useSyncExternalStore(
    subscribeToNetwork,
    readOfflineSince,
    serverOfflineSince,
  );
  const markerFound = useSyncExternalStore(
    subscribeToDocument,
    readIsOfflineDocument,
    serverIsOfflineDocument,
  );

  if (!observedAt) return null;

  // The marker names the document that was actually served; the pathname test
  // is kept as a free second answer for the one case a url CAN settle — a
  // visitor who typed /offline — so a future metadata edit that loses the
  // marker still cannot put a build time on that page.
  const asOf = honestAsOf(renderedAt, observedAt, markerFound || pathname === "/offline");

  return (
    // Fixed to the TOP on purpose: under 768px the bottom of the viewport
    // belongs to the fixed nav bar (site-nav.tsx) and <body> already burns its
    // padding-bottom on it. z-50 because that nav and the sticky header are
    // z-40 and both render after this component — an equal z-index would lose.
    // pt-[env(safe-area-inset-top)] because the layout sets viewportFit:"cover",
    // so an installed standalone window extends under the status bar.
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 border-b border-amber-200 bg-amber-50 pt-[env(safe-area-inset-top)] shadow-sm"
    >
      <p className="mx-auto max-w-5xl px-4 py-2 text-center text-sm font-medium text-amber-900">
        {asOf
          ? `You’re offline — showing saved info from ${asOf}.`
          : "You’re offline — showing saved info."}
      </p>
    </div>
  );
}

/* ── install nudge ──────────────────────────────────────────────────────── */

const VISITS_KEY = "vk-visits";
const DISMISSED_KEY = "vk-install-nudge";
/** Never on a visitor's first arrival — they have not decided they like us yet. */
const MIN_VISITS = 2;
/** iOS card waits this long so it never lands during first paint. */
const IOS_NUDGE_DELAY_MS = 1500;

/** Counted once per page load. The module flag (rather than a ref) survives
 *  StrictMode's double-invoked effects, so one arrival never counts twice. */
let visitCounted = false;

/**
 * Dismissed at some point during THIS page load.
 *
 * Module-scoped rather than a ref because it has to outlive the component:
 * PwaClient is mounted from the ROOT layout, so a remount is possible while the
 * document stays put, and the answer must survive it. It is also the only tier
 * that works when localStorage is readable but not writable, and it costs no
 * storage round-trip on the hot path (beforeinstallprompt can fire repeatedly).
 */
let dismissedThisLoad = false;

type NudgeMode = "prompt" | "ios";

/* The card's own gate, as a store rather than component state.
 *
 * Deciding it costs a localStorage WRITE (countVisit), so it cannot be computed
 * during render and has to be settled from an effect. Keeping the answer at
 * module scope — the same choice as dismissedThisLoad above, and read through
 * useSyncExternalStore like the three stores earlier in this file — means a
 * remount inside the same document re-reads the decision instead of reopening a
 * card the visitor already closed. */
let nudgeGateOpen = false;
const nudgeGateListeners = new Set<() => void>();

function subscribeToNudgeGate(onChange: () => void): () => void {
  nudgeGateListeners.add(onChange);
  return () => {
    nudgeGateListeners.delete(onChange);
  };
}

function readNudgeGate(): boolean {
  return nudgeGateOpen;
}

/** Closed on the server, so the first client render matches it exactly. */
function serverNudgeGate(): boolean {
  return false;
}

function setNudgeGate(open: boolean): void {
  if (nudgeGateOpen === open) return;
  nudgeGateOpen = open;
  for (const notify of nudgeGateListeners) notify();
}

function isDismissed(): boolean {
  // This-load flag first: it is authoritative the moment "Not now" is clicked,
  // with no dependency on the write below having succeeded.
  if (dismissedThisLoad) return true;
  try {
    return localStorage.getItem(DISMISSED_KEY) === "dismissed";
  } catch {
    // Storage disabled: we cannot remember a dismissal, so we must not ask.
    return true;
  }
}

function markDismissed() {
  dismissedThisLoad = true;
  try {
    localStorage.setItem(DISMISSED_KEY, "dismissed");
  } catch {
    // Nothing to do — the flag above still holds for the rest of this page
    // load, which is all we can honestly promise without storage.
  }
}

function countVisit(): number {
  try {
    const seen = Number(localStorage.getItem(VISITS_KEY) ?? "0");
    const total = Number.isFinite(seen) && seen > 0 ? seen : 0;
    if (visitCounted) return total;
    visitCounted = true;
    const next = total + 1;
    localStorage.setItem(VISITS_KEY, String(next));
    return next;
  } catch {
    // No storage, no counter, no nudge.
    return 0;
  }
}

function InstallNudge() {
  const pathname = usePathname();
  // The browser capability lives in the shared store, NOT here: it is captured
  // whether or not this card is allowed to appear, so <InstallAppButton/> in the
  // nav still works for a visitor who dismissed this card long ago.
  const canInstall = useSyncExternalStore(
    subscribeToInstallPrompt,
    readCanInstall,
    serverCanInstall,
  );
  // Closed until the effect below settles it — see the store's own note.
  const allowed = useSyncExternalStore(subscribeToNudgeGate, readNudgeGate, serverNudgeGate);
  const [iosDelayPassed, setIosDelayPassed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isInstalled() || isDismissed() || countVisit() < MIN_VISITS) return;
    setNudgeGate(true);

    // iOS Safari has no install event at all — the Share sheet is the only
    // route, so the card carries instructions instead of a button. The delay
    // keeps it from landing during first paint.
    if (!isIosSafari()) return;
    const timer = setTimeout(() => setIosDelayPassed(true), IOS_NUDGE_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  function dismiss() {
    // Never-nag doctrine: one dismissal is permanent. Note this suppresses the
    // CARD only — the nav's "Add to home screen" entry is the deliberate way
    // back in for someone who said "Not now" and later changed their mind.
    //
    // Closing the gate (rather than re-reading storage on each render) is what
    // makes the re-fires harmless: Chromium fires beforeinstallprompt again as
    // the visitor moves around the app, and every one of those re-renders has
    // to find this card closed.
    markDismissed();
    setNudgeGate(false);
  }

  function install() {
    // prompt() first, still inside the click's gesture. Whatever the visitor
    // then chooses in the browser's own dialog, we never ask again.
    void promptInstall();
    dismiss();
  }

  if (!allowed) return null;
  // The root layout is the only layout, so it wraps /admin and /portal too.
  // Chamber staff and member businesses are not the audience for this card.
  if (pathname?.startsWith("/admin") || pathname?.startsWith("/portal")) return null;

  // A real prompt beats the iOS instructions whenever the browser offers one;
  // null means this engine can do neither, so the card never appears.
  const mode: NudgeMode | null = canInstall ? "prompt" : iosDelayPassed ? "ios" : null;
  if (!mode) return null;

  return (
    // Bottom-anchored, clear of the fixed mobile nav (4.5rem + the iOS home
    // indicator inset, the same sum globals.css uses on <body>) — the ferry
    // board sits at the top of the pages that matter and must stay uncovered.
    <div className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-sm rounded-2xl border border-sand bg-white p-4 shadow-lg md:inset-x-auto md:right-4 md:bottom-4">
      <p className="text-sm font-semibold text-sound-deep">
        Add Explore Kingston to your home screen
      </p>
      <p className="mt-1 text-sm text-ink-soft">
        {mode === "ios"
          ? "Tap Share, then “Add to Home Screen” — ferry times work offline."
          : "Ferry times work offline."}
      </p>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={dismiss}
          className="rounded-full px-3 py-1.5 text-xs font-semibold text-ink-soft hover:text-ink"
        >
          {mode === "ios" ? "Got it" : "Not now"}
        </button>
        {mode === "prompt" && (
          <button
            type="button"
            onClick={install}
            className="rounded-full bg-tide px-3 py-1.5 text-xs font-semibold text-white hover:bg-tide-deep"
          >
            Install
          </button>
        )}
      </div>
    </div>
  );
}

/* ── mount point ────────────────────────────────────────────────────────── */

/**
 * Registration only — renders nothing, and deliberately so.
 *
 * Mounted from the ROOT layout (src/app/layout.tsx) rather than from the site
 * chrome, because the kiosk's offline tolerance is the same service worker.
 * Splitting it out this way is what lets the bare (kiosk) layout have a cached
 * shell without also inheriting the offline banner and the install card.
 *
 * Registering on /admin and /portal too is unchanged from E13: the worker's own
 * fetch handler denies those prefixes, so registration there caches nothing.
 */
export function ServiceWorkerClient() {
  useServiceWorkerAndOutbox();
  return null;
}

/**
 * The visible pair, mounted once from the site chrome inside CopyProvider.
 * `renderedAt` comes from the server render of that chrome — when this page is
 * later served from the service worker's cache it is the age of the copy being
 * read, which is what the offline banner reports.
 */
export default function PwaClient({ renderedAt }: { renderedAt: string }) {
  return (
    <>
      <OfflineBanner renderedAt={renderedAt} />
      <InstallNudge />
    </>
  );
}
