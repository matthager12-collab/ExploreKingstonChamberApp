"use client";

// Anonymous, cookie-less visit tracking for the Chamber's LTAC reporting.
//
// - <Tracker/> (wired once in the root layout) sends one "pageview" event per
//   pathname change via navigator.sendBeacon, with a fetch(keepalive)
//   fallback. sendBeacon survives navigation, so we never delay the visitor.
// - trackOutbound(href, label) records taps on outbound links — menus, order
//   links, map links, booking links — the "where they go in town" signal.
// - The session id is a random client-generated UUID kept in sessionStorage
//   ("vk-sid"): no cookies, gone when the browser session ends, never tied to
//   a person or device. Geography is derived server-side from the connection
//   (see /api/track); nothing is read from the device and no permission
//   prompt ever appears.
// - <WebVitals/> (also wired once in the root layout) reports this page load's
//   final LCP — a browser timing about the PAGE, never about the visitor. It
//   exists because the Lighthouse CI gate measures a simulated lab load, which
//   cannot tell the Chamber what a real phone on a real ferry-queue signal
//   waited for. Only LCP is emitted today; the event schema and the ingest
//   whitelist already carry CLS and INP, so adding them is a client-only
//   change (see WEB_VITAL_SPECS in src/lib/analytics-store.ts).
// - /admin paths are never tracked.

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isSensitiveOutbound } from "@/lib/privacy/policy";

const SESSION_KEY = "vk-sid";

/**
 * Marks THIS DEVICE as ours, so its events are recorded as internal and kept
 * out of every visitor number (see /api/track's isInternalRequest).
 *
 * localStorage, not sessionStorage, and that difference is the entire feature:
 * a session id should evaporate when the browser closes, whereas "this is the
 * Chamber's front-desk iPad" is true until somebody says otherwise.
 *
 * Set it by visiting any page with ?vk-internal=1 — a link you can text to a
 * board member — and clear it with ?vk-internal=0. Deliberately not behind a
 * login: most of the people whose clicks we do not want to count (a spouse
 * checking the site, a volunteer testing on their own phone, an agent driving
 * a headless browser) will never sign in at all.
 */
const INTERNAL_KEY = "vk-internal";
const INTERNAL_PARAM = "vk-internal";

// Fallback for privacy modes where sessionStorage throws.
let inMemorySessionId: string | null = null;

function newSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = newSessionId();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    if (!inMemorySessionId) inMemorySessionId = newSessionId();
    return inMemorySessionId;
  }
}

/**
 * Is this device flagged as ours? Read live from localStorage on every beacon
 * rather than cached at module scope — this file's components live in the root
 * layout and never unmount for the life of the tab, so a cached value would
 * outlive the toggle that changed it and quietly keep sending the old answer.
 */
export function isInternalDevice(): boolean {
  try {
    return localStorage.getItem(INTERNAL_KEY) === "1";
  } catch {
    return false; // private mode / storage disabled — count it as a visitor
  }
}

/** Flag or unflag this device. Exported for the admin dashboard's toggle. */
export function setInternalDevice(on: boolean): void {
  try {
    if (on) localStorage.setItem(INTERNAL_KEY, "1");
    else localStorage.removeItem(INTERNAL_KEY);
  } catch {
    // Nothing sensible to do — the beacon will keep counting this device.
  }
  internalListeners.forEach((l) => l());
}

// ---------------------------------------------------------------------------
// Change notification for the flag, so React components can read it with
// useSyncExternalStore instead of copying it into state from an effect. The
// flag lives outside React (localStorage) and can change from another tab, and
// this file's components never unmount — all three are the conditions
// useSyncExternalStore exists for. The owner of the value owns its
// subscription; the alternative is every reader inventing its own.
// ---------------------------------------------------------------------------

const internalListeners = new Set<() => void>();

/** Subscribe to device-flag changes, including flips made in another tab. */
export function subscribeInternalDevice(onChange: () => void): () => void {
  internalListeners.add(onChange);
  // `storage` fires only in OTHER tabs, which is exactly the case the local
  // listener set cannot cover.
  window.addEventListener("storage", onChange);
  return () => {
    internalListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Server snapshot for useSyncExternalStore: null, meaning "not known yet".
 *
 * Not `false`. localStorage does not exist during SSR, so a server-rendered
 * `false` would state as fact that this device is counted — and then correct
 * itself a moment later on the one screen someone opened specifically to find
 * out. null renders as "checking…" and resolves to the truth.
 */
export function internalDeviceServerSnapshot(): boolean | null {
  return null;
}

/**
 * Apply ?vk-internal=1 / =0 from the current URL, then strip it from the
 * address bar.
 *
 * The strip is not tidiness. A URL carrying this flag is contagious: leave it
 * in the bar and it rides along into anything copy-pasted from there, silently
 * excluding whoever opens the link. history.replaceState changes the bar
 * without a navigation, so nothing re-renders and no pageview is disturbed.
 *
 * Reads window.location.search rather than useSearchParams() ON PURPOSE.
 * useSearchParams() without a Suspense boundary opts its route into
 * client-side rendering, and this file's components are mounted in the ROOT
 * LAYOUT — it would deopt every prerendered page in the app and take the
 * Lighthouse performance gate with it.
 */
function syncInternalFlagFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    const value = url.searchParams.get(INTERNAL_PARAM);
    if (value === null) return;
    setInternalDevice(value !== "0" && value !== "false");
    url.searchParams.delete(INTERNAL_PARAM);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Malformed URL or a browser without replaceState — the flag just doesn't apply.
  }
}

/**
 * Fire-and-forget beacon to /api/track. Exported (E11) so the consent
 * surfaces can send their one "consent" event through the SAME path —
 * sendBeacon-with-fetch-fallback — instead of growing a second fetch idiom.
 *
 * The internal marker is stamped HERE, at the single choke point every event
 * type already flows through, so pageviews, outbound taps, consent grants and
 * web vitals are all covered without four separate call sites remembering to.
 */
export function send(payload: Record<string, unknown>) {
  const body = JSON.stringify(isInternalDevice() ? { ...payload, internal: true } : payload);
  try {
    // sendBeacon queues the request even if the page unloads (outbound taps!).
    if (typeof navigator !== "undefined" && navigator.sendBeacon?.("/api/track", body)) {
      return;
    }
  } catch {
    // fall through to fetch
  }
  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // best-effort telemetry; never bother the visitor
  });
}

/** Session id accessor for the consent surfaces (E11). */
export function trackingSessionId(): string {
  return getSessionId();
}

/**
 * Record ONE consent grant (E11). Session id + notice version + which purpose
 * — never a location. Lives here so BOTH consent surfaces emit identically:
 * when only near-me emitted, a hunt-first visitor produced geo-tagged data
 * with no matching grant in the audit story.
 */
export function trackConsent(purpose: string, noticeVersion: string) {
  if (typeof window === "undefined") return;
  send({
    type: "consent",
    path: window.location.pathname,
    sessionId: getSessionId(),
    noticeVersion,
    purpose,
  });
}

/** Record a tap on an outbound link (menu, ordering, map, booking, ...). */
export function trackOutbound(href: string, label: string) {
  if (typeof window === "undefined") return;
  const path = window.location.pathname;
  if (path.startsWith("/admin")) return;
  // E11: food/health-assistance destinations are never tracked. The server
  // drops these too (the guarantee); skipping here avoids even the request.
  if (isSensitiveOutbound(href)) return;
  send({ type: "outbound", path, sessionId: getSessionId(), href, label });
}

/**
 * Client anchor used by ExternalLink (src/components/ui.tsx). It lives here
 * because ui.tsx must stay a shared server-safe module (server pages call its
 * mapSearchUrl/mapDirectionsUrl helpers), and an onClick handler requires a
 * client component. No preventDefault: sendBeacon survives the navigation.
 */
export function OutboundLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={() => trackOutbound(href, typeof children === "string" ? children : href)}
    >
      {children}
    </a>
  );
}

/**
 * Reports this page load's final LCP once (E15 follow-up). Renders nothing.
 *
 * WHY: NFR-1 / M-18-02 wants mobile LCP under 2.5s, and the Lighthouse gate
 * measures a SIMULATED load of four hand-picked URLs on CI hardware. That
 * number and its phase attribution proved environment-dependent — the same
 * build attributed the identical total to completely different phases in the
 * lab vs production. This is the ground truth the gate cannot provide: what
 * the actual phone in the actual ferry queue actually waited for.
 *
 * ONCE PER DOCUMENT LOAD, not per pathname — LCP is a page-LOAD metric. A
 * client-side route change emits no new largest-contentful-paint entry, so
 * re-running this per pathname would re-report the FIRST page's number against
 * every route the visitor later opened. Hence [] deps and the captured path.
 *
 * Everything here is feature-detected and every failure path is a silent
 * no-op: an unsupported browser gets the plain app, never an error. Nothing
 * about the visitor is read — see AnalyticsEvent.metric for why this carries
 * no consent obligation.
 */
export function WebVitals() {
  const pathname = usePathname();
  // The path of the document that actually loaded, frozen at first render.
  const loadPath = useRef(pathname);

  useEffect(() => {
    const path = loadPath.current;
    if (!path || path.startsWith("/admin")) return;
    if (typeof PerformanceObserver === "undefined") return;

    let latest = 0;
    let sent = false;
    let observer: PerformanceObserver;

    try {
      observer = new PerformanceObserver((list) => {
        // LCP is emitted repeatedly as bigger elements paint; the LAST entry
        // is the real one. The browser stops emitting after first input.
        for (const entry of list.getEntries()) latest = entry.startTime;
      });
      // buffered: true replays entries that fired BEFORE hydration mounted
      // this component — without it we would miss the LCP on every fast load,
      // biasing the sample toward slow pages only.
      observer.observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      return; // entry type unsupported (Safari < 16 etc.) — no-op, not an error
    }

    // REPORTING MOMENT — the accuracy/completeness trade-off, chosen as:
    // report when the page is first hidden, never before.
    //
    // LCP is not final until the page is backgrounded or the visitor
    // interacts, so reporting earlier would record a premature value and make
    // every number optimistic. The cost is that a session whose tab is killed
    // outright never reports. Both `visibilitychange -> hidden` and `pagehide`
    // are listened for because iOS Safari does not reliably fire
    // visibilitychange when the app is swiped away, and pagehide covers the
    // bfcache path. `sent` makes the pair idempotent.
    const report = () => {
      if (sent || latest <= 0) return;
      sent = true;
      try {
        observer.disconnect();
      } catch {
        // already gone; the beacon below is what matters
      }
      send({ type: "webvital", metric: "LCP", value: latest, path, sessionId: getSessionId() });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") report();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", report);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", report);
      try {
        observer.disconnect();
      } catch {
        // no-op
      }
    };
  }, []);

  return null;
}

/**
 * Fires one pageview per pathname change. Renders nothing.
 *
 * The beacon is DEFERRED past first paint rather than sent from the effect
 * body. Hydration runs before first paint on fast loads, so an eager beacon
 * lands inside the pre-LCP window — the Lighthouse trace showed /api/track
 * finishing at ~134ms against an observed LCP of ~142ms. Measurement caveat
 * (2026-07-31): Lighthouse's Lantern simulation turned out NOT to count the
 * Ping-type beacon against FCP/LCP — the CI coin-flip was the cold first run
 * plus a prefetched route chunk racing the paint — so this deferral is NOT
 * load-bearing for the CI gate. It ships for the real visitor: a POST
 * competing with the hero image for a phone's ferry-queue bandwidth during
 * the most latency-critical window of the load, for zero benefit.
 *
 * THE DEFERRAL MUST BE PAINT-ANCHORED, NOT JUST IDLE-ANCHORED. Measured on
 * the production build: requestIdleCallback alone fires at ~140-158ms —
 * hydration finishes, the event loop goes idle, and the first paint has NOT
 * happened yet (~146-170ms). An idle-only deferral put the beacon right back
 * in the pre-paint window. requestAnimationFrame runs just before the next
 * frame paints, so idle work scheduled from inside it lands strictly after
 * that paint.
 *
 * No pageview is ever lost to the deferral: leaving the page (pagehide /
 * visibility-hidden, same pair WebVitals uses — iOS Safari does not reliably
 * fire visibilitychange when the app is swiped away) or client-navigating
 * away (effect cleanup) flushes immediately, and `sent` makes the paths
 * idempotent. A hidden tab never fires rAF, so the deferral is only rAF-
 * anchored while visible; hidden tabs schedule idle work directly (their
 * pre-paint window is moot) and the visibility flush covers close-from-
 * background. requestIdleCallback is feature-detected (missing on Safari);
 * the fallback timer waits 500ms, comfortably past first paint.
 */
export function Tracker() {
  const pathname = usePathname();

  useEffect(() => {
    // Before anything is sent: a visitor who just opened /?vk-internal=1 must
    // have that applied in time for THIS page's own beacon, not the next one.
    // Runs per pathname rather than once, because this component is mounted in
    // the root layout and never remounts — a [] effect here would only ever see
    // the URL the tab was first opened with.
    syncInternalFlagFromUrl();
    if (!pathname || pathname.startsWith("/admin")) return;
    let sent = false;
    let rafId: number | undefined;
    let idleId: number | undefined;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      if (sent) return;
      sent = true;
      send({ type: "pageview", path: pathname, sessionId: getSessionId() });
    };
    const scheduleIdle = () => {
      if (typeof requestIdleCallback === "function") {
        idleId = requestIdleCallback(flush, { timeout: 3000 });
      } else {
        timerId = setTimeout(flush, 500);
      }
    };
    if (typeof requestAnimationFrame === "function" && document.visibilityState === "visible") {
      rafId = requestAnimationFrame(scheduleIdle);
    } else {
      scheduleIdle();
    }
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      // Client-side nav away before idle: record the view now, not never.
      flush();
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      if (idleId !== undefined) cancelIdleCallback(idleId);
      if (timerId !== undefined) clearTimeout(timerId);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [pathname]);

  return null;
}
